/**
 * PAKET KOŞUM DEFTERİ — `panel-data/package-runs.json`.
 *
 * NEDEN VAR (2026-09-15): panelin "Sonuçlar" sekmesi `test-results/results.json`
 * dosyasını gösteriyordu; o dosya HER koşumda üzerine yazılıyor. Kullanıcı bir
 * paketi koşup sonra ikinci bir paketi koştuğunda ilkinin sonucu ekrandan
 * siliniyordu ("yeniden koşunca eskileri gitmicek" isteği buradan çıktı).
 * Case geçmişi (`case-history.json`) case bazlı ve spec dosyasına göre
 * anahtarlı; "hangi PAKET ne zaman koştu, hangi case'i ne yaptı" sorusunu
 * cevaplamıyordu.
 *
 * Her kayıt tek bir paket koşumu: paket adı, zaman, süre, mod (otomatik/elle),
 * sayımlar ve case satırları (başlık, düğüm, durum, hata). Case satırları
 * kayda GÖMÜLÜR — `results.json` sonradan ezilse bile bu kayıt kendi kendine
 * yeter.
 *
 * Kalıcılık deseni `packages.mjs` ile aynı: atomik yazma (tmp + rename), tek
 * kademe yedek, bozuk dosyayı ezmeden kenara alma. En yeni MAX kayıt tutulur.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "panel-data");
const FILE = path.join(DIR, "package-runs.json");
const BAK = path.join(DIR, "package-runs.bak.json");
/** Kayıt başına ~5-50 case satırı; 300 kayıt ≈ birkaç MB üst sınır. */
const MAX = Number(process.env.PACKAGE_RUNS_KEEP || 300);

export function readPackageRuns() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.runs)) return parsed.runs;
    throw new Error("beklenmeyen bicim");
  } catch (e) {
    if (e.code !== "ENOENT") {
      try { fs.mkdirSync(DIR, { recursive: true }); fs.copyFileSync(FILE, `${FILE}.bozuk-${Date.now()}`); } catch { /* yoksa gec */ }
    }
    return [];
  }
}

function write(list) {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX), null, 1));
  fs.renameSync(tmp, FILE);
}

/** Sayımlar case satırlarından türetilir — çağıran ayrıca hesaplamasın. */
export function countCases(cases) {
  const c = { total: 0, passed: 0, failed: 0, skipped: 0, warn: 0 };
  for (const x of cases ?? []) {
    c.total++;
    if (x.status === "✅") c.passed++;
    else if (x.status === "❌") c.failed++;
    else if (x.status === "⏭️") c.skipped++;
    else c.warn++;
  }
  return c;
}

/**
 * Bir paket koşumunu deftere yazar.
 *
 * @param {{
 *   packageId: string, packageName: string, mode: "auto"|"manual",
 *   startedAt?: string, durationMs?: number|null, code?: number|null,
 *   product?: string|null, specs?: string[],
 *   cases: {nodeId, nodeName, testCaseId, title, status, error?, durationMs?, spec?, note?}[],
 *   errors?: string[]
 * }} entry
 * @returns {object} yazılan kayıt (id ile)
 */
export function recordPackageRun(entry) {
  if (!entry?.packageId) throw new Error("packageId zorunlu");
  const cases = Array.isArray(entry.cases) ? entry.cases : [];
  const kayit = {
    id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    packageId: String(entry.packageId),
    packageName: String(entry.packageName ?? entry.packageId),
    mode: entry.mode === "manual" ? "manual" : "auto",
    product: entry.product ?? null,
    startedAt: entry.startedAt ?? new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: entry.durationMs ?? null,
    code: entry.code ?? null,
    specs: Array.isArray(entry.specs) ? entry.specs : [],
    errors: Array.isArray(entry.errors) ? entry.errors.slice(0, 5) : [],
    counts: countCases(cases),
    cases: cases.map((c) => ({
      nodeId: c.nodeId ?? null,
      nodeName: c.nodeName ?? "",
      testCaseId: c.testCaseId ?? null,
      title: c.title ?? "",
      status: c.status ?? "⚠️",
      error: c.error ? String(c.error).slice(0, 400) : "",
      note: c.note ? String(c.note).slice(0, 300) : "",
      durationMs: c.durationMs ?? null,
      spec: c.spec ?? null,
    })),
  };
  const list = readPackageRuns();
  list.push(kayit);
  write(list);
  return kayit;
}

/**
 * Geçmiş, yeniden eskiye. `packageId` verilirse o pakete süzülür.
 * `withCases:false` liste ekranı için satırları atar (ağırlık).
 */
export function listPackageRuns({ packageId = null, limit = 50, withCases = true } = {}) {
  let list = readPackageRuns();
  if (packageId) list = list.filter((r) => r.packageId === packageId);
  list = list.slice().reverse().slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return withCases ? list : list.map(({ cases, ...rest }) => ({ ...rest, caseCount: (cases ?? []).length }));
}

export function getPackageRun(id) {
  return readPackageRuns().find((r) => r.id === id) ?? null;
}

/**
 * OTOMATİK KOŞUM SONUCUNU PAKET CASE'LERİNE EŞLER.
 *
 * Playwright `results.json` satırları spec dosyası + test başlığı taşır; paket
 * ise `{nodeId, testCaseId}` referansları. Eşleme sırası, her case için:
 *   1. case'in KENDİ spec'i (`tc.spec`) — o spec'teki satırlardan başlığı case
 *      başlığıyla eşleşen varsa O satır; yoksa spec'in tüm satırlarının toplamı
 *      (kayıt tek testli spec'ler için birebir, çok testli spec'ler için özet)
 *   2. case'in spec'i yoksa düğümün `runRef.specs`i — aynı kural
 *   3. hiçbir spec yoksa case "koşulmadı" (⏭️) — paketin yarısı sessizce
 *      kaybolmasın, satır yine yazılır
 *
 * ⚠️ Başlık eşleşmesi TAM metin (ilk 60 karakter); URL/isim benzerliğine dayalı
 * tahmin yok — yanlış case'e sonuç yazmak fark edilmesi zor bir hata.
 *
 * @param {{cases: object[], rows: object[]}} p  cases: package-cases çıktısı
 */
export function mapResultsToCases(cases, rows, { code = 0, errors = [] } = {}) {
  const satirlar = Array.isArray(rows) ? rows : [];
  const durum = (r) => (r.status === "passed" ? "✅" : r.status === "skipped" ? "⏭️" : (r.status === "failed" || r.status === "timedOut") ? "❌" : "⚠️");
  // Playwright hata metni ANSI renk kodu tasiyor (\x1b[2m…); ekranda okunmaz, atilir.
  // eslint-disable-next-line no-control-regex
  const hata = (r) => String(r?.error ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200);

  return (cases ?? []).map((c) => {
    if (c.missing) {
      return { nodeId: c.nodeId, nodeName: c.nodeName ?? "", testCaseId: c.testCaseId, title: c.title ?? "(kayıp referans)", status: "⚠️", error: "kayıp referans — case ya da düğüm silinmiş", spec: null };
    }
    const specler = c.spec ? [c.spec] : (c.nodeSpecs ?? []);
    if (!specler.length) {
      return { nodeId: c.nodeId, nodeName: c.nodeName, testCaseId: c.testCaseId, title: c.title, status: "⏭️", error: "otomatik karşılığı yok (elle case)", spec: null };
    }
    const ilgili = satirlar.filter((r) => specler.includes(r.file));
    if (!ilgili.length) {
      const sebep = code && code !== 0
        ? `koşum ${code} koduyla düştü${errors?.[0] ? ` — ${String(errors[0]).slice(0, 160)}` : ""}`
        : "bu spec için sonuç satırı yok";
      return { nodeId: c.nodeId, nodeName: c.nodeName, testCaseId: c.testCaseId, title: c.title, status: "⚠️", error: sebep, spec: specler[0] };
    }
    const baslik = String(c.title ?? "").trim().slice(0, 60);
    const birebir = baslik ? ilgili.find((r) => String(r.title ?? "").trim().slice(0, 60) === baslik) : null;
    if (birebir) {
      return { nodeId: c.nodeId, nodeName: c.nodeName, testCaseId: c.testCaseId, title: c.title, status: durum(birebir), error: hata(birebir), durationMs: birebir.duration ?? null, spec: birebir.file };
    }
    // Özet: spec'in tamamı. Düşen varsa ❌, hepsi atlandıysa ⏭️, geçen varsa ✅.
    const dusen = ilgili.filter((r) => durum(r) === "❌");
    const gecen = ilgili.filter((r) => durum(r) === "✅");
    const st = dusen.length ? "❌" : gecen.length ? "✅" : ilgili.every((r) => durum(r) === "⏭️") ? "⏭️" : "⚠️";
    return {
      nodeId: c.nodeId, nodeName: c.nodeName, testCaseId: c.testCaseId, title: c.title, status: st,
      error: dusen.length ? `${dusen.length}/${ilgili.length} düştü: ${dusen.map((r) => r.title).join(", ").slice(0, 160)}` : "",
      note: `${gecen.length}/${ilgili.length} geçti (spec özeti)`,
      durationMs: ilgili.reduce((a, r) => a + (r.duration ?? 0), 0),
      spec: specler[0],
    };
  });
}
