/*
 * Panelin KAPSAM (Flowscope) katmanı — tek veri kaynağı, tek tazeleme yolu.
 *
 * NEDEN: panelin altı bölümü aynı ağacı soruyor (Genel bakış sayaçları, Koşumlar
 * grubu, Sonuçlar eşlemesi, Jira kart→düğüm bağı, Performans rotaları, Site
 * canlı hızlı butonları). Her biri kendi `fetch`ini yapsaydı sekme geçişlerinde
 * altı ayrı istek, altı ayrı bayat kopya ve "hangisi doğru" sorusu doğardı.
 *
 * ⚠️ Klasik script (modül DEĞİL) — panelin satır içi kodu ve `onclick="..."`
 * global adlara bakıyor; bu dosya `<script src>` ile satır içi bloktan ÖNCE
 * yükleniyor (bkz. dialogs.js / run-client.js / ai-client.js aynı desen).
 *
 * ⚠️ Sunucu `scope-changed` SSE olayını YALNIZCA haber olarak yayıyor (veri
 * taşımıyor); tazeleme burada, tek yerden. Panelin kendi EventSource'u
 * (index.html içindeki `es`) olayı alınca `scopeRefresh()` çağırır — ikinci bir
 * EventSource açmak aynı sunucuya ikinci kalıcı bağlantı demekti.
 */

/** Son okunan kapsam özeti. `null` = henüz hiç okunmadı (0 ile karıştırma). */
window.SCOPE = null;

(() => {
  const listeners = new Set();
  let bekleyen = null;      // aynı anda iki istek gitmesin
  let sonOkuma = 0;

  /** Kapsam değiştiğinde çağrılacak fonksiyonlar — bölümler buraya yazılır. */
  window.onScopeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /**
   * Özeti sunucudan tazeler.
   * @param {{quiet?: boolean, maxAgeMs?: number}} [o]
   *   `maxAgeMs` verilirse ve önbellek o kadar tazeyse ağ isteği yapılmaz
   *   (sekme geçişlerinde arka arkaya çağrılıyor).
   */
  window.scopeRefresh = async (o = {}) => {
    if (o.maxAgeMs && window.SCOPE && Date.now() - sonOkuma < o.maxAgeMs) return window.SCOPE;
    if (bekleyen) return bekleyen;
    bekleyen = (async () => {
      try {
        const d = await (await fetch('/api/scope/summary')).json();
        if (!d.ok) throw new Error(d.error || 'kapsam ozeti okunamadi');
        window.SCOPE = d;
        sonOkuma = Date.now();
        for (const fn of listeners) { try { fn(d); } catch (e) { console.warn('kapsam dinleyicisi:', e); } }
        return d;
      } catch (e) {
        // Kapsam okunamazsa panel körleşmez: bölümler eski/profil verisiyle
        // çalışmaya devam eder, sessizce yanlış sayı GÖSTERMEZ (SCOPE null kalır).
        if (!o.quiet) console.warn('kapsam ozeti:', e.message);
        return null;
      } finally { bekleyen = null; }
    })();
    return bekleyen;
  };

  /** Düğüm durumu → panelin renk sınıfı. */
  window.scopeStatusCls = (s) => (s === '✅' ? 'ok' : s === '❌' ? 'no' : s === '⚠️' ? 'sk' : '');

  /** Flowscope'ta o düğümü açan adres (aynı origin, aynı sekme kullanılabilir). */
  window.scopeNodeUrl = (nodeId) => `/scope/#node=${encodeURIComponent(nodeId)}`;

  /**
   * Bir spec dosyasına `runRef` ile bağlı düğümler. Sonuçlar sekmesi "bu spec
   * kapsamda nereye düşüyor" sorusunu bununla cevaplıyor.
   */
  window.scopeNodesForSpec = (spec) => {
    const out = [];
    for (const r of window.SCOPE?.runs ?? []) {
      if (!(r.specs ?? []).includes(spec)) continue;
      for (const n of r.nodes ?? []) out.push(n);
    }
    return out;
  };

  /** Bir Jira kartına bağlı düğümler (kart anahtarı büyük/küçük harf duyarsız). */
  window.scopeNodesForCard = (key) => window.SCOPE?.jira?.[String(key || '').toUpperCase()] ?? [];
})();
