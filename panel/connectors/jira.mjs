/**
 * Jira connector — mevcut `panel/jira.mjs` katmanının connector arayüzüne sarılmış hali.
 *
 * Buradaki iş SADECE uyarlama: Jira'ya özgü mantık (ADF, JQL, transition eşleme)
 * jira.mjs'de kalır. Bu dosya "tracker" yeteneğinin Jira uygulamasıdır.
 */
import { credLabel } from "./credentials.mjs";

export const key = "jira";
export const label = "Jira";
export const icon = "jira";
export const capabilities = ["tracker"];
export const credential = { file: ".jira-credentials", vars: ["JIRA_EMAIL", "JIRA_TOKEN"] };
export const credentialLabel = credLabel(credential.file, credential.vars);

/** Token uretme sayfasi — panel "kimlik" satirini buraya link yapar. */
export const setupUrl = "https://id.atlassian.com/manage-profile/security/api-tokens";

export const setupFix = [
  "Atlassian > Security > API tokens ile token üret",
  "printf 'JIRA_EMAIL=...\\nJIRA_TOKEN=...\\nJIRA_HOST=https://...atlassian.net\\n' > ~/.jira-credentials",
  "Sunucuda (container) home dizini boş: aynı değerleri ORTAM DEĞİŞKENİ olarak ver",
];

export async function configured() {
  const { JIRA } = await import("../jira.mjs");
  return JIRA.available;
}

/** Ağ ister — registry 10 dk önbellekliyor. */
export async function check() {
  const { whoami, JIRA } = await import("../jira.mjs");
  if (!JIRA.available) {
    const { CRED_HINT } = await import("../jira.mjs");
    return { state: "off", detail: CRED_HINT, fix: setupFix };
  }
  try {
    const me = await whoami();
    return {
      state: "ok",
      detail: `${me.name} · ${JIRA.project}`,
      note: `proje ${JIRA.project} · epic ${JIRA.epic} · ${JIRA.host} · kimlik: ${JIRA.credSource === "env" ? "ortam değişkeni" : "~/.jira-credentials"}`,
      fix: [],
    };
  } catch (e) {
    return {
      state: "warn",
      detail: String(e.message).slice(0, 50),
      fix: ["Token süresi dolmuş olabilir — Atlassian'da yeniden üret",
            "Ağ/VPN kontrolü: JIRA_HOST erişilebilir mi"],
    };
  }
}

/**
 * "tracker" yeteneği. Kapsam ağacı ve verdict kodu ARTIK Jira'yı doğrudan
 * çağırmaz; bu arayüzü çağırır. Linear connector'ı da aynı imzayı sunar.
 */
export const tracker = {
  /** Kart anahtarı biçimi — ağaçtaki "hatalı için kart zorunlu" kuralı bunu doğrular. */
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
