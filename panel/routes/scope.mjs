/**
 * Kapsam (Flowscope) → panel uçları.
 *
 *   GET /api/scope/summary  — panelin ALTI bölümünün ortak veri kaynağı:
 *                             özet sayaçlar, rotalar, koşum bağları, Jira dizini,
 *                             test case listesi. Açık (okuma, yan etkisiz).
 *   GET /api/scope/routes   — yalnız rota listesi (Site canlı + perf hedefleri).
 *   GET /api/scope/jira     — kart → düğüm dizini (Jira sekmesi).
 *
 * NEDEN TEK UÇ + iki dar uç: panelin Genel bakış sekmesi hepsini birden ister
 * (tek istek), Site/Performans sekmeleri yalnız rotayı ister (küçük yanıt).
 * İkisini tek uca sıkıştırmak her sekme geçişinde tüm ağacın türetilmesi
 * demekti; üç ayrı uç yazmak da aynı türetmenin üç kopyası olurdu — türetme
 * `scope-bridge.mjs`'te tek, uçlar ince.
 *
 * ⚠️ Bu uçlar ağacı DEĞİŞTİRMEZ. Yazma yolları (koşum sonucu, perf, Jira
 * bağlama, sweep'ler) kendi uçlarında ve hepsi token ister.
 */
import { readTree, backfillRoutes } from "../scope.mjs";
import {
  deriveSummary, deriveRoutes, routesWithFallback, deriveJiraIndex, deriveRuns, deriveCases,
} from "../scope-bridge.mjs";
import { PROJECT } from "../project.mjs";

export function registerScopeRoutes(router, ctx) {
  const { send, BASE_URL, RUNS } = ctx;

  /** Ağacı okurken hata ÇIKARSA panel tamamen körleşmesin — boş ağaçla devam. */
  const tree = () => {
    try { return readTree().tree; } catch { return []; }
  };

  const rotalar = (t) => routesWithFallback(t, {
    baseUrl: BASE_URL,
    quickRoutes: PROJECT.quickRoutes,
  });

  router.get("/api/scope/summary", ({ res }) => {
    const t = tree();
    const r = rotalar(t);
    return send(res, 200, {
      ok: true,
      baseUrl: BASE_URL ?? null,
      summary: deriveSummary(t, { baseUrl: BASE_URL }),
      routeSource: r.source,
      routes: r.routes,
      runs: deriveRuns(t, Object.keys(RUNS ?? {})),
      jira: deriveJiraIndex(t, { baseUrl: BASE_URL }),
      cases: deriveCases(t),
    });
  });

  router.get("/api/scope/routes", ({ res }) => {
    const r = rotalar(tree());
    return send(res, 200, { ok: true, source: r.source, baseUrl: BASE_URL ?? null, routes: r.routes });
  });

  router.get("/api/scope/jira", ({ res }) => {
    const t = tree();
    const idx = deriveJiraIndex(t, { baseUrl: BASE_URL });
    return send(res, 200, {
      ok: true,
      keys: Object.keys(idx),
      index: idx,
      /** Ağaçta hiç düğüme bağlanmamış olmak da bir sinyal — panel bunu gösteriyor. */
      unlinkedHint: "Bu dizinde olmayan kart hiçbir kapsam düğümüne bağlı değildir.",
    });
  });

  /**
   * Rota taşımayan eski düğümlere göreli rotayı yazar (bkz. scope.mjs →
   * backfillRoutes). Panelin "kapsam profil listesine düşüyor" uyarısındaki
   * tek tıklık çözüm. Tekrar çağırmak güvenli: zaten rotası olan düğüme
   * dokunulmaz, yazacak bir şey yoksa ağaç hiç yazılmaz.
   */
  router.post("/api/scope/backfill-routes", ({ res, audit }) => {
    const out = backfillRoutes();
    audit({ event: "scope-backfill-routes", written: out.written });
    return send(res, 200, { ok: true, ...out });
  }, { auth: true });

  /**
   * Perf süpürmesinin ölçeceği rotalar — `scripts/perf-sweep.mjs --routes` için
   * hazır, virgüllü tek satır. Ağaçta rota yoksa boş döner ve süpürme kendi
   * `tests/routes.ts` taban listesine düşer (davranış değişmez).
   */
  router.get("/api/scope/perf-targets", ({ res, url }) => {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    const r = deriveRoutes(tree(), { baseUrl: BASE_URL });
    // Sorgu dizeli rotalar ölçümde tekrara düşüyor (aynı sayfa, farklı parametre);
    // ölçüm hedefi olarak yol yeterli.
    const yollar = [...new Set(r.map((x) => String(x.path).split("?")[0] || "/"))].slice(0, limit);
    return send(res, 200, { ok: true, count: yollar.length, routes: yollar, arg: yollar.join(",") });
  });
}
