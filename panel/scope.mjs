/**
 * Kapsam ağacı deposu (Flowscope'un veri katmanının sunucu tarafı karşılığı).
 *
 * NEDEN SUNUCUDA: Flowscope'un tek kalıcılığı tarayıcı localStorage'ıydı. Yani
 * veri, onu girenin tarayıcı profilinde duruyordu; repoyu klonlayan boş ekran
 * görüyordu ve `persist()` hatayı sessizce yutuyordu (dokümante edilmiş
 * "yüksek veri kaybı riski"). Ağaç artık diskte, panelin yanında.
 *
 * ⚠️ Sessiz yutma TAŞINMADI: yazma başarısız olursa hata çağırana döner,
 * arayüz de bunu görünür şekilde gösterir.
 *
 * Dosya: panel-data/scope/tree.json  (+ her yazmada tree.bak.json)
 * Tek profil = tek proje; panel zaten profil başına bir örnek olarak çalışıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project.mjs";

const DIR = path.join(process.cwd(), "panel-data", "scope");
const FILE = path.join(DIR, "tree.json");
const BAK = path.join(DIR, "tree.bak.json");

const nowIso = () => new Date().toISOString();

/**
 * Boş ağaç yerine profildeki rota haritasından tohum üretir.
 *
 * Rota kuralları zaten "hangi sayfa hangi koşumla test edilir + hangi kartlara
 * bağlı" bilgisini taşıyor. Kapsam ağacını sıfırdan elle kurmak yerine bu
 * bilgiyi kullanıyoruz: kullanıcı ilk açılışta dolu ve bağlantılı bir ağaç görür.
 *
 * `runRef` alanı Flowscope şemasında yok; koşum köprüsü için taşınıyor ve
 * JSON turunda korunuyor (arayüz bilmediği alanları silmez).
 */
export function seedFromProfile() {
  let n = 0;
  const id = () => `n${++n}`;
  const mkJira = (key) => ({ id: `jira-${key}`, taskId: key, createdAt: nowIso(), analyses: [] });

  const node = (name, type, extra = {}) => ({
    id: id(),
    name,
    type,
    status: "⬜",
    notes: [],
    jiraTasks: [],
    resourceLinks: [],
    statusHistory: [],
    lastVerifiedAt: null,
    staleReviewDays: 30,
    linkTos: [],
    open: false,
    children: [],
    testCases: [],
    ...extra,
  });

  const rules = PROJECT.routes?.rules ?? [];
  const pages = rules.map((r) =>
    node(r.label ?? r.runId ?? "(isimsiz)", "page", {
      jiraTasks: (r.cards ?? []).map(mkJira),
      runRef: { runId: r.runId ?? null, specs: r.specs ?? [] },
    }),
  );

  const root = node(PROJECT.product ?? PROJECT.title ?? PROJECT.id, "module", { open: true });
  root.children = pages.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return [root];
}

/** Ağacı okur. Dosya yoksa profilden tohumlar ve YAZAR (ilk açılış). */
export function readTree() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { tree: parsed, seeded: false };
    if (Array.isArray(parsed?.tree)) return { tree: parsed.tree, seeded: false };
    throw new Error("beklenmeyen bicim");
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Bozuk dosyayı EZME — yedeğe al, sonra tohumla. (Flowscope burada
      // sessizce boş ağaçla devam ediyordu; veri o noktada kayboluyordu.)
      try { fs.mkdirSync(DIR, { recursive: true }); fs.copyFileSync(FILE, `${FILE}.bozuk-${Date.now()}`); } catch { /* yoksa gec */ }
    }
    const tree = seedFromProfile();
    writeTree(tree);
    return { tree, seeded: true };
  }
}

/** Atomik yazma + tek kademe yedek. Hata YUTULMAZ, çağırana fırlar. */
export function writeTree(tree) {
  if (!Array.isArray(tree)) throw new Error("ağaç bir dizi olmalı");
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tree, null, 1));
  fs.renameSync(tmp, FILE);
  return { savedAt: nowIso(), nodes: countNodes(tree) };
}

export function countNodes(tree) {
  let n = 0;
  (function walk(a) { for (const x of a ?? []) { n++; walk(x.children); } })(tree);
  return n;
}

// ---------------- koşum köprüsü ----------------
/** Ağaçta id'ye göre düğüm bulur. */
export function findNode(tree, id) {
  for (const n of tree ?? []) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

/** Sonraki serbest `tc`/`tcr` numarası — arayüzün sayaçlarıyla çakışmasın. */
function nextId(tree, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  (function walk(a) {
    for (const n of a ?? []) {
      for (const tc of n.testCases ?? []) {
        const m = re.exec(tc.id ?? "");
        if (m) max = Math.max(max, Number(m[1]));
        for (const r of tc.runs ?? []) {
          const m2 = re.exec(r.id ?? "");
          if (m2) max = Math.max(max, Number(m2[1]));
        }
      }
      walk(n.children);
    }
  })(tree);
  return `${prefix}${max + 1}`;
}

/**
 * Gerçek Playwright koşumunun sonucunu ağaca yazar.
 *
 * TASARIM: her spec dosyası, düğümün altında bir "otomatik test case"ine
 * karşılık gelir; her koşum o case'in `runs[]` kaydına eklenir. Böylece
 * Flowscope'un en değerli kuralı (R13/R14 — koşum kaydı yoksa "geçti"
 * seçilemez) otomatik testler için de doğal olarak geçerli olur.
 *
 * ⚠️ Düğümün KENDİ durumu DEĞİŞTİRİLMEZ. Kaynak sistemde de otomatik senkron
 * yok (R19): düğüm ✅ ama bir case ❌ ise arayüz uyarı gösterir, kararı insan
 * verir. Otomatik koşumun insanın verdiği durumu sessizce ezmesi, o uyarının
 * varlık sebebini ortadan kaldırırdı.
 *
 * @returns {{written: number, perSpec: object[]}} yazılan koşum sayısı
 */
export function applyRunResults({ nodeId, specs, results, durationMs, code = 0 }) {
  const { tree } = readTree();
  const node = findNode(tree, nodeId);
  if (!node) throw new Error(`Düğüm bulunamadı: ${nodeId}`);

  const at = nowIso();
  const perSpec = [];
  let written = 0;

  for (const spec of specs ?? []) {
    const rows = (results?.rows ?? []).filter((r) => r.file === spec);

    /**
     * Hiç satır yok. İki bambaşka durum:
     *  - koşum düştü (global-setup hatası, config sorunu) → UYARI kaydı yaz,
     *    sebebi de yaz. Sessizce hiçbir şey yazmamak, kullanıcının düğmeye
     *    basıp bir dakika bekleyip hiçbir şey görmemesi anlamına geliyordu.
     *  - koşum başarılı ama bu spec hiç koşmamış → kayıt yazmaya değmez.
     */
    if (!rows.length) {
      if (code !== 0) {
        const sebep = (results?.errors ?? [])[0] ?? `koşum ${code} koduyla düştü`;
        const kayit = {
          id: nextId(tree, "tcr"),
          at,
          status: "⚠️",
          note: `Test koşmadı — koşum düştü.\n${String(sebep).slice(0, 240)}`,
        };
        const baslik = `Otomatik: ${spec}`;
        let tcx = (node.testCases ?? []).find((x) => x.spec === spec || x.title === baslik);
        if (!tcx) {
          tcx = {
            id: nextId(tree, "tc"), title: baslik, spec, automated: true,
            steps: [], runs: [], status: "⬜", createdAt: at, updatedAt: at,
          };
          node.testCases = node.testCases ?? [];
          node.testCases.push(tcx);
        }
        tcx.runs.push(kayit);
        tcx.updatedAt = at;
        written++;
        perSpec.push({ spec, status: "⚠️", note: kayit.note });
      } else {
        perSpec.push({ spec, status: null, note: "bu spec için sonuç satırı yok" });
      }
      continue;
    }
    const failed = rows.filter((r) => r.status === "failed" || r.status === "timedOut");
    const passed = rows.filter((r) => r.status === "passed");
    const skipped = rows.filter((r) => r.status === "skipped");
    const status = failed.length ? "❌" : passed.length ? "✅" : "⚠️";

    const sure = `${((durationMs ?? rows.reduce((a, r) => a + (r.duration ?? 0), 0)) / 1000).toFixed(1)}s`;
    let note = `${passed.length}/${rows.length} geçti · ${sure}`;
    if (skipped.length) note += ` · ${skipped.length} atlandı`;
    if (failed.length) {
      note += `\nDÜŞEN: ${failed.map((r) => r.title).join(", ")}`;
      const firstErr = failed.find((r) => r.error)?.error;
      if (firstErr) note += `\n${firstErr.split("\n")[0].slice(0, 160)}`;
    }

    // Bu spec'in otomatik case'i var mı — yoksa oluştur.
    const baslik = `Otomatik: ${spec}`;
    let tc = (node.testCases ?? []).find((t) => t.spec === spec || t.title === baslik);
    if (!tc) {
      tc = {
        id: nextId(tree, "tc"),
        title: baslik,
        /** Otomatik case işareti: elle yazılmış case'lerden ayırt edilsin. */
        spec,
        automated: true,
        steps: [],
        runs: [],
        status: "⬜",
        createdAt: at,
        updatedAt: at,
      };
      node.testCases = node.testCases ?? [];
      node.testCases.push(tc);
    }
    tc.runs.push({ id: nextId(tree, "tcr"), at, status, note });
    tc.updatedAt = at;
    written++;
    perSpec.push({ spec, status, note });
  }

  if (written) writeTree(tree);
  return { written, perSpec };
}
