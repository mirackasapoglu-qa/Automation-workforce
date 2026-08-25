/**
 * .env yükleyici — SIFIR BAĞIMLILIK.
 *
 * `dotenv`in yerini alıyor. Gerekçe: panel başka projelere taşınabilir bir ürün
 * olacak ve orada `npm i` çalıştırılmamış olabilir; dotenv `devDependencies`'te
 * durduğu için `npm i --omit=dev` yapan bir kurulumda panel açılmıyordu.
 * Node 24'te `process.loadEnvFile()` yerleşik (v20.12+).
 *
 * ÖLÇÜLEN İKİ DAVRANIŞ (2026-08-22):
 *  1) loadEnvFile mevcut ortam değişkenini EZMEZ — dotenv ile aynı. Yani
 *     `ALLOW_HOMEE_ORDERS=1 npx playwright test ...` çalışmaya devam eder.
 *     (Guard'ın çalışması buna bağlı olduğu için ölçmeden değiştirilmedi.)
 *  2) `.env` yoksa loadEnvFile **ENOENT fırlatır**; dotenv sessizce geçiyordu.
 *     Bu yüzden çağrı guard'lı: dosya yoksa uygulama yine açılır.
 */
import fs from "node:fs";
import path from "node:path";

let yuklendi = false;

/**
 * `.env`i bir kez yükler. Birden fazla çağrı zararsız.
 * @param {string} [dosya] varsayılan: çalışma dizinindeki .env
 * @returns {boolean} dosya bulunup yüklendiyse true
 */
export function loadEnv(dosya = path.join(process.cwd(), ".env")) {
  if (yuklendi) return true;
  if (typeof process.loadEnvFile !== "function") return false; // çok eski Node
  try {
    if (!fs.existsSync(dosya)) return false;
    process.loadEnvFile(dosya);
    yuklendi = true;
    return true;
  } catch {
    return false; // bozuk/okunamayan .env uygulamayı düşürmesin
  }
}

export default loadEnv;
