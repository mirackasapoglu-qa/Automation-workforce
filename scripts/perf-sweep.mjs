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
import { deriveRoutes } from "../panel/scope-bridge.mjs";
import { resolveActive, activeSubtree, productSlug } from "../panel/active-product.mjs";
import { loadEnv } from "../env.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const SCROLL = process.argv.includes("--scroll");
const SETTLE = Number(arg("--settle", 6)) * 1000;
/**
 * AKTİF ÜRÜN — ölçümün hedefi, çıktı klasörü ve rota listesi HEPSİ buradan.
 *
 * ⚠️ 2026-09-15'e kadar hedef adres `.env`deki `BASE_URL_<ENV>`den (profilin
 * sitesi) geliyor, rota listesi ise ağaçtan türetilmeye çalışılıp o adresle
 * eşleşmeyince `tests/routes.ts` taban listesine düşüyordu. Sonuç: panelde
 * Promptfoo aktifken "Yeniden ölç" TEPE HOME'un 33 statik rotasını ölçüyordu
 * (ölçüldü: panel-data/perf/Tepe-Home-Bahce.json vb., 15:41). Artık:
 *   - adres = aktif ürünün taranmış origin'i (panelin gördüğüyle aynı)
 *   - rotalar = yalnız o ürünün alt ağacı; statik taban listesi YOK
 *   - kapı oturumu yalnız adres profilin sitesiyse yüklenir
 */
function aktifUrun() {
  try {
    const t = JSON.parse(fs.readFileSync(path.join("panel-data", "scope", "tree.json"), "utf8"));
    const tree = Array.isArray(t) ? t : t?.tree;
    if (!Array.isArray(tree) || !tree.length) return { tree: [], active: null };
    const { active } = resolveActive(tree, { profileBaseUrl: process.env[`BASE_URL_${(process.env.PANEL_ENV || process.env.HOMEE_ENV || "test").toUpperCase()}`] ?? null });
    return { tree: activeSubtree(tree, active), active };
  } catch { return { tree: [], active: null }; }
}
/*
 * ⚠️ ORTAM: `.env` DOSYASI DOĞRUDAN OKUNMAZ.
 *
 * Eskiden `fs.readFileSync(".env")` vardı; container'da `.env` yok (`.dockerignore`
 * onu bilerek dışarıda bırakıyor, kimlikler ortam değişkeniyle geliyor) ve ölçüm
 * daha ilk satırda ENOENT ile düşüyordu — panelin Performans sekmesinden
 * "Yeniden ölç" diyen kullanıcı "env hatası" görüyordu (ölçüldü 2026-09-15,
 * canlıda). `loadEnv()` varsa dosyayı yükler, yoksa sessizce geçer; değer her
 * durumda `process.env`den okunur (panelin geri kalanıyla aynı kural).
 */
loadEnv();
const env = (process.env.PANEL_ENV || process.env.HOMEE_ENV || "test").toLowerCase();
const PROFIL_BASE = process.env[`BASE_URL_${env.toUpperCase()}`] ?? null;
const URUN = aktifUrun();
/** Hedef: aktif ürünün adresi; ağaç boşsa profilin adresi (tek yedek). */
const BASE = (URUN.active?.baseUrl ?? PROFIL_BASE ?? "").replace(/\/+$/, "");
if (!BASE) throw new Error("Olculecek adres yok: kapsam agacinda urun yok ve BASE_URL_<ENV> tanimli degil");
const sameHost = (a, b) => { try { return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, ""); } catch { return false; } };
const PROFIL_URUNU = PROFIL_BASE ? sameHost(BASE, PROFIL_BASE) : false;
/** Ürün varsa `perf/<urun>/`; ağaç boşsa eski düz dizin (panel de oradan okur). */
const OUT = URUN.active ? path.join("panel-data", "perf", productSlug(URUN.active)) : path.join("panel-data", "perf");

/*
 * Kapı oturumu YALNIZ profilin sitesi ölçülürken: o çerez o siteye ait. İmajda
 * dosya yoksa (playwright/.auth `.dockerignore`'da) ölçüm oturumsuz koşar ve
 * sebebi log'a yazılır — ölçümün tamamen düşmesinden iyidir.
 */
const STATE_PATH = `playwright/.auth/${env}-gate.json`;
const STATE = PROFIL_URUNU && fs.existsSync(STATE_PATH) ? STATE_PATH : null;
if (PROFIL_URUNU && !STATE) console.log(`[perf] uyari: kapi oturumu yok (${STATE_PATH}) — olcum oturumsuz kosuyor`);

/**
 * Ölçülecek rotalar. Sıra:
 *   1. `--routes` ile elle verilen liste
 *   2. KAPSAM AĞACI (aktif ürünün alt ağacı) — panelin gördüğü sayfalar neyse ölçülen de o
 *
 * Statik `tests/routes.ts` taban listesi KALDIRILDI: o liste profilin sitesine
 * ait ve yabancı ürün için yanlış siteyi ölçüyordu. Ağaçta rota yoksa ölçüm
 * açık bir mesajla durur — sessizce başka bir listeye düşmez.
 */
function scopeRoutes() {
  try {
    const yollar = deriveRoutes(URUN.tree, { baseUrl: BASE }).map((r) => String(r.path).split("?")[0] || "/");
    return [...new Set(yollar)];
  } catch { return []; }
}
const ROUTES = (arg("--routes", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const routes = ROUTES.length ? ROUTES : scopeRoutes();
if (!routes.length) {
  throw new Error(`Olculecek rota yok: kapsam agacinda ${URUN.active?.name ?? "aktif urun"} icin rota tasiyan dugum bulunamadi. Once Home'dan adresi tara ya da --routes ver.`);
}
console.log(`[perf] ${routes.length} rota · urun: ${URUN.active?.name ?? "(profil)"} · adres: ${BASE} · kaynak: ${ROUTES.length ? "--routes" : "kapsam agaci"} · cikti: ${OUT}`);

const slug = (p) => (p === "/" ? "anasayfa" : p.replace(/^\//, "").replace(/\//g, "-"));
const NOISE = /personaclick|gtag|googletagmanager|google-analytics|clarity|mobildev|hotjar|facebook|doubleclick/i;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const summary = [];

for (const route of routes) {
  const ctx = await browser.newContext({ ...(STATE ? { storageState: STATE } : {}), viewport: { width: 1440, height: 900 } });
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
