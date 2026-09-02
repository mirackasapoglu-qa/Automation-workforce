/**
 * OAuth katmanı — "Bağlan"a bas, izin ver, bitti.
 *
 * NEDEN: connector'lar kimliği elle üretilmiş token'dan okuyordu ve panel
 * kullanıcıyı `api.slack.com/apps` gibi GELİŞTİRİCİ sayfasına atıyordu; oradan
 * app oluşturup token üretmek gerekiyor ve insan haklı olarak "Claude
 * Desktop'taki gibi tek tıkla bağlanayım" diyor (2026-09-02).
 *
 * BU DOSYA SERVİS BİLMEZ: her servis `PROVIDERS` içinde birkaç satır veri.
 * Akış üç uçtan ibaret (server.mjs):
 *   GET  /api/oauth/<servis>/start     → sağlayıcının izin ekranına yönlendirir
 *   GET  /api/oauth/callback           → code'u token'a çevirir, saklar
 *   POST /api/oauth/<servis>/disconnect → sakladığını siler
 *
 * ⚠️ İKİ AŞAMALI: OAuth'ta "tek tık" ancak uygulamanın SAĞLAYICIDA bir kere
 * kaydedilmesiyle mümkün (client id + secret). Claude Desktop'ta o kaydı
 * Anthropic yapmış; burada bir kere biz yapıyoruz. Panel bunu da içeriden
 * sorar (`POST /api/oauth/<servis>/client`) — sonrasında bağlanmak tek tık.
 *
 * ⚠️ Token'lar `panel-data/oauth/` altında 0600 ile durur; panel-data
 * .gitignore'da. Sunucuda volume bağlanmazsa bağlantılar deploy'da uçar.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Desteklenen sağlayıcılar.
 *
 * `var`: token'ın hangi kimlik değişkeni olarak kaydedileceği — connector'ın
 * `credential.vars` içindeki adla AYNI olmak zorunda, yoksa resolveCreds
 * bulmaz. `tokenType`: OAuth token'ı gönderilirken kullanılacak şema; PAT ile
 * OAuth token'ının başlığı bazı serviste farklı (Linear PAT'ta şema YOK,
 * OAuth'ta `Bearer`).
 */
export const PROVIDERS = {
  linear: {
    label: "Linear",
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scope: "read,write",
    var: "LINEAR_API_KEY",
    tokenType: "Bearer",
    appSetupUrl: "https://linear.app/settings/api/applications/new",
    appSetupSteps: [
      "Linear > Settings > API > Applications > Create new application",
      "Callback URL alanına aşağıdaki adresi yapıştır",
      "Client ID ve Client Secret'ı buraya gir",
    ],
  },
  slack: {
    label: "Slack",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    // Bot token istiyoruz: v2 akışında `scope` bot izinleri demek.
    scope: "chat:write,chat:write.public,channels:read",
    var: "SLACK_BOT_TOKEN",
    tokenType: "Bearer",
    appSetupUrl: "https://api.slack.com/apps",
    appSetupSteps: [
      "api.slack.com/apps > Create New App > From scratch",
      "OAuth & Permissions > Redirect URLs'e aşağıdaki adresi ekle",
      "Basic Information > App Credentials'tan Client ID / Secret'ı buraya gir",
    ],
    /** Slack `{ok:false,error}` ile 200 dönebilir; token bot token'ıdır. */
    readToken(j) {
      if (j.ok === false) throw new Error(`Slack: ${j.error}`);
      return { token: j.access_token, extra: { team: j.team?.name, botUserId: j.bot_user_id } };
    },
  },
};

export const isSupported = (svc) => Object.hasOwn(PROVIDERS, svc);

// ---------------------------------------------------------------- depolama
const DIR = (dataDir) => path.join(dataDir, "oauth");
const storeFile = (dataDir, svc) => path.join(DIR(dataDir), `${svc}.json`);
const clientsFile = (dataDir) => path.join(DIR(dataDir), "clients.json");

const readJson = (f, d) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; }
};
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });
}

/**
 * Kayıtlı uygulama bilgisi (client id/secret). Ortam değişkeni önce:
 * `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET`. Sunucuda dosya yerine env
 * verilebilsin diye — kimlik konvansiyonunun aynısı.
 */
export function clientCreds(dataDir, svc) {
  const up = svc.toUpperCase();
  const env = { id: process.env[`${up}_CLIENT_ID`], secret: process.env[`${up}_CLIENT_SECRET`] };
  if (env.id && env.secret) return { ...env, source: "env" };
  const f = readJson(clientsFile(dataDir), {})[svc];
  if (f?.id && f?.secret) return { id: f.id, secret: f.secret, source: "file" };
  return null;
}

/** Panelden gelen client id/secret'ı kaydeder (tek seferlik kurulum). */
export function saveClientCreds(dataDir, svc, id, secret) {
  if (!isSupported(svc)) throw new Error(`Bilinmeyen servis: ${svc}`);
  if (!id || !secret) throw new Error("client id ve secret zorunlu");
  const all = readJson(clientsFile(dataDir), {});
  all[svc] = { id: String(id).trim(), secret: String(secret).trim(), savedAt: new Date().toISOString() };
  writeJson(clientsFile(dataDir), all);
  return { ok: true, source: "file" };
}

/** Saklanan token — connector'lar bunu resolveCreds üzerinden görür. */
export function stored(dataDir, svc) {
  return readJson(storeFile(dataDir, svc), null);
}

export function disconnect(dataDir, svc) {
  const f = storeFile(dataDir, svc);
  const vardi = fs.existsSync(f);
  try { fs.unlinkSync(f); } catch { /* yoksa sorun degil */ }
  return { ok: true, removed: vardi };
}

// ------------------------------------------------------------------- akış
/**
 * `state` sunucu belleğinde durur (diske yazmaya değmez, 10 dk ömürlü).
 * Callback'te eşleşmezse istek reddedilir — CSRF'in tek koruması bu.
 */
const PENDING = new Map();
const STATE_TTL = 10 * 60 * 1000;

const cleanup = () => {
  const now = Date.now();
  for (const [k, v] of PENDING) if (now - v.at > STATE_TTL) PENDING.delete(k);
};

/** Panelin dışarıdan görünen adresi — redirect_uri buradan türetilir. */
export function redirectUri(origin) {
  return `${String(origin).replace(/\/+$/, "")}/api/oauth/callback`;
}

/**
 * İzin ekranının adresi. `redirect_uri` sağlayıcıya KAYITLI olanla harfi
 * harfine aynı olmalı — uyuşmazsa sağlayıcı kendi ekranında hata verir.
 */
export function authorizeUrl(dataDir, svc, origin) {
  const p = PROVIDERS[svc];
  if (!p) throw new Error(`Bilinmeyen servis: ${svc}`);
  const c = clientCreds(dataDir, svc);
  if (!c) throw new Error(`${p.label} için OAuth uygulaması kayıtlı değil (client id/secret yok)`);

  cleanup();
  const state = crypto.randomBytes(16).toString("hex");
  PENDING.set(state, { svc, at: Date.now() });

  const u = new URL(p.authorizeUrl);
  u.searchParams.set("client_id", c.id);
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", p.scope);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(p.authParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Callback: state doğrula → code'u token'a çevir → sakla.
 * @returns {Promise<{svc:string,label:string}>}
 */
export async function handleCallback(dataDir, query, origin) {
  const state = query.get("state");
  const code = query.get("code");
  const err = query.get("error");
  cleanup();
  const pend = state ? PENDING.get(state) : null;
  if (!pend) throw new Error("state eşleşmedi (bağlantı isteği zaman aşımına uğramış olabilir — tekrar dene)");
  PENDING.delete(state);
  if (err) throw new Error(`sağlayıcı reddetti: ${err}`);
  if (!code) throw new Error("code gelmedi");

  const svc = pend.svc;
  const p = PROVIDERS[svc];
  const c = clientCreds(dataDir, svc);
  if (!c) throw new Error(`${p.label} için client id/secret yok`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
    client_id: c.id,
    client_secret: c.secret,
  });
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`token yanıtı JSON değil (HTTP ${res.status}): ${text.slice(0, 120)}`); }
  if (!res.ok) throw new Error(`token alınamadı (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 160)}`);

  const picked = p.readToken ? p.readToken(j) : { token: j.access_token, extra: {} };
  if (!picked.token) throw new Error(`token yanıtında access_token yok: ${JSON.stringify(j).slice(0, 160)}`);

  writeJson(storeFile(dataDir, svc), {
    service: svc,
    // resolveCreds bu adı arıyor — connector'ın credential.vars'ıyla aynı.
    vars: { [p.var]: picked.token },
    tokenType: p.tokenType ?? "Bearer",
    scope: j.scope ?? p.scope,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null,
    obtainedAt: new Date().toISOString(),
    ...picked.extra,
  });
  return { svc, label: p.label };
}

/**
 * Bir servisin panel arayüzüne gidecek durum özeti.
 * `clientReady` false ise "Bağlan" düğmesi işe yaramaz; panel bunun yerine
 * tek seferlik kurulum kutusunu gösterir.
 */
export function statusFor(dataDir, svc, origin) {
  const p = PROVIDERS[svc];
  if (!p) return { supported: false };
  const c = clientCreds(dataDir, svc);
  const s = stored(dataDir, svc);
  return {
    supported: true,
    clientReady: Boolean(c),
    clientSource: c?.source ?? null,
    connected: Boolean(s?.vars?.[p.var]),
    connectedAt: s?.obtainedAt ?? null,
    scope: s?.scope ?? p.scope,
    appSetupUrl: p.appSetupUrl,
    appSetupSteps: p.appSetupSteps ?? [],
    redirectUri: redirectUri(origin),
  };
}
