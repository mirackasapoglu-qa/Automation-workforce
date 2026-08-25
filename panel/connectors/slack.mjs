/**
 * Slack connector — "chat" yeteneği (bildirim gönderme).
 *
 * Jira/Linear ile aynı kalıp: kimlik `~/.slack-credentials`, doğrulama
 * `auth.test` (kotasız, ucuz). Bu projede aktif değil — profil `connectors.chat`
 * ile açılır.
 */
import { resolveCreds, credLabel } from "./credentials.mjs";

export const key = "slack";
export const label = "Slack";
export const icon = "slack";
export const capabilities = ["chat"];
export const credential = { file: ".slack-credentials", vars: ["SLACK_BOT_TOKEN"] };
export const credentialLabel = credLabel(credential.file, credential.vars);

export const setupFix = [
  "api.slack.com/apps > OAuth & Permissions ile bot token üret (chat:write)",
  "echo 'SLACK_BOT_TOKEN=xoxb-...' > ~/.slack-credentials && chmod 600 ~/.slack-credentials",
];

const creds = () => resolveCreds(credential.file, credential.vars);
export function configured() { return creds().ok; }

async function api(method, body) {
  const c = creds();
  if (!c.ok) throw new Error("SLACK_BOT_TOKEN yok");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.values.SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

export async function check() {
  if (!configured()) {
    return { state: "off", detail: "kurulu değil — koşum/bulgu bildirimi kapalı", fix: setupFix };
  }
  try {
    const j = await api("auth.test");
    return { state: "ok", detail: `${j.user} · ${j.team}`, fix: [] };
  } catch (e) {
    return { state: "warn", detail: String(e.message).slice(0, 50),
             fix: ["Token iptal edilmiş ya da scope eksik olabilir (chat:write)"] };
  }
}

export const chat = {
  async send(channel, text) { return api("chat.postMessage", { channel, text }); },
};
