/**
 * Perf ölçümlerinin GEÇMİŞİ.
 *
 * SORUN: `panel-data/perf/` altındaki dosyalar her sweep'te ÜZERİNE yazılıyor.
 * Yani "LCP düzeldi mi", "istek sayısı arttı mı" sorularının cevabı hiçbir yerde
 * durmuyordu; iki ölçüm arasındaki fark ancak biri ekran görüntüsü aldıysa
 * biliniyordu.
 *
 * ÇÖZÜM: her yeni ölçüm görüldüğünde tek satırlık bir özet ekleniyor
 * (`panel-data/perf/history.jsonl`). Ham ölçümü kopyalamıyoruz — 33 rota × ham
 * kayıt yığını büyütür; rota başına yalnızca trend için gereken beş sayı
 * (lcp/load/ttfb/istek/api) saklanıyor.
 *
 * ANAHTAR `measuredAt`: aynı ölçüm iki kez yakalanmıyor. Yakalama TEMBEL —
 * `/api/perf` her okunduğunda çalışıyor. Sweep'i kim koşarsa koşsun (panel,
 * script, elle) geçmişe düşüyor; sweep sürecine kanca takmak gerekmedi.
 */
import fs from "node:fs";
import path from "node:path";
import { BUDGET } from "./perf-analyze.mjs";

const FILE = path.join(process.cwd(), "panel-data", "perf", "history.jsonl");
/** Dosya sınırsız büyümesin: en yeni 200 kayıt tutuluyor (≈ 600 KB üst sınır). */
const MAX = 200;

const sayi = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function medyan(list) {
  const s = list.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function yuzdelik(list, p) {
  const s = list.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** Bütçeye göre ihlal sayıları — eşikler perf-analyze.mjs'teki BUDGET'ten. */
function butce(routes) {
  const asan = (alan, esik) => routes.filter((r) => (r[alan] ?? 0) > esik).length;
  return {
    lcpBad: asan("lcp", BUDGET.lcp.bad),
    lcpWarn: asan("lcp", BUDGET.lcp.warn),
    loadBad: asan("load", BUDGET.load.bad),
    ttfbBad: asan("ttfb", BUDGET.ttfb.bad),
    requestsBad: asan("requests", BUDGET.requests.bad),
  };
}

export function readHistory() {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Yeni bir ölçüm varsa geçmişe ekler.
 * @param {{measuredAt: string|null, routes: object[], totals: object}} perf
 * @returns {{added: boolean, reason?: string}}
 */
export function capture(perf) {
  if (!perf?.measuredAt || !Array.isArray(perf.routes) || !perf.routes.length)
    return { added: false, reason: "ölçüm yok" };

  const gecmis = readHistory();
  if (gecmis.some((k) => k.measuredAt === perf.measuredAt))
    return { added: false, reason: "bu ölçüm zaten kayıtlı" };

  const lcps = perf.routes.map((r) => sayi(r.lcp));
  const enKotu = perf.routes.reduce(
    (a, r) => ((r.lcp ?? 0) > (a?.lcp ?? -1) ? r : a),
    null,
  );

  const kayit = {
    measuredAt: perf.measuredAt,
    capturedAt: new Date().toISOString(),
    totals: perf.totals ?? null,
    agg: {
      lcpMedian: medyan(lcps),
      lcpP95: yuzdelik(lcps, 95),
      worst: enKotu ? { route: enKotu.route, lcp: sayi(enKotu.lcp) } : null,
      budget: butce(perf.routes),
      /* Ölçümün kendi sağlığı: 404'e düşen ya da konsol hatası veren rota
         sayısı. Sayılar "iyi" görünürken rota bozuksa bunu görmek gerekiyor. */
      notFound: perf.routes.filter((r) => r.notFound).length,
      consoleErrors: perf.routes.reduce((a, r) => a + (r.consoleErrors || 0), 0),
      siteErrors: perf.routes.reduce((a, r) => a + (r.siteErrors || 0), 0),
    },
    routes: perf.routes.map((r) => ({
      route: r.route,
      lcp: sayi(r.lcp),
      load: sayi(r.load),
      ttfb: sayi(r.ttfb),
      requests: sayi(r.requests),
      api: sayi(r.api),
    })),
  };

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(kayit) + "\n");

  // Kırpma: sınır aşıldıysa en yeni MAX kaydı bırak.
  const tum = readHistory();
  if (tum.length > MAX) {
    const kalan = tum.slice(tum.length - MAX);
    fs.writeFileSync(FILE, kalan.map((k) => JSON.stringify(k)).join("\n") + "\n");
  }
  return { added: true };
}

/** Geçmiş, yeniden eskiye. */
export function list(limit = 40) {
  return readHistory()
    .sort((a, b) => String(b.measuredAt).localeCompare(String(a.measuredAt)))
    .slice(0, Math.max(1, limit));
}

/**
 * İki ölçüm arasında rota bazlı LCP farkı.
 *
 * Yalnızca İKİ ölçÜMDE DE bulunan rotalar karşılaştırılıyor: rota listesi
 * profille değiştiğinde (yeni sayfa eklendi/çıktı) "sonsuz kötüleşme" gibi
 * yanıltıcı satırlar üretmemek için. Eksik/yeni rotalar ayrı raporlanıyor.
 */
export function diffRoutes(yeni, eski, n = 5) {
  if (!yeni || !eski) return null;
  const eskiMap = new Map(eski.routes.map((r) => [r.route, r]));
  const ortak = [];
  const yeniRota = [];
  for (const r of yeni.routes) {
    const e = eskiMap.get(r.route);
    if (!e) {
      yeniRota.push(r.route);
      continue;
    }
    if (r.lcp == null || e.lcp == null) continue;
    ortak.push({
      route: r.route,
      lcp: r.lcp,
      oncekiLcp: e.lcp,
      delta: r.lcp - e.lcp,
      yuzde: e.lcp ? Math.round(((r.lcp - e.lcp) / e.lcp) * 100) : null,
    });
  }
  const kayipRota = eski.routes
    .map((r) => r.route)
    .filter((x) => !yeni.routes.some((r) => r.route === x));
  const sirali = [...ortak].sort((a, b) => b.delta - a.delta);
  return {
    kotulesen: sirali.filter((x) => x.delta > 0).slice(0, n),
    iyilesen: sirali.filter((x) => x.delta < 0).slice(-n).reverse(),
    karsilastirilan: ortak.length,
    yeniRota,
    kayipRota,
  };
}
