/**
 * Kimlik dosyası okuyucu — TEK yer.
 *
 * NEDEN: aynı `KEY=value` ayrıştırması üç ayrı dosyada üç kez yazılmıştı
 * (jira.mjs::readCreds, preflight.mjs::figmaTokenExists, credLine). Yeni bir
 * servis eklerken dördüncüsünü yazmak zorunda kalmayalım.
 *
 * Konvansiyon: her servis `~/.<servis>-credentials` dosyasında, satır başına
 * bir `DEGISKEN=deger`. Ortam değişkeni her zaman dosyayı EZER — tek seferlik
 * denemeler için (`LINEAR_API_KEY=... npm run panel`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** `~/.<ad>` dosyasını okur; yoksa/okunamazsa boş obje. */
export function readCredFile(dosyaAdi) {
  const f = path.join(os.homedir(), dosyaAdi);
  const out = {};
  try {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* dosya yok: bos obje */ }
  return out;
}

/**
 * `.linear-credentials` → `linear`. OAuth deposu servis adıyla anahtarlanıyor.
 */
const serviceFromFile = (dosyaAdi) => dosyaAdi.replace(/^\./, "").replace(/-credentials$/, "");

/**
 * OAuth ile bağlanmış token'lar: `panel-data/oauth/<servis>.json`.
 * Dosyayı `panel/oauth.mjs` yazar; burada SADECE okunur (o modülü import
 * etmiyoruz: connector'lar sunucu koduna bağımlı olmasın).
 */
function readOauthStore(dosyaAdi) {
  const svc = serviceFromFile(dosyaAdi);
  const f = path.join(process.cwd(), "panel-data", "oauth", `${svc}.json`);
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return j && typeof j.vars === "object" ? j : null;
  } catch { return null; }
}

/**
 * Bir servisin kimliğini çözer. Sıra: **ortam > OAuth > dosya**.
 *
 * OAuth dosyanın ÜSTÜNDE: "Bağlan"a basmak bilinçli ve taze bir eylem, eski
 * bir `~/.<servis>-credentials` onu gölgelememeli. Ortam en üstte kalıyor —
 * tek seferlik denemeler (`LINEAR_API_KEY=... npm run panel`) ve sunucuda
 * elle verilen kimlik için.
 *
 * `tokenType`: OAuth token'ı gönderilirken kullanılacak şema. PAT ile OAuth
 * token'ının başlığı bazı serviste farklı (Linear PAT'ta şema yok, OAuth'ta
 * `Bearer`) — çağıran taraf bunu okuyup başlığı ona göre kurar.
 *
 * @returns {{values: object, ok: boolean, source: "env"|"oauth"|"file"|null, tokenType: string|null}}
 */
export function resolveCreds(dosyaAdi, vars) {
  const fromFile = readCredFile(dosyaAdi);
  const oauth = readOauthStore(dosyaAdi);
  const values = {};
  let usedEnv = false;
  let usedOauth = false;
  for (const v of vars) {
    if (process.env[v]) { values[v] = process.env[v]; usedEnv = true; }
    else if (oauth?.vars?.[v]) { values[v] = oauth.vars[v]; usedOauth = true; }
    else if (fromFile[v]) values[v] = fromFile[v];
  }
  const ok = vars.every((v) => Boolean(values[v]));
  const source = ok ? (usedEnv ? "env" : usedOauth ? "oauth" : "file") : null;
  return { values, ok, source, tokenType: source === "oauth" ? (oauth?.tokenType ?? "Bearer") : null };
}

/**
 * İnsan tarafına gösterilecek kimlik satırı. Ortam değişkeni seçeneğini de
 * SÖYLER: container'da (Dokploy) home dizininde dosya olmuyor, tek yol env —
 * satır sadece dosyayı yazınca kullanıcı orada tıkanıyordu.
 */
export const credLabel = (dosyaAdi, vars) =>
  `${vars.join(" / ")} ortam değişkeni ya da ~/${dosyaAdi}`;
