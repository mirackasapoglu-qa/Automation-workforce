/**
 * Confluence sağlayıcısı — "docs" yeteneği.
 *
 * Kendi kimliği varsa onu, yoksa Jira'nınkini kullanır (aynı Atlassian
 * hesabı/token'ı genelde ikisini birden yetkilendiriyor). Asıl mantık
 * `panel/confluence.mjs`'te; bu dosya registry uyarlaması + kimlik bildirimi.
 */
import { resolve, credLabel } from "../auth/credential-store.mjs";

export const key = "confluence";
export const label = "Confluence";
export const icon = "confluence";
export const order = 35;
export const capabilities = ["docs"];

export const auth = {
  apiKey: {
    file: ".confluence-credentials",
    vars: [
      { name: "CONFLUENCE_EMAIL", label: "Atlassian e-posta" },
      { name: "CONFLUENCE_TOKEN", label: "API token", secret: true },
    ],
    setupUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    steps: [
      "Ayrı bir kimlik istemiyorsan hiçbir şey yapma — Jira kimliği otomatik kullanılır",
      "Ayrı hesap/site gerekiyorsa: Atlassian > Security > API tokens ile token üret ve buraya gir",
      "Farklı bir site/Data Center ise: CONFLUENCE_HOST ortam değişkenini ver",
    ],
  },
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = `${credLabel(credential.file, credential.vars)} (yoksa Jira kimliği kullanılır)`;
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

function ownConfigured() { return resolve(key, credential.vars, { file: credential.file }).ok; }

async function jiraFallbackConfigured() {
  const { JIRA } = await import("../jira.mjs");
  return JIRA.available;
}

export async function configured() {
  return ownConfigured() || (await jiraFallbackConfigured());
}

/** Ağ istemez — yalnızca kimlik var mı bakar. */
export async function check() {
  const own = ownConfigured();
  const jiraFallback = !own && (await jiraFallbackConfigured());
  if (!own && !jiraFallback) {
    return { state: "off", detail: "kimlik yok (Confluence'a özel ya da Jira üzerinden)", fix: setupFix };
  }
  return {
    state: "unknown",
    detail: own ? "kimlik var (kendi)" : "kimlik var (Jira üzerinden)",
    note: "Gerçek durum ancak bir tarama (Doküman Drift Radarı) çalıştığında ölçülür — burada ağa çıkılmaz.",
    fix: [],
  };
}

/** "docs" yeteneği — varlık işareti; asıl iş panel/confluence.mjs'te. */
export const docs = {
  async available() { return configured(); },
};
