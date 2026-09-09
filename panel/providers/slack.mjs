/**
 * Slack sağlayıcısı — "chat" yeteneği (bildirim gönderme).
 *
 * KİMLİK: bot token'ı (`xoxb-…`) elle ya da OAuth v2 akışıyla (uygulama
 * kurulumu, bot izinleri). Doğrulama `auth.test` (kotasız, ucuz).
 * Bu projede aktif değil — profil `connectors.chat` ile açılır.
 */
import path from "node:path";
import { resolve, credLabel } from "../auth/credential-store.mjs";
import { ensureFresh } from "../auth/oauth2.mjs";

export const key = "slack";
export const label = "Slack";
export const icon = "slack";
export const order = 70;
export const capabilities = ["chat"];

export const auth = {
  apiKey: {
    file: ".slack-credentials",
    vars: [{ name: "SLACK_BOT_TOKEN", label: "Bot token (xoxb-…)", secret: true }],
    setupUrl: "https://api.slack.com/apps",
    steps: ["api.slack.com/apps > OAuth & Permissions ile bot token üret (chat:write)", "Token'ı buraya gir — kaydedince doğrulanır (auth.test)"],
  },
  oauth2: {
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

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = credLabel(credential.file, credential.vars);
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

const DATA_DIR = () => path.join(process.cwd(), "panel-data");
const creds = () => resolve(key, credential.vars, { file: credential.file });
export function configured() { return creds().ok; }

async function api(method, body) {
  await ensureFresh({ dataDir: DATA_DIR(), svc: key, cfg: auth.oauth2 }).catch(() => null);
  const c = creds();
  if (!c.ok) throw new Error("SLACK_BOT_TOKEN yok");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.values.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

export async function check() {
  if (!configured()) return { state: "off", detail: "kurulu değil — koşum/bulgu bildirimi kapalı", fix: setupFix };
  try {
    const j = await api("auth.test");
    return { state: "ok", detail: `${j.user} · ${j.team}`, fix: [] };
  } catch (e) {
    return { state: "warn", detail: String(e.message).slice(0, 50), fix: ["Token iptal edilmiş ya da scope eksik olabilir (chat:write)"] };
  }
}

export const chat = {
  async send(channel, text) { return api("chat.postMessage", { channel, text }); },
};
