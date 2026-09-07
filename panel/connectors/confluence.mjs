/**
 * Confluence connector — "docs" yeteneği.
 *
 * Kendi kimlik dosyası var ama boşsa Jira'nınkine düşer (aynı Atlassian
 * hesabı/token'ı genelde ikisini birden yetkilendiriyor) — asıl mantık
 * `panel/confluence.mjs`'te, bu dosya SADECE connector-registry uyarlaması
 * (bkz. jira.mjs/figma.mjs'in aynı ayrımı).
 */
import { credLabel, resolveCreds } from "./credentials.mjs";

export const key = "confluence";
export const label = "Confluence";
export const icon = "confluence";
export const capabilities = ["docs"];
export const credential = { file: ".confluence-credentials", vars: ["CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN"] };
export const credentialLabel = credLabel(credential.file, credential.vars) + " (yoksa Jira kimliği kullanılır)";

export const setupUrl = "https://id.atlassian.com/manage-profile/security/api-tokens";

export const setupFix = [
  "Ayrı bir kimlik istemiyorsan hiçbir şey yapma — Jira kimliği (JIRA_EMAIL/JIRA_TOKEN) otomatik kullanılır",
  "Ayrı bir hesap/site gerekiyorsa: Atlassian > Security > API tokens ile token üret",
  "printf 'CONFLUENCE_EMAIL=...\\nCONFLUENCE_TOKEN=...\\n' > ~/.confluence-credentials",
  "Farklı bir site/Data Center ise: CONFLUENCE_HOST ortam değişkenini ver",
];

function ownConfigured() {
  return resolveCreds(credential.file, credential.vars).ok;
}

async function jiraFallbackConfigured() {
  const { JIRA } = await import("../jira.mjs");
  return JIRA.available;
}

export async function configured() {
  return ownConfigured() || (await jiraFallbackConfigured());
}

/** Ağ istemez — sadece kimlik var mı bakar (Figma gibi kota derdi yok ama panel açılışında gereksiz çağrı istemiyoruz). */
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

/** "docs" yeteneği — şimdilik yalnızca varlık işareti, asıl iş panel/confluence.mjs'te. */
export const docs = {
  async available() { return configured(); },
};
