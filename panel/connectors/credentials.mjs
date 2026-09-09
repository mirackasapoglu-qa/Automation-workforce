/**
 * UYUMLULUK SARMALAYICISI — asıl kimlik deposu `panel/auth/credential-store.mjs`.
 *
 * Eski çağıranlar (`panel/jira.mjs`, `panel/confluence.mjs`, `figma-render.mjs`,
 * `scripts/figma-*.mjs`) `resolveCreds(".<servis>-credentials", vars)` diyor.
 * Dosya adından sağlayıcı anahtarı türetilir (`.jira-credentials` → `jira`) ve
 * depoya yönlendirilir; böylece panelden girilen kimliği (panel kaydı) ve
 * OAuth token'ını bu çağıranlar da görür. Yeni kod doğrudan
 * `resolve(svc, vars)` kullanmalı.
 *
 * ⚠️ Dosya adı sağlayıcı anahtarıyla EŞLEŞMEYEN tek durum Claude
 * (`.anthropic-credentials` ↔ `claude-code`): `panel/ai/anthropic.mjs` bu yüzden
 * depoyu doğrudan çağırır, bu sarmalayıcıyı değil.
 */
import { resolve } from "../auth/credential-store.mjs";
export { readCredFile, credLabel } from "../auth/credential-store.mjs";

const serviceFromFile = (dosyaAdi) => String(dosyaAdi).replace(/^\./, "").replace(/-credentials$/, "");

/**
 * @param {string} dosyaAdi `.jira-credentials` gibi
 * @param {string[]} vars
 * @returns {{values:object, ok:boolean, source:string|null, tokenType:string|null}}
 */
export function resolveCreds(dosyaAdi, vars) {
  return resolve(serviceFromFile(dosyaAdi), vars, { file: dosyaAdi });
}
