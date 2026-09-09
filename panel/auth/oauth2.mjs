/**
 * OAuth 2.0 Authorization Code akışı — sağlayıcı bilmez, yapılandırma dışarıdan.
 *
 *   authorizeUrl()       → izin ekranı (state + isteğe bağlı PKCE)
 *   handleCallback()     → code → token, kimlik deposuna yazar
 *   refreshAccessToken() → refresh token ile yeni access token (dönen refresh token'ı da saklar)
 *   ensureFresh()        → süresi dolmak üzereyse yeniler; aynı anda tek uçuş
 *   statusFor()          → arayüzün göreceği durum özeti
 *
 * NEDEN AYRI DOSYA: eski `oauth.mjs` sağlayıcı tablosunu kendi içinde tutuyordu
 * (yalnız Linear ve Slack) ve refresh token'ı saklayıp HİÇ kullanmıyordu —
 * Atlassian gibi bir saatlik token veren sağlayıcı bir saat sonra ölürdü.
 * Şimdi yapılandırma sağlayıcı dosyasında (`providers/<id>.mjs → auth.oauth2`),
 * akış burada, depo `credential-store.mjs`'te.
 *
 * Yapılandırma (`cfg`):
 *   { authorizeUrl, tokenUrl, scope, var, tokenType?, pkce?, authParams?,
 *     readToken?(json) → {token, extra}, appSetupUrl, appSetupSteps }
 *
 * Uygulama kaydı (client id/secret): `<SERVIS>_CLIENT_ID/SECRET` ortam
 * değişkeni ya da panel-data/oauth/clients.json (panelden tek seferlik kutu).
 *
 * `state` sunucu belleğinde, 10 dk ömürlü — CSRF'in tek koruması bu; süreç
 * yeniden başlarsa bekleyen akış düşer ("tekrar dene").
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as store from "./credential-store.mjs";

const clientsFile = (dataDir) => path.join(dataDir, "oauth", "clients.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });
}

export function clientCreds(dataDir, svc) {
  const up = String(svc).toUpperCase().replace(/-/g, "_");
  const env = { id: process.env[`${up}_CLIENT_ID`], secret: process.env[`${up}_CLIENT_SECRET`] };
  if (env.id && env.secret) return { ...env, source: "env" };
  const f = readJson(clientsFile(dataDir), {})[svc];
  if (f?.id && f?.secret) return { id: f.id, secret: f.secret, source: "file" };
  return null;
}

export function saveClientCreds(dataDir, svc, id, secret) {
  if (!id || !secret) throw new Error("client id ve secret zorunlu");
  const all = readJson(clientsFile(dataDir), {});
  all[svc] = { id: String(id).trim(), secret: String(secret).trim(), savedAt: new Date().toISOString() };
  writeJson(clientsFile(dataDir), all);
  return { ok: true, source: "file" };
}

/** Panelin dışarıdan görünen adresi → sağlayıcıya kayıtlı olması gereken geri dönüş adresi. */
export const redirectUri = (origin) => `${String(origin).replace(/\/+$/, "")}/api/oauth/callback`;

// ---------------------------------------------------------------- akış
const PENDING = new Map();
const STATE_TTL = 10 * 60 * 1000;
const cleanup = () => { const now = Date.now(); for (const [k, v] of PENDING) if (now - v.at > STATE_TTL) PENDING.delete(k); };
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function authorizeUrl({ dataDir, svc, cfg, origin }) {
  if (!cfg?.authorizeUrl) throw new Error(`${svc}: OAuth yapılandırması yok`);
  const c = clientCreds(dataDir, svc);
  if (!c) throw new Error(`${cfg.label ?? svc} için OAuth uygulaması kayıtlı değil (client id/secret yok)`);
  cleanup();
  const state = crypto.randomBytes(16).toString("hex");
  const pend = { svc, at: Date.now() };
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", c.id);
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("response_type", "code");
  if (cfg.scope) u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  if (cfg.pkce) {
    pend.verifier = b64url(crypto.randomBytes(32));
    u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(pend.verifier).digest()));
    u.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(cfg.authParams ?? {})) u.searchParams.set(k, v);
  PENDING.set(state, pend);
  return u.toString();
}

async function tokenRequest(cfg, params) {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`token yanıtı JSON değil (HTTP ${res.status}): ${text.slice(0, 120)}`); }
  if (!res.ok) throw new Error(`token alınamadı (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

/** Token yanıtını depo kaydına çevirir; önceki kaydın refresh token'ı, yenisi gelmezse korunur. */
function recordFrom(cfg, j, prev = null) {
  const picked = cfg.readToken ? cfg.readToken(j) : { token: j.access_token, extra: {} };
  if (!picked.token) throw new Error(`token yanıtında access_token yok: ${JSON.stringify(j).slice(0, 160)}`);
  return {
    kind: "oauth2",
    vars: { [cfg.var]: picked.token },
    tokenType: cfg.tokenType ?? "Bearer",
    refreshToken: j.refresh_token ?? prev?.refreshToken ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null,
    scope: j.scope ?? cfg.scope ?? null,
    meta: { ...(prev?.meta ?? {}), ...(picked.extra ?? {}) },
  };
}

/**
 * Callback: state doğrula → code'u token'a çevir → sakla.
 * @param {{dataDir:string, query:URLSearchParams, origin:string, cfgFor:(svc:string)=>object|null}} p
 */
export async function handleCallback({ dataDir, query, origin, cfgFor }) {
  const state = query.get("state");
  const code = query.get("code");
  const err = query.get("error");
  cleanup();
  const pend = state ? PENDING.get(state) : null;
  if (!pend) throw new Error("state eşleşmedi (bağlantı isteği zaman aşımına uğramış ya da sunucu yeniden başlamış olabilir — tekrar dene)");
  PENDING.delete(state);
  if (err) throw new Error(`sağlayıcı reddetti: ${err}${query.get("error_description") ? ` — ${query.get("error_description")}` : ""}`);
  if (!code) throw new Error("code gelmedi");

  const svc = pend.svc;
  const cfg = cfgFor(svc);
  if (!cfg) throw new Error(`${svc}: OAuth yapılandırması yok`);
  const c = clientCreds(dataDir, svc);
  if (!c) throw new Error(`${cfg.label ?? svc} için client id/secret yok`);

  const params = { grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), client_id: c.id, client_secret: c.secret };
  if (pend.verifier) params.code_verifier = pend.verifier;
  const j = await tokenRequest(cfg, params);
  const rec = recordFrom(cfg, j);
  store.save(svc, rec);
  return { svc, label: cfg.label ?? svc, expiresAt: rec.expiresAt };
}

/** Refresh token ile yeni access token; dönen refresh token (dönerse) eskisinin yerine yazılır. */
export async function refreshAccessToken({ dataDir, svc, cfg }) {
  const prev = store.stored(svc);
  if (!prev?.refreshToken) throw new Error(`${svc}: refresh token yok — yeniden bağlan`);
  const c = clientCreds(dataDir, svc);
  if (!c) throw new Error(`${svc}: client id/secret yok`);
  const j = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: prev.refreshToken, client_id: c.id, client_secret: c.secret });
  const rec = recordFrom(cfg, j, prev);
  store.save(svc, rec);
  return rec;
}

const INFLIGHT = new Map();

/**
 * Süresi `skewMs` içinde dolacaksa yeniler. Aynı servise eşzamanlı çağrılar tek
 * yenilemeyi bekler (iki çağrı iki refresh yaparsa dönen refresh token'lardan
 * biri geçersiz kalır — Atlassian rotasyon uyguluyor).
 * @returns {Promise<{refreshed:boolean, expiresAt:string|null, reason?:string}>}
 */
export async function ensureFresh({ dataDir, svc, cfg, skewMs = 5 * 60_000 }) {
  const rec = store.stored(svc);
  if (!rec || rec.kind !== "oauth2") return { refreshed: false, expiresAt: null, reason: "oauth kaydı yok" };
  if (!rec.expiresAt) return { refreshed: false, expiresAt: null, reason: "süresiz token" };
  const kalan = new Date(rec.expiresAt).getTime() - Date.now();
  if (kalan > skewMs) return { refreshed: false, expiresAt: rec.expiresAt };
  if (!rec.refreshToken) return { refreshed: false, expiresAt: rec.expiresAt, reason: "refresh token yok" };
  if (INFLIGHT.has(svc)) return INFLIGHT.get(svc);
  const p = refreshAccessToken({ dataDir, svc, cfg })
    .then((r) => ({ refreshed: true, expiresAt: r.expiresAt }))
    .finally(() => INFLIGHT.delete(svc));
  INFLIGHT.set(svc, p);
  return p;
}

/** Arayüz özeti. */
export function statusFor({ dataDir, svc, cfg, origin }) {
  if (!cfg?.authorizeUrl) return { supported: false };
  const c = clientCreds(dataDir, svc);
  const s = store.stored(svc);
  const connected = Boolean(s?.kind === "oauth2" && s?.vars?.[cfg.var]);
  return {
    supported: true,
    clientReady: Boolean(c),
    clientSource: c?.source ?? null,
    connected,
    connectedAt: connected ? s.savedAt ?? null : null,
    expiresAt: connected ? s.expiresAt ?? null : null,
    canRefresh: connected && Boolean(s.refreshToken),
    scope: s?.scope ?? cfg.scope ?? null,
    appSetupUrl: cfg.appSetupUrl ?? null,
    appSetupSteps: cfg.appSetupSteps ?? [],
    redirectUri: redirectUri(origin),
  };
}

/** Test/teşhis: bekleyen state sayısı. */
export const pendingCount = () => PENDING.size;
