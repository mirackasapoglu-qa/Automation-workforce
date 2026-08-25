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
 * Bir servisin kimliğini çözer. Ortam > dosya sırası.
 * @returns {{values: object, ok: boolean, source: "env"|"file"|null}}
 */
export function resolveCreds(dosyaAdi, vars) {
  const fromFile = readCredFile(dosyaAdi);
  const values = {};
  let usedEnv = false;
  for (const v of vars) {
    if (process.env[v]) { values[v] = process.env[v]; usedEnv = true; }
    else if (fromFile[v]) values[v] = fromFile[v];
  }
  const ok = vars.every((v) => Boolean(values[v]));
  return { values, ok, source: ok ? (usedEnv ? "env" : "file") : null };
}

/** İnsan tarafına gösterilecek kimlik satırı: "~/.jira-credentials → JIRA_EMAIL / JIRA_TOKEN" */
export const credLabel = (dosyaAdi, vars) => `~/${dosyaAdi} → ${vars.join(" / ")}`;
