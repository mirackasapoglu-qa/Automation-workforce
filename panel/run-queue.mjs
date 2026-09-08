/**
 * Koşum kapısı: tek slot + idempotency anahtarı + kısa FIFO kuyruk.
 *
 * NEDEN: Playwright koşum başında `test-results/`i temizler; aynı anda iki koşum
 * birbirinin kanıtını ve `results.json`'ını siler (CLAUDE.md'de belgeli).
 * Sunucu tek slotla (`active`) bunu zaten engelliyordu ama iki boşluk vardı:
 *   1) Çift tık / iki sekme / iki kullanıcı: ikinci istek "zaten koşuyor" alıyor
 *      ve kullanıcı bunu HATA sanıyor. Aynı istek (`requestId`) 60 sn içinde
 *      tekrar gelirse İLK sonucun aynısı döner — istek idempotent olur.
 *   2) "Bittiğinde koş" diye bir yol yoktu; kapsam ağacından art arda tetiklenen
 *      koşumlar kayboluyordu. `queue:true` ile en fazla 5 koşum sırada bekler.
 *
 * Bu modül SAF: süreç başlatmaz, dosya yazmaz, `server.mjs` çağırır. Sırf bu
 * yüzden birim testi var (`run-queue.test.mjs`) — kilit mantığı sunucuyu
 * ayağa kaldırmadan doğrulanır.
 */

export function createRunGate({ dedupeMs = 60_000, queueLimit = 5, now = Date.now } = {}) {
  /** requestId → { at, result } */
  const seen = new Map();
  /** sırada bekleyen koşumlar */
  const queue = [];

  const purge = () => {
    const t = now();
    for (const [k, v] of seen) if (t - v.at > dedupeMs) seen.delete(k);
  };

  return {
    /**
     * Aynı `requestId` yakın zamanda görüldüyse önceki sonucu döndürür
     * (`deduped:true` ile), yoksa null. Boş id = kontrol yok.
     */
    recall(requestId) {
      if (!requestId) return null;
      purge();
      const hit = seen.get(String(requestId));
      return hit ? { ...hit.result, deduped: true } : null;
    },

    /** Bir isteğin sonucunu hatırla (yalnızca başarılı başlatma/kuyruklama). */
    remember(requestId, result) {
      if (!requestId) return;
      purge();
      seen.set(String(requestId), { at: now(), result });
    },

    /** Kuyruğa al. Doluysa `QUEUE_FULL`. Aynı runId+params zaten sıradaysa `DUPLICATE`. */
    enqueue(item) {
      if (queue.length >= queueLimit) {
        return { ok: false, code: "QUEUE_FULL", error: `Kuyruk dolu (${queueLimit}). Süren koşumu bekle ya da durdur.` };
      }
      const sig = signature(item);
      if (queue.some((q) => signature(q) === sig)) {
        return { ok: false, code: "DUPLICATE", error: "Aynı koşum zaten sırada." };
      }
      queue.push({ ...item, queuedAt: now() });
      return { ok: true, queued: true, position: queue.length };
    },

    /** Sıradaki koşum (FIFO) ya da null. */
    dequeue() { return queue.shift() ?? null; },

    /** Sıra görünümü (arayüz için). */
    pending() { return queue.map((q, i) => ({ position: i + 1, id: q.runId, label: q.label ?? q.runId, queuedAt: q.queuedAt })); },

    size() { return queue.length; },

    /** Sırayı boşalt (durdur ile birlikte: kullanıcı "her şeyi durdur" der). */
    clear() { const n = queue.length; queue.length = 0; return n; },
  };
}

/** Kuyruk tekilliği: aynı koşum + aynı parametreler = aynı iş. */
function signature(item) {
  return JSON.stringify([item.runId, item.params ?? null, Boolean(item.headless), Boolean(item.record)]);
}
