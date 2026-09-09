/**
 * Linear sağlayıcısı — Jira ile AYNI "tracker" arayüzü.
 *
 * NEDEN MCP değil düz API: panel bağımsız bir Node sunucusu, Claude Code'un MCP
 * oturumuna erişemez. Linear'ın GraphQL API'si tek uçtan her şeyi veriyor.
 *
 * KİMLİK: kişisel API anahtarı (`lin_api_…`, şema OLMADAN gönderilir) ya da
 * OAuth access token'ı (`Bearer`). Hangisi olduğunu depo `tokenType` ile söyler.
 * OAuth token'ı süreliyse her çağrıdan önce `ensureFresh` yeniler.
 *
 * Bu projede AKTİF DEĞİL: tracker'ı Linear olan bir profil `connectors.tracker`
 * ile açar, çekirdekte tek satır değişmez.
 */
import path from "node:path";
import { resolve, credLabel } from "../auth/credential-store.mjs";
import { ensureFresh } from "../auth/oauth2.mjs";

export const key = "linear";
export const label = "Linear";
export const icon = "linear";
export const order = 50;
export const capabilities = ["tracker"];

export const auth = {
  apiKey: {
    file: ".linear-credentials",
    vars: [{ name: "LINEAR_API_KEY", label: "Kişisel API anahtarı (lin_api_…)", secret: true }],
    setupUrl: "https://linear.app/settings/api",
    steps: ["Linear > Settings > Security & access > Personal API keys", "Anahtarı buraya gir — kaydedince doğrulanır (viewer)"],
  },
  oauth2: {
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
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = credLabel(credential.file, credential.vars);
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

const API = "https://api.linear.app/graphql";
const DATA_DIR = () => path.join(process.cwd(), "panel-data");
const creds = () => resolve(key, credential.vars, { file: credential.file });

export function configured() { return creds().ok; }

async function gql(query, variables = {}) {
  await ensureFresh({ dataDir: DATA_DIR(), svc: key, cfg: auth.oauth2 }).catch(() => null);
  const c = creds();
  if (!c.ok) throw new Error("LINEAR_API_KEY yok");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: c.tokenType ? `${c.tokenType} ${c.values.LINEAR_API_KEY}` : c.values.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

export async function check() {
  if (!configured()) {
    return { state: "off", detail: "kurulu değil — kart okuma/yazma başka tracker'da", fix: setupFix };
  }
  try {
    const d = await gql("{ viewer { name email } organization { name } }");
    return { state: "ok", detail: `${d.viewer.name} · ${d.organization.name}`, note: "Linear GraphQL API — panel yalnızca doğrulama çağrısı yapar", fix: [] };
  } catch (e) {
    return { state: "warn", detail: String(e.message).slice(0, 50), fix: ["API anahtarı iptal edilmiş olabilir — Linear'da yeniden üret"] };
  }
}

/** Jira sağlayıcısıyla AYNI imza. */
export const tracker = {
  keyPattern: /^[A-Z][A-Z0-9]+-\d+$/,
  async whoami() {
    const d = await gql("{ viewer { name email } }");
    return { name: d.viewer.name, email: d.viewer.email };
  },
  async statusByKeys(keys) {
    const list = (keys ?? []).filter(Boolean);
    if (!list.length) return {};
    const out = {};
    await Promise.all(list.map(async (k) => {
      try {
        const r = await gql(`query($id:String!){ issue(id:$id){ identifier title state{ name type } } }`, { id: k });
        out[k] = { found: true, statusName: r.issue.state.name, statusCategory: r.issue.state.type, summary: r.issue.title };
      } catch { out[k] = { found: false, statusName: "", statusCategory: "", summary: "" }; }
    }));
    return out;
  },
  async listIssues(view, limit = 50) {
    const d = await gql(
      `query($n:Int!){ issues(first:$n, orderBy:updatedAt){ nodes{ identifier title state{name} assignee{name} updatedAt } } }`,
      { n: limit },
    );
    return { cards: d.issues.nodes.map((i) => ({ key: i.identifier, summary: i.title, status: i.state.name, assignee: i.assignee?.name ?? null, updated: i.updatedAt })) };
  },
  async getIssue(k) {
    const d = await gql(
      `query($id:String!){ issue(id:$id){ identifier title description state{name} comments{nodes{body user{name} createdAt}} } }`,
      { id: k },
    );
    const i = d.issue;
    return {
      key: i.identifier, summary: i.title, description: i.description ?? "", status: i.state.name,
      comments: i.comments.nodes.map((c) => ({ author: c.user?.name ?? "?", body: c.body, created: c.createdAt })),
    };
  },
  async comment(k, text) {
    const d = await gql(`mutation($id:String!,$b:String!){ commentCreate(input:{issueId:$id, body:$b}){ success } }`, { id: k, b: text });
    return d.commentCreate;
  },
  async createIssue({ title, description, teamId }) {
    const d = await gql(
      `mutation($t:String!,$d:String,$team:String!){ issueCreate(input:{title:$t, description:$d, teamId:$team}){ success issue{ identifier } } }`,
      { t: title, d: description ?? "", team: teamId },
    );
    return { key: d.issueCreate.issue.identifier };
  },
  async transition() { throw new Error("Linear'da statü geçişi stateId ile yapılır — proje profiline eklenmeli"); },
  async issueUrl(k) { return `https://linear.app/issue/${k}`; },
};
