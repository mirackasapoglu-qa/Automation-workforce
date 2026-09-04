/**
 * Elle koparılan bağlantılar — `panel-data/connector-cuts.json`.
 *
 * NEDEN: "bağlandı" bir durum göstergesiydi, anahtar değildi. Bir servisi
 * geçici olarak devre dışı bırakmanın tek yolu kimlik dosyasını taşımaktı;
 * bu hem geri alınması zahmetli hem de kaza riski taşıyan bir işlem
 * (2026-09-03 isteği: "istediğimde koparabilmem lazım").
 *
 * TASARIM: hiçbir şey SİLİNMEZ. Şalter yalnızca "bu servisi kullanma" der;
 * kimlik dosyası, OAuth token'ı ve oturumlar yerinde durur, geri açmak tek
 * tık. Bu yüzden kesme noktası da kimlik ÇÖZÜMÜ (`resolveCreds`) — depolanan
 * kimlik değil.
 *
 * Dosya biçimi: `{ "<connector>": "2026-09-03T19:00:00.000Z" }` — değer
 * koparılma anı; anahtarın varlığı "kopuk" demektir.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "panel-data", "connector-cuts.json");

/**
 * Süreç içi kopya. Diskten her seferinde okumak `resolveCreds` gibi sıcak bir
 * yolda gereksiz; dosyayı yalnızca bu modül yazdığı için tazeliği garanti.
 */
let CACHE = null;
const read = () => {
  if (CACHE) return CACHE;
  try { CACHE = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { CACHE = {}; }
  return CACHE;
};

/** @returns {boolean} servis elle koparıldı mı */
export const isCut = (key) => Boolean(key && Object.hasOwn(read(), key));

/** Koparılma anı (ISO) ya da null. */
export const cutAt = (key) => read()[key] ?? null;

/** Kopar (`cut=true`) ya da geri bağla (`cut=false`). */
export function setCut(key, cut) {
  const cur = { ...read() };
  if (cut) cur[key] = new Date().toISOString();
  else delete cur[key];
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 1));
  CACHE = cur;
  return { ok: true, key, cut: Boolean(cut), at: cur[key] ?? null };
}
