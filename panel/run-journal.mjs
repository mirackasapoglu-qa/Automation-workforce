/**
 * Koşum günlüğü — "hangi koşum ne zaman koştu, sonucu neydi".
 *
 * NEDEN YENİ: panelde case bazlı geçmiş (case-history.json) vardı ama KOŞUM
 * bazlı geçmiş yoktu; denetim kaydında (command-log.jsonl) yalnızca başlangıç
 * satırı duruyordu, sonuç oraya yazılmıyordu. Genel bakış ekranının "koşum
 * geçmişi" listesi bu dosyadan besleniyor.
 *
 * Dosya: panel-data/run-log.json (son 200 kayıt; eskiler düşer)
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "panel-data", "run-log.json");
const AUDIT = path.join(process.cwd(), "panel-data", "command-log.jsonl");
const LIMIT = 200;

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; } };

function write(list) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list.slice(-LIMIT), null, 1));
    fs.renameSync(tmp, FILE);
  } catch { /* yazilamazsa gunluk tutulmaz, kosum etkilenmez */ }
}

/** Koşum başladı. Dönen id ile `finish` çağrılır. */
export function start({ runId, label, argv }) {
  const list = read();
  const kayit = {
    id: `${runId}-${Date.now().toString(36)}`,
    runId, label: label ?? runId, argv: argv ?? "",
    startedAt: new Date().toISOString(),
    status: "running",
    durationMs: null, code: null, counts: null,
  };
  list.push(kayit);
  write(list);
  return kayit.id;
}

/** Koşum bitti: süre, çıkış kodu ve sonuç sayıları eklenir. */
export function finish(id, { code, durationMs, counts }) {
  const list = read();
  const k = list.find((x) => x.id === id);
  if (!k) return null;
  k.status = code === 0 ? "done" : "failed";
  k.code = code;
  k.durationMs = durationMs;
  k.counts = counts ?? null;
  k.endedAt = new Date().toISOString();
  write(list);
  return k;
}

/**
 * Geçmiş, yeniden eskiye. Günlük boşsa denetim kaydından GERİYE DOLDURUR:
 * eski koşumların sonucu bilinmiyor ama en azından ne zaman koştukları
 * görünsün (aksi halde ekran boş açılırdı).
 */
export function list(limit = 20) {
  let kayitlar = read();
  if (!kayitlar.length) {
    try {
      for (const satir of fs.readFileSync(AUDIT, "utf8").split("\n")) {
        if (!satir.trim()) continue;
        const e = JSON.parse(satir);
        if (e.event !== "run") continue;
        kayitlar.push({
          id: `${e.id}-${e.at}`, runId: e.id, label: e.label ?? e.id,
          startedAt: e.at, status: "unknown", durationMs: null, code: null, counts: null,
          backfilled: true,
        });
      }
    } catch { /* denetim kaydi yoksa bos liste */ }
  }
  return kayitlar.slice(-limit).reverse();
}
