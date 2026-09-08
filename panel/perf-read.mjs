/**
 * Perf ölçümünü diskten okur ve tek özet nesnesine indirger.
 *
 * Eskiden bu hesap `/api/perf` işleyicisinin içindeydi ve perf yorumu isteyen
 * uçlar (`/api/perf/prompt|generate`, `/api/perf/history`) veriyi almak için
 * KENDİ SUNUCUSUNA HTTP isteği atıyordu (`fetch(http://127.0.0.1:PORT/api/perf)`).
 * Aynı süreçte kendine ağ isteği: port değişince kırılır, testte taklit
 * edilemez, hata ayıklaması zor. Şimdi saf fonksiyon; rota da AI de bunu çağırır.
 *
 * Girdi: `panel-data/perf/*.json` (scripts/perf-sweep.mjs çıktısı, rota başına).
 * `_summary.json` atlanır. Yakalama (`perf-history.capture`) BURADA DEĞİL —
 * /api/perf rotası okuduktan sonra çağırır; okuma yan etkisiz kalsın.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @param {{dataDir: string, apiHostRe?: RegExp|null}} p
 * @returns {{measuredAt: string|null, routes: object[], endpoints: object[], totals: object}}
 */
export function readPerfData({ dataDir, apiHostRe = null }) {
  const dir = path.join(dataDir, "perf");
  const empty = { measuredAt: null, routes: [], endpoints: [], totals: { routes: 0, requests: 0, api: 0, endpoints: 0, dupEndpoints: 0 } };
  if (!fs.existsSync(dir)) return empty;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_summary.json");
  const routes = [];
  const epMap = new Map();
  let measuredAt = null;

  for (const f of files) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!d.route) continue;
    if (!measuredAt || (d.measuredAt && d.measuredAt > measuredAt)) measuredAt = d.measuredAt;
    // "Bizim API'miz hata dondu" filtresi: host profilin apiHostMatch'i ile eslesenler.
    const bad = (d.failed || []).filter((x) => (!apiHostRe || apiHostRe.test(x.host || "")) && x.status >= 400);
    routes.push({
      route: d.route,
      lcp: d.metrics?.lcpMs ?? null,
      load: d.metrics?.loadMs ?? null,
      ttfb: d.metrics?.ttfbMs ?? null,
      requests: d.requestCount ?? null,
      api: d.apiCount ?? null,
      notFound: !!d.metrics?.notFound,
      duplicates: (d.duplicates || []).length,
      siteErrors: bad.length,
      consoleErrors: (d.consoleErrors || []).length,
    });
    for (const e of d.endpoints || []) {
      const cur = epMap.get(e.endpoint) || { endpoint: e.endpoint, routes: 0, calls: 0, maxMs: 0, dupRoutes: 0 };
      cur.routes += 1;
      cur.calls += e.calls || 0;
      cur.maxMs = Math.max(cur.maxMs, e.maxMs || 0);
      if ((e.calls || 0) > 1) cur.dupRoutes += 1;
      epMap.set(e.endpoint, cur);
    }
  }

  routes.sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0));
  const endpoints = [...epMap.values()].sort((a, b) => b.maxMs - a.maxMs);
  return {
    measuredAt,
    routes,
    endpoints,
    totals: {
      routes: routes.length,
      requests: routes.reduce((a, r) => a + (r.requests || 0), 0),
      api: routes.reduce((a, r) => a + (r.api || 0), 0),
      endpoints: endpoints.length,
      dupEndpoints: endpoints.filter((e) => e.dupRoutes > 0).length,
    },
  };
}
