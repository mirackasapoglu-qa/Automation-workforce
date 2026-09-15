/**
 * Paketler deposu — kullanıcının test case'leri gruplamak için oluşturduğu
 * adlandırılmış koleksiyonlar (ör. "Regresyon paketi", "Validasyon paketi").
 *
 * tree.json'dan BİLEREK ayrı bir dosyada: paketler ağacın kendisi değil, ona
 * dair bir REFERANS listesi ({nodeId, testCaseId} çiftleri) — ağacın kendi
 * yazma/yedekleme mantığına (bkz. scope.mjs → writeTree) dokunmadan aynı
 * güvenli deseni (atomik yazma + tek kademe yedek) burada tekrarlıyoruz.
 *
 * İçerik doğrulanmaz: hangi nodeId/testCaseId'nin gerçekten var olduğu
 * istemcide, ağacın kendisiyle birlikte çözülür (bkz. packages.js →
 * resolvePackageItem). Kaynağı silinmiş bir referans burada sessizce
 * temizlenmez — o karar kullanıcıya ait (bkz. proje notları).
 *
 * Dosya: panel-data/scope/packages.json (+ her yazmada packages.bak.json)
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "panel-data", "scope");
const FILE = path.join(DIR, "packages.json");
const BAK = path.join(DIR, "packages.bak.json");

/** Dosya yoksa BOŞ liste — tree'nin aksine profilden tohumlanacak bir şey yok. */
export function readPackages() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.packages)) return parsed.packages;
    throw new Error("beklenmeyen bicim");
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Bozuk dosyayı EZME — yedeğe al, boş listeyle devam et.
      try { fs.mkdirSync(DIR, { recursive: true }); fs.copyFileSync(FILE, `${FILE}.bozuk-${Date.now()}`); } catch { /* yoksa gec */ }
    }
    return [];
  }
}

/** Atomik yazma + tek kademe yedek. Hata YUTULMAZ, çağırana fırlar. */
export function writePackages(packages) {
  if (!Array.isArray(packages)) throw new Error("paketler bir dizi olmalı");
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(packages, null, 1));
  fs.renameSync(tmp, FILE);
  return { savedAt: new Date().toISOString(), count: packages.length };
}

/**
 * Bir paketin ETKİN test case referansları — iç içe paketler dahil, tekrarsız.
 *
 * NEDEN SUNUCUDA DA VAR: paket koşumu bugüne kadar yalnızca Flowscope'tan
 * tetikleniyordu (`packages-run.js`, düğüm düğüm sıralı koşum). Panelin
 * "Koşumlar" sekmesinden de koşulabilmesi için sunucunun "bu pakette hangi
 * spec'ler var" sorusunu cevaplaması gerekiyor; istemciye sorup ona güvenmek,
 * whitelist güvenliğini istemciye devretmek olurdu.
 *
 * ⚠️ ÇEVRİM KORUMASI: paket paketi içerebiliyor. İstemci tarafı eklemede
 * çevrimi baştan engelliyor (`canNestPackage`), ama veri bir şekilde çevrimli
 * hale gelmişse burası sonsuz özyinelemeye düşmemeli — `guard` bunun için.
 *
 * @param {object[]} packages  tüm paketler
 * @param {string} id          çözülecek paketin id'si
 * @returns {{nodeId: string, testCaseId: string}[]}
 */
export function resolvePackageItems(packages, id, guard = new Set()) {
  if (guard.has(id)) return [];
  guard.add(id);
  const pkg = (packages ?? []).find((p) => p.id === id);
  if (!pkg) return [];

  const out = [];
  const gorulen = new Set();
  const ekle = (it) => {
    const key = `${it.nodeId}::${it.testCaseId}`;
    if (gorulen.has(key)) return;
    gorulen.add(key);
    out.push({ nodeId: it.nodeId, testCaseId: it.testCaseId });
  };

  for (const it of pkg.items ?? []) {
    if (it?.packageId) {
      for (const alt of resolvePackageItems(packages, it.packageId, guard)) ekle(alt);
    } else if (it?.nodeId && it?.testCaseId) {
      ekle(it);
    }
  }
  return out;
}

/**
 * Paketin case'lerini AĞAÇLA çözer: `{nodeId, nodeName, testCaseId, title,
 * automated, spec, nodeSpecs, steps, lastRun}` — ya da kaynağı silinmişse
 * `{missing:true}`. `GET /api/scope/package-cases` ve koşum sonu defter
 * yazımı (server → recordPackageRun) aynı listeyi kullanır; iki kopya
 * kaçınılmaz olarak sapardı.
 *
 * @param {object[]} tree
 * @param {object[]} packages
 * @param {string} id
 * @param {(tree: object[], id: string) => object|null} findNode
 */
export function resolvePackageCases(tree, packages, id, findNode) {
  const out = [];
  for (const it of resolvePackageItems(packages, id)) {
    const node = findNode(tree, it.nodeId);
    const tc = node ? (node.testCases ?? []).find((t) => t.id === it.testCaseId) : null;
    if (!node || !tc) { out.push({ nodeId: it.nodeId, nodeName: node?.name ?? "", testCaseId: it.testCaseId, missing: true }); continue; }
    out.push({
      nodeId: node.id,
      nodeName: node.name ?? "",
      testCaseId: tc.id,
      title: tc.title ?? "",
      automated: !!tc.automated,
      spec: tc.spec ?? null,
      nodeSpecs: node.runRef?.specs ?? [],
      steps: (tc.steps ?? []).map((st) => ({ action: st.action ?? "", expected: st.expected ?? "" })),
      lastRun: (tc.runs ?? []).at(-1) ?? null,
    });
  }
  return out;
}
