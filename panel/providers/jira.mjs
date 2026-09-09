/**
 * Jira sağlayıcısı — "tracker" yeteneği.
 *
 * Buradaki iş SADECE uyarlama + kimlik bildirimi: Jira'ya özgü mantık (ADF,
 * JQL, transition eşleme) `panel/jira.mjs`'te kalır.
 *
 * KİMLİK: Atlassian API token'ı (e-posta + token, Basic). Panelden "Bağlan…"
 * kutusuyla girilebilir (auth/credential-store), sunucuda env ile gelir.
 * Atlassian 3LO (OAuth) Faz 2'de: burada `auth.oauth2` yapılandırması eklenir,
 * `panel/jira.mjs` taban adresini `api.atlassian.com/ex/jira/<cloudid>`e çevirir.
 */
import { credLabel } from "../auth/credential-store.mjs";

export const key = "jira";
export const label = "Jira";
export const icon = "jira";
export const order = 30;
export const capabilities = ["tracker"];

export const auth = {
  apiKey: {
    file: ".jira-credentials",
    vars: [
      { name: "JIRA_EMAIL", label: "Atlassian e-posta" },
      { name: "JIRA_TOKEN", label: "API token", secret: true },
    ],
    setupUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    steps: [
      "Atlassian > Security > API tokens ile token üret",
      "E-posta ve token'ı buraya gir — kaydedince doğrulanır (whoami)",
      "Sunucuda alternatif: JIRA_EMAIL / JIRA_TOKEN ortam değişkeni",
    ],
  },
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = credLabel(credential.file, credential.vars);
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

export async function configured() {
  const { JIRA } = await import("../jira.mjs");
  return JIRA.available;
}

/** Ağ ister — registry 10 dk önbellekliyor. */
export async function check() {
  const { whoami, JIRA, CRED_HINT } = await import("../jira.mjs");
  if (!JIRA.available) return { state: "off", detail: CRED_HINT, fix: setupFix };
  try {
    const me = await whoami();
    return {
      state: "ok",
      detail: `${me.name} · ${JIRA.project}`,
      note: `proje ${JIRA.project} · epic ${JIRA.epic} · ${JIRA.host}`,
      fix: [],
    };
  } catch (e) {
    return {
      state: "warn",
      detail: String(e.message).slice(0, 50),
      fix: ["Token süresi dolmuş olabilir — Atlassian'da yeniden üret", "Ağ/VPN kontrolü: JIRA_HOST erişilebilir mi"],
    };
  }
}

/** "tracker" yeteneği — Linear ile aynı imza; çağıran hangisi olduğunu bilmez. */
export const tracker = {
  keyPattern: /^[A-Z][A-Z0-9]+-\d+$/,
  async whoami() { return (await import("../jira.mjs")).whoami(); },
  async statusByKeys(keys) { return (await import("../jira.mjs")).statusByKeys(keys); },
  async listIssues(view, limit) { return (await import("../jira.mjs")).getCards(view, limit); },
  async getIssue(k) { return (await import("../jira.mjs")).getCard(k); },
  async comment(k, text) { return (await import("../jira.mjs")).postComment(k, text); },
  async createIssue(input) { return (await import("../jira.mjs")).createBug(input); },
  async transition(k, id, comment) { return (await import("../jira.mjs")).transition(k, id, comment); },
  async issueUrl(k) { return `${(await import("../jira.mjs")).JIRA.host}/browse/${k}`; },
};
