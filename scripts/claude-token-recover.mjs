/**
 * Kurtarma: "panelden giriş" ekran dökümünden token'ı çıkarır.
 *
 * NEDEN: relay token'ı ekrandan okuyor ve CLI ekranı her koşumda biraz farklı
 * basıyor (metin parçalara bölünüyor, araya terminal dizileri giriyor).
 * Ayrıştırma tutmazsa token ÜRETİLMİŞ ama okunamamış olur; o durumda panel ham
 * ekranı `panel-data/claude/diag/<loginId>.txt` (0600) dosyasına yazıyor.
 * Bu script o dökümü panelin GÜNCEL ayrıştırıcısıyla yeniden okur — yani
 * ayrıştırıcı düzeldikçe eski dökümler de kurtarılabilir hâle gelir.
 *
 *   node scripts/claude-token-recover.mjs                    # en yeni dökümü dene
 *   node scripts/claude-token-recover.mjs <dosya>            # belirli döküm
 *   node scripts/claude-token-recover.mjs --yapi             # token'ı BASMAZ,
 *                                                            # yalnız maskeli yapı
 *
 * ⚠️ Token'ı ekrana basar. Kopyalayıp panele ("Token'ı kaydet") yapıştır,
 * başka yere yapıştırma. `--yapi` teşhis paylaşmak için: token maskelenir.
 */
import fs from "node:fs";
import path from "node:path";
import { tokenFromScreen, successOnScreen } from "../panel/auth/claude-accounts.mjs";

const diagDir = () => path.join(process.cwd(), "panel-data", "claude", "diag");

function enYeni() {
  let files = [];
  try { files = fs.readdirSync(diagDir()).filter((f) => f.endsWith(".txt")); } catch { return null; }
  const tam = files.map((f) => path.join(diagDir(), f));
  return tam.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

const args = process.argv.slice(2);
const yalnizYapi = args.includes("--yapi");
const dosya = args.find((a) => !a.startsWith("--")) ?? enYeni();

if (!dosya) {
  console.error(`Döküm bulunamadı: ${diagDir()} boş.`);
  console.error("Döküm yalnızca token üretilip ayrıştırılamadığında yazılır.");
  process.exit(1);
}

const raw = fs.readFileSync(dosya, "latin1");
const token = tokenFromScreen(raw, { exited: true });

console.log(`döküm : ${dosya} (${raw.length} bayt)`);
console.log(`başarı ekranı : ${successOnScreen(raw) ? "var" : "YOK — token hiç üretilmemiş olabilir"}`);

if (yalnizYapi) {
  // Teşhis paylaşımı: token ve uzun diziler maskeli, YAPI görünür.
  // ⚠️ ÖNCE maskele, SONRA ESC'i görünür yap: ters sırada `\e` metni uzun
  // dizinin parçası olup maskeye karışıyor ve yapı okunmaz hâle geliyor.
  const maskeli = raw
    .replace(/[A-Za-z0-9_-]{14,}/g, "<UZUN>")
    .replace(/\x1b/g, "\\e");
  console.log("\n--- maskeli yapı (son 800 karakter) ---");
  console.log(maskeli.slice(-800));
  process.exit(0);
}

if (!token) {
  console.error("\nToken ÇIKARILAMADI. `--yapi` ile maskeli yapıyı alıp ayrıştırıcıya bak.");
  process.exit(2);
}

console.log(`\n=== TOKEN (${token.length} karakter) — panele yapıştır, başka yere değil ===`);
console.log(token);
