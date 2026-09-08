/**
 * Kart → spec eşlemesi ve panel içi override'ı.
 *
 * KAYNAK VERİ PROFİLDE: `panel/projects/<proje>.mjs → routes.cardSpecs`.
 * Panelden yapılan düzenlemeler oraya YAZILMAZ; `panel-data/card-specs.json`
 * dosyasına düşer ve profille BİRLEŞİR (override kazanır).
 *
 * NEDEN kaynak dosyaya yazmıyoruz: profil bir kaynak dosya ve elle yazılmış
 * yorumlar taşıyor. Panelin çalışma anında regex'le JS gövdesini kesip biçmesi
 * sessiz bozulma riski — bir virgül hatası paneli AÇILIŞTA düşürür (aynı tuzağa
 * `@anthropic-ai/sdk` statik import'unda düşülmüştü). Override dosyası ise
 * bozulsa bile okunamadığında profil devreye girer.
 *
 * Kalıcı hale getirmek isteyen kişi için `snippet()` profile yapıştırılacak
 * metni üretir — yani panel bir "taslak", profil "gerçek" kalır.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project.mjs";

const FILE = path.join(process.cwd(), "panel-data", "card-specs.json");

/** Profildeki eşleme (dokunulmaz). */
export const PROFILE_CARD_SPECS = PROJECT.routes.cardSpecs ?? {};

/** Panelden kaydedilmiş override'lar. Okunamıyorsa boş — profil geçerli olur. */
export function readOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Profil + override birleşimi. `runsForCard` bunu kullanır. */
export function cardSpecs() {
  return { ...PROFILE_CARD_SPECS, ...readOverrides() };
}

/**
 * Tek kartın eşlemesini kaydeder.
 * @param {string} key kart anahtarı (örn. PROJ-7040)
 * @param {string[]} specs spec dosya adları; BOŞ dizi "bu kartın testi yok"
 *   demektir ve profildeki eşlemeyi de bilinçli olarak kapatır.
 */
export function setMapping(key, specs) {
  const ov = readOverrides();
  ov[key] = [...new Set(specs)];
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(ov, null, 2));
  return ov[key];
}

/** Override'ı siler — kart profildeki hâline döner. */
export function clearMapping(key) {
  const ov = readOverrides();
  if (!(key in ov)) return false;
  delete ov[key];
  fs.writeFileSync(FILE, JSON.stringify(ov, null, 2));
  return true;
}

/** Bir kartın eşlemesi ve NEREDEN geldiği (arayüz bunu gösteriyor). */
export function mappingFor(key) {
  const ov = readOverrides();
  if (key in ov) return { key, specs: ov[key], source: "panel" };
  if (key in PROFILE_CARD_SPECS)
    return { key, specs: PROFILE_CARD_SPECS[key], source: "profil" };
  return { key, specs: [], source: "yok" };
}

/** Tüm eşleme, kaynak bilgisiyle. */
export function listMapping() {
  const merged = cardSpecs();
  return Object.keys(merged)
    .sort()
    .map((key) => mappingFor(key));
}

/**
 * Profile yapıştırılacak metin. Yalnızca override'ları basar: profilde zaten
 * doğru duran satırları tekrar yazdırmak, kopyalayan kişiyi mevcut yorumları
 * silmeye zorluyordu.
 */
export function snippet() {
  const ov = readOverrides();
  const keys = Object.keys(ov).sort();
  if (!keys.length) return "";
  const lines = keys.map((k) => {
    const specs = ov[k].map((s) => `"${s}"`).join(", ");
    return `    "${k}": [${specs}],`;
  });
  return [
    "// panel/projects/" + PROJECT.id + ".mjs → routes.cardSpecs içine:",
    ...lines,
  ].join("\n");
}
