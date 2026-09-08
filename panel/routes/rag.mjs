/**
 * RAG v1 uçları.
 *
 *   GET  /api/rag/status   — özet (parça/terim/kaynak sayısı, maskeleme sayısı); açık
 *   GET  /api/rag/search   — BM25 arama; TOKEN ister: indeks repo metnini (kurallar,
 *                            spec kodu) döndürür, kimliksiz bir uçtan verilmez
 *                            (2026-09-08'e kadar açıktı — kapatıldı)
 *   POST /api/rag/reindex  — zorla yeniden kur; token
 *
 * İndeks bayatsa `ensureIndex` zaten kendi kurar; reindex "hemen gör" içindir.
 */
import { ensureIndex, stats } from "../rag/index.mjs";
import { search } from "../rag/retrieve.mjs";

export function registerRagRoutes(router, ctx) {
  const { send, audit } = ctx;

  router.get("/api/rag/status", ({ res }) => {
    const idx = ensureIndex();
    return send(res, idx ? 200 : 503, { ok: Boolean(idx), ...(stats(idx) ?? { error: "indeks kurulamadi" }) });
  });

  router.get("/api/rag/search", ({ res, url }) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return send(res, 400, { ok: false, error: "q zorunlu" });
    const k = Math.min(Math.max(Number(url.searchParams.get("k")) || 8, 1), 25);
    const idx = ensureIndex();
    if (!idx) return send(res, 503, { ok: false, error: "indeks kurulamadi" });
    const hits = search(idx, q, { k }).map((h) => ({ ...h, text: h.text.slice(0, 600) }));
    return send(res, 200, { ok: true, q, k, hits, builtAt: idx.builtAt });
  }, { auth: true });

  router.post("/api/rag/reindex", ({ res }) => {
    const t0 = Date.now();
    const idx = ensureIndex({ force: true });
    audit({ event: "rag-reindex", chunks: idx?.chunks?.length ?? 0, redactions: idx?.redactions ?? 0, ms: Date.now() - t0 });
    return send(res, idx ? 200 : 500, { ok: Boolean(idx), ms: Date.now() - t0, ...(stats(idx) ?? {}) });
  }, { auth: true });
}
