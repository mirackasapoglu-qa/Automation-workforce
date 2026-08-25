/**
 * Rota bazlı ağ + performans envanteri.
 *
 * Her rota için: çağrılan backend endpoint'leri, istek süreleri, sayfa
 * metrikleri (TTFB/DCL/load/FCP/LCP), 4xx-5xx'ler, mükerrer çağrılar.
 * Çıktı: panel-data/perf/<slug>.json + özet tablo.
 *
 * Kullanım:
 *   node scripts/perf-sweep.mjs                          # baseline rotalarının tamamı
 *   node scripts/perf-sweep.mjs --routes /,/sepet        # seçili rotalar
 *   node scripts/perf-sweep.mjs --scroll                 # lazy içerik için sonuna kadar kaydır
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const SCROLL = process.argv.includes("--scroll");
const SETTLE = Number(arg("--settle", 6)) * 1000;
const OUT = path.join("panel-data", "perf");

const env = (fs.readFileSync(".env", "utf8").match(/HOMEE_ENV\s*=\s*(\S+)/) ?? [])[1] ?? "test";
const BASE = (fs.readFileSync(".env", "utf8").match(new RegExp(`BASE_URL_${env.toUpperCase()}\\s*=\\s*(\\S+)`)) ?? [])[1];
if (!BASE) throw new Error(`BASE_URL_${env.toUpperCase()} .env'de yok`);
const STATE = `playwright/.auth/${env}-gate.json`;

function baselineRoutes() {
  const src = fs.readFileSync(path.join("tests", "routes.ts"), "utf8");
  const found = new Set(["/"]);
  for (const m of src.matchAll(/["'](\/[A-Za-z0-9\-_/]*)["']/g)) {
    const p = m[1];
    if (p.includes("-p-") || p.length > 60) continue;   // urun detaylari ayri
    found.add(p.replace(/\/$/, "") || "/");
  }
  return [...found];
}
const ROUTES = (arg("--routes", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const routes = ROUTES.length ? ROUTES : baselineRoutes();

const slug = (p) => (p === "/" ? "anasayfa" : p.replace(/^\//, "").replace(/\//g, "-"));
const NOISE = /personaclick|gtag|googletagmanager|google-analytics|clarity|mobildev|hotjar|facebook|doubleclick/i;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const summary = [];

for (const route of routes) {
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // LCP getEntriesByType ile gelmiyor; observer'i sayfa yuklenmeden kur
  await page.addInitScript(() => {
    window.__lcp = null;
    try {
      new PerformanceObserver((l) => { const e = l.getEntries(); window.__lcp = e[e.length - 1]?.startTime ?? window.__lcp; })
        .observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
  });
  const reqs = [];
  const consoleErrors = [];

  page.on("requestfinished", async (r) => {
    try {
      const t = r.timing();
      const res = await r.response();
      const u = new URL(r.url());
      reqs.push({
        method: r.method(), host: u.host, pathname: u.pathname,
        type: r.resourceType(), status: res?.status() ?? 0,
        ms: t.responseEnd >= 0 ? Math.round(t.responseEnd) : -1,
        ttfbMs: t.responseStart >= 0 ? Math.round(t.responseStart) : -1,
        thirdParty: NOISE.test(r.url()),
      });
    } catch {}
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    reqs.push({ method: r.method(), host: u.host, pathname: u.pathname, type: r.resourceType(),
                status: -1, ms: -1, ttfbMs: -1, failed: r.failure()?.errorText ?? "failed",
                thirdParty: NOISE.test(r.url()) });
  });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

  const t0 = Date.now();
  let navStatus = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
    navStatus = resp?.status() ?? null;
  } catch (e) {
    summary.push({ route, error: String(e.message).slice(0, 120) });
    await ctx.close();
    continue;
  }
  if (SCROLL) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
  }
  await page.waitForTimeout(SETTLE);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] ?? {};
    const paint = (n) => performance.getEntriesByType("paint").find((p) => p.name === n)?.startTime ?? null;
    const lcp = window.__lcp ?? performance.getEntriesByType("largest-contentful-paint").slice(-1)[0]?.startTime ?? null;
    const r = (v) => (v == null ? null : Math.round(v));
    return {
      ttfbMs: r(nav.responseStart), domContentLoadedMs: r(nav.domContentLoadedEventEnd),
      loadMs: r(nav.loadEventEnd), fcpMs: r(paint("first-contentful-paint")), lcpMs: r(lcp),
      transferBytes: r(nav.transferSize), notFound: /Sayfa Bulunamadı/i.test(document.body.innerText),
    };
  });

  // Backend endpoint envanteri: yalnizca xhr/fetch, 3P haric
  const api = reqs.filter((r) => ["xhr", "fetch"].includes(r.type) && !r.thirdParty);
  const byEndpoint = {};
  for (const r of api) {
    const k = `${r.method} ${r.host}${r.pathname}`;
    (byEndpoint[k] ??= []).push(r);
  }
  const endpoints = Object.entries(byEndpoint).map(([k, list]) => ({
    endpoint: k, calls: list.length,
    status: [...new Set(list.map((x) => x.status))],
    avgMs: Math.round(list.reduce((a, x) => a + Math.max(x.ms, 0), 0) / list.length),
    maxMs: Math.max(...list.map((x) => x.ms)),
  })).sort((a, b) => b.maxMs - a.maxMs);

  const bad = reqs.filter((r) => r.status >= 400 || r.status === -1);
  const rec = {
    route, url: BASE + route, navStatus, wallMs: Date.now() - t0, metrics,
    requestCount: reqs.length, apiCount: api.length,
    endpoints, duplicates: endpoints.filter((e) => e.calls > 1),
    failed: bad.map((r) => ({ ...r })).slice(0, 20),
    consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
    slowest: reqs.filter((r) => !r.thirdParty).sort((a, b) => b.ms - a.ms).slice(0, 5)
      .map((r) => ({ what: `${r.type} ${r.pathname}`, ms: r.ms })),
    measuredAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, `${slug(route)}.json`), JSON.stringify(rec, null, 2));
  summary.push(rec);
  console.log(
    `${route.padEnd(26)} ${String(metrics.notFound ? "404" : navStatus).padEnd(4)} ` +
    `LCP ${String(metrics.lcpMs ?? "-").padStart(5)}ms  load ${String(metrics.loadMs ?? "-").padStart(5)}ms  ` +
    `${String(reqs.length).padStart(3)} istek / ${String(api.length).padStart(2)} API  ` +
    `${bad.length ? `⚠ ${bad.length} hatali` : ""}${rec.duplicates.length ? ` ⧉ ${rec.duplicates.length} mukerrer` : ""}`,
  );
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "_summary.json"), JSON.stringify(summary, null, 2));
console.log(`\n${summary.length} rota olculdu → ${OUT}/`);
