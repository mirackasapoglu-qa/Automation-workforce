/**
 * Kimlik deposu — her sağlayıcının kimliğinin TEK çözüm noktası.
 *
 * Kaynaklar, öncelik sırasıyla:
 *   1) ORTAM DEĞİŞKENİ      — sunucuda (Dokploy) tek yol; tek seferlik denemeler
 *   2) PANEL KAYDI          — panel-data/credentials/<servis>.json (0600):
 *                             panelden girilen API anahtarı YA DA OAuth token'ı
 *                             (refresh token + son kullanma ile birlikte)
 *   3) DOSYA                — ~/.<servis>-credentials (yerel geliştirici alışkanlığı)
 *
 * NEDEN: eskiden token'lı servisler yalnızca env ya da dosya bekliyordu; sunucuda
 * dosya yazılamadığı için "Bağlan" düğmesi bir web sayfası linkinden ibaretti
 * (ölçüldü 2026-09-08). OAuth token'ları ayrı bir depoda (panel-data/oauth/)
 * duruyordu ve HİÇ yenilenmiyordu. Artık iki tür kayıt aynı yerde, aynı biçimde:
 *
 *   { kind: "apiKey"|"oauth2", vars: {NAME: value}, tokenType?, refreshToken?,
 *     expiresAt?, scope?, meta?, savedAt }
 *
 * Eski panel-data/oauth/<servis>.json okunurken buraya TAŞINIR (bir kez).
 *
 * `resolve()` SENKRON ve ucuzdur (üç küçük dosya okuması), çağrı anında
 * kullanılır — modül yüklenirken değil (Jira'nın açılışta donan kimliği
 * tam bu yüzden yeniden başlatma istiyordu). Yenileme (`ensureFresh`)
 * `auth/oauth2.mjs`'te: depo sağlayıcı bilmez.
 *
 * Bu dosya proje adı bilmez (`npm run panel:check`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCut } from "../connectors/cuts.mjs";

const safe = (s) => String(s ?? "").replace(/[^a-z0-9-]/gi, "");
export const storeDir = (root = process.cwd()) => path.join(root, "panel-data", "credentials");
const fileOf = (svc, root) => path.join(storeDir(root), `${safe(svc)}.json`);
const legacyOauthFile = (svc, root = process.cwd()) => path.join(root, "panel-data", "oauth", `${safe(svc)}.json`);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/** `~/.<ad>` dosyasını okur; yoksa/okunamazsa boş obje. Satır başına `DEGISKEN=deger`. */
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

/** İnsan tarafına gösterilecek kimlik satırı (env seçeneğini de SÖYLER — sunucuda tek yol o). */
export const credLabel = (dosyaAdi, vars) =>
  `${vars.join(" / ")} ortam değişkeni · panel kaydı · ya da ~/${dosyaAdi}`;

/** Kaynak adı → insan dili. */
export function sourceLabel(source) {
  return { env: "ortam değişkeni", store: "panel kaydı", oauth: "OAuth", file: "kimlik dosyası" }[source] ?? "yok";
}

/**
 * Panel kaydı. Yoksa eski OAuth deposuna bakar ve varsa TAŞIR.
 * @returns {object|null}
 */
export function stored(svc, root = process.cwd()) {
  const f = fileOf(svc, root);
  const cur = readJson(f);
  if (cur && typeof cur.vars === "object") return cur;
  const legacy = readJson(legacyOauthFile(svc, root));
  if (legacy && typeof legacy.vars === "object") {
    const { vars, tokenType, refreshToken, expiresAt, scope, obtainedAt, service, ...meta } = legacy;
    const rec = { kind: "oauth2", vars, tokenType: tokenType ?? "Bearer", refreshToken: refreshToken ?? null, expiresAt: expiresAt ?? null, scope: scope ?? null, meta, savedAt: obtainedAt ?? new Date().toISOString(), migratedFrom: "panel-data/oauth" };
    try { writeJson(f, rec); fs.unlinkSync(legacyOauthFile(svc, root)); } catch { /* tasinamadiysa okumaya devam */ }
    return rec;
  }
  return null;
}

/**
 * Kayıt yaz. `vars` boş olamaz; değerler string'e çevrilir ve kırpılır.
 * @param {string} svc
 * @param {{kind:"apiKey"|"oauth2", vars:object, tokenType?:string, refreshToken?:string|null, expiresAt?:string|null, scope?:string|null, meta?:object}} rec
 */
export function save(svc, rec, root = process.cwd()) {
  // Dosya adina donusecek: yalniz [a-z0-9-]. "../x" gibi bir ad temizlenip
  // kabul EDILMEZ, reddedilir — sessiz donusum yanlis dosyaya yazdirir.
  if (!/^[a-z0-9-]+$/i.test(String(svc ?? ""))) throw new Error("servis adı geçersiz");
  const vars = {};
  for (const [k, v] of Object.entries(rec?.vars ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`değişken adı geçersiz: ${k}`);
    const s = String(v ?? "").trim();
    if (s) vars[k] = s;
  }
  if (!Object.keys(vars).length) throw new Error("kaydedilecek kimlik değeri yok");
  const out = {
    kind: rec.kind === "oauth2" ? "oauth2" : "apiKey",
    vars,
    tokenType: rec.tokenType ?? (rec.kind === "oauth2" ? "Bearer" : null),
    refreshToken: rec.refreshToken ?? null,
    expiresAt: rec.expiresAt ?? null,
    scope: rec.scope ?? null,
    meta: rec.meta ?? {},
    savedAt: new Date().toISOString(),
  };
  writeJson(fileOf(svc, root), out);
  return { ok: true, savedAt: out.savedAt, kind: out.kind };
}

export function remove(svc, root = process.cwd()) {
  let removed = false;
  for (const f of [fileOf(svc, root), legacyOauthFile(svc, root)]) {
    try { fs.unlinkSync(f); removed = true; } catch { /* yoksa sorun degil */ }
  }
  return { ok: true, removed };
}

/**
 * Bir servisin kimliğini çözer — SENKRON, çağrı anında.
 *
 * @param {string} svc                  sağlayıcı anahtarı ("jira")
 * @param {string[]} vars               gereken değişken adları
 * @param {{file?: string, root?: string}} [opt]  dosya adı (varsayılan ~/.<svc>-credentials)
 * @returns {{values:object, ok:boolean, source:"env"|"store"|"oauth"|"file"|null,
 *   tokenType:string|null, kind:string|null, expiresAt:string|null, cut?:boolean}}
 */
export function resolve(svc, vars, { file = `.${safe(svc)}-credentials`, root = process.cwd() } = {}) {
  const bos = { values: {}, ok: false, source: null, tokenType: null, kind: null, expiresAt: null };
  if (isCut(svc)) return { ...bos, cut: true };
  const st = stored(svc, root);
  const fromFile = readCredFile(file);
  const values = {};
  let usedEnv = false;
  let usedStore = false;
  for (const v of vars) {
    if (process.env[v]) { values[v] = process.env[v]; usedEnv = true; }
    else if (st?.vars?.[v]) { values[v] = st.vars[v]; usedStore = true; }
    else if (fromFile[v]) values[v] = fromFile[v];
  }
  const ok = vars.every((v) => Boolean(values[v]));
  if (!ok) return { ...bos, values };
  const source = usedEnv ? "env" : usedStore ? (st.kind === "oauth2" ? "oauth" : "store") : "file";
  return {
    values,
    ok,
    source,
    tokenType: source === "oauth" ? (st.tokenType ?? "Bearer") : null,
    kind: usedStore ? st.kind : source === "env" ? "env" : "file",
    expiresAt: usedStore ? (st.expiresAt ?? null) : null,
  };
}
