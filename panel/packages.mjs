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
