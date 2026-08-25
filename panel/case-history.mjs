/**
 * Case koşum defteri — `panel-data/case-history.json`.
 *
 * NEDEN AYRI MODÜL (2026-08-22): defter yalnızca `server.mjs` içinde yaşıyordu ve
 * `mergeHistory()` sadece PANELDEN tetiklenen koşumların sonunda çağrılıyordu.
 * Sonuç: CLI'dan (`npx playwright test ...`) koşulan her şey ölçülmüş olmasına
 * rağmen deftere hiç girmiyordu — panelin "Case'ler" sekmesi o case'leri
 * "hiç koşulmamış" gösteriyordu. Artık `scripts/merge-case-history.mjs` de aynı
 * fonksiyonu çağırıyor; tek uygulama, iki giriş noktası.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "panel-data");

// ---------------- case gecmisi ----------------
/**
 * Her kosum sonunda results.json'dan okunup BIRLESTIRILIR. Boylece tek bir case'i
 * kosmak digerlerinin durumunu silmez; panelin "Case'ler" sekmesi her zaman
 * her case icin en son bilinen sonucu gosterir.
 */
const HISTORY = path.join(DATA_DIR, "case-history.json");

/** Case basina saklanacak kosum sayisi. Kararsizlik ancak birikimle gorulur. */
const HISTORY_KEEP = Number(process.env.HISTORY_KEEP || 20);

/**
 * Kayit ESKIDEN case basina TEK snapshot tutuyordu — her kosum oncekini eziyordu.
 * 2026-08-20/21'de tam bu yuzden yanildik: sabah "tekrarlamadi", ogleden sonra
 * "tekrarladi" ve arada bilgi hicbir yerde durmuyordu. Artik `runs` dizisi var.
 *
 * Eski format ({status,at,...}) okunurken tek elemanli `runs`'a tasiniyor —
 * 77 mevcut kayit kaybolmuyor.
 */
export function readHistory() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(HISTORY, "utf8"));
  } catch {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && Array.isArray(v.runs)) out[k] = v;
    else if (v && v.status) out[k] = { runs: [v] };   // eski format
  }
  return out;
}

/** Son kosumdaki durum — eski `statusOf` cagiranlar icin ayni sekli korur. */
export function lastOf(entry) {
  return entry?.runs?.length ? entry.runs[entry.runs.length - 1] : null;
}

/**
 * Kararsizlik ozeti: son N kosumda kac kez basarisiz oldu.
 * `flaky` = hem gecmis hem basarisiz kayit varsa true.
 */
/**
 * 0ms suren, hata mesaji olmayan "failed" kaydi = test HIC KOSMADI
 * (kesilen kosum, ya da kapi suresi dolmus ortam). Bunu orana katmak
 * gercek olmayan bir tekrarlama uretiyor — 2026-08-21'de bilinen bir hata
 * kaydini tam bu yuzden yanlislikla "kararsiz" gosterdi. Sayilmaz, ama silinmez.
 */
const unusable = (r) => r.status === "failed" && !r.durationMs && !r.error;

export function historyStats(entry) {
  const all = entry?.runs ?? [];
  if (!all.length) return null;
  const runs = all.filter((r) => !unusable(r) && r.status !== "skipped");
  const dropped = all.length - runs.length;
  if (!runs.length) return { runs: 0, failed: 0, passed: 0, rate: "—", flaky: false, dropped,
                             firstAt: all[0].at, lastAt: all[all.length - 1].at };
  const bad = runs.filter((r) => r.status === "failed" || r.status === "known").length;
  const good = runs.filter((r) => r.status === "passed").length;
  return {
    runs: runs.length,
    failed: bad,
    passed: good,
    rate: `${bad}/${runs.length}`,
    flaky: bad > 0 && good > 0,
    dropped,
    firstAt: runs[0].at,
    lastAt: runs[runs.length - 1].at,
  };
}

export function mergeHistory() {
  const res = lastResults();
  if (!res?.rows?.length) return;
  const h = readHistory();
  /*
   * AYNI KOŞUM İKİ KEZ İŞLENMESİN. Merge hem panelden hem `npm run history:merge`
   * ile çağrılabiliyor; `results.json` değişmediği için ikinci çağrı aynı koşumu
   * tekrar deftere yazıyordu (ölçüldü 2026-08-22: 21 case iki kez kaydedildi ve
   * kararsızlık oranı sahte şekilde bozuldu). Koşumun kendi `startTime`'ı kimlik
   * olarak saklanıyor; aynı damga varsa satır atlanır.
   */
  const runAt = res.startedAt ?? "";
  let added = 0;
  let already = 0;
  for (const r of res.rows) {
    /*
     * ÖLÇÜLMEMİŞ SATIRI DEFTERE YAZMA. `results.json` her zaman gerçek bir
     * koşumdan gelmiyor: `playwright test --list` de dosyayı EZİYOR ve testleri
     * sonuçsuz (results: []) yazıyor. Ölçüldü 2026-08-22 — bu satırlar deftere
     * `status:"failed", durationMs:0` olarak girdi ve gerçek yeşil koşumu
     * gölgeledi. `unusable()` bunları orana katmıyordu ama "son durum" olarak
     * yine de kırmızı görünüyorlardı.
     */
    if (r.status === "unknown") continue;
    const status =
      r.status === "passed"
        ? "passed"
        : r.status === "skipped"
          ? "skipped"
          : r.status === "interrupted"
            ? "interrupted"        // kosum kesildi — olcum degil
            : r.expected === "failed"
              ? "known"            // test.fail() isaretli ve hata TEKRARLADI
              : "failed";
    const key = `${r.file}||${r.title}`;
    const entry = (h[key] ??= { runs: [] });
    if (runAt && entry.runs.some((x) => x.runAt === runAt)) {
      already++;
      continue; // zaten işlenmiş
    }
    added++;
    entry.runs.push({
      status,
      runAt,
      at: new Date().toISOString(),
      durationMs: r.duration ?? 0,
      error: r.error ? String(r.error).slice(0, 200) : "",
    });
    // Ekleyerek buyur ama sinirsiz degil: son HISTORY_KEEP kosum yeter.
    if (entry.runs.length > HISTORY_KEEP) entry.runs = entry.runs.slice(-HISTORY_KEEP);
  }
  fs.writeFileSync(HISTORY, JSON.stringify(h, null, 2));
  return { added, already, runAt };
}

// ---------------- son kosum sonuclari ----------------
export function lastResults() {
  const f = path.join(ROOT, "test-results", "results.json");
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, "utf8"));
  const rows = [];
  const walk = (suite, file) => {
    const fp = suite.file || file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1] ?? {};
        rows.push({
          file: (fp || "").replace(/^tests\//, ""),
          title: spec.title,
          status: last.status ?? "unknown",
          expected: t.expectedStatus,
          duration: last.duration ?? 0,
          error: (last.error?.message ?? "").split("\n").slice(0, 4).join("\n"),
        });
      }
    }
    for (const c of suite.suites ?? []) walk(c, fp);
  };
  for (const s of raw.suites ?? []) walk(s, s.file);
  return {
    startedAt: raw.stats?.startTime ?? null,
    /**
     * Kosum HIC test calistirmadan dustuyse (ornek: global-setup hatasi)
     * `rows` bos kalir ve tek ipucu burada durur. Cagiran taraf bunu
     * gostermezse kullanici "hicbir sey olmadi" saniyor.
     */
    errors: (raw.errors ?? []).map((e) => String(e.message ?? "").split("\n").slice(0, 3).join(" ")),
    rows,
    counts: {
      total: rows.length,
      passed: rows.filter((r) => r.status === "passed").length,
      failed: rows.filter((r) => r.status === "failed" || r.status === "timedOut").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
    },
  };
}
