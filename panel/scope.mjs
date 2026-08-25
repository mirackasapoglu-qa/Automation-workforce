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
