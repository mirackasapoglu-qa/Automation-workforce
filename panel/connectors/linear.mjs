/**
 * Linear connector — Jira ile AYNI "tracker" arayüzünü sunar.
 *
 * NEDEN MCP değil düz API: panel bağımsız bir Node sunucusu, Claude Code'un MCP
 * oturumuna erişemez (Linear MCP uzak + OAuth'lu, token Keychain'de). Linear'ın
 * GraphQL API'si tek uçtan her şeyi veriyor; kimlik `~/.linear-credentials`.
 *
 * Bu dosya YAZILDI ama bu projede AKTİF DEĞİL: hangi tracker'ın kullanılacağını
 * proje profili söyler (`projects/<proje>.mjs → connectors.tracker`). Tracker'ı
 * Linear olan bir proje eklendiğinde çekirdekte tek satır değişmez.
 */
import { resolveCreds, credLabel } from "./credentials.mjs";

export const key = "linear";
export const label = "Linear";
export const icon = "linear";
export const capabilities = ["tracker"];
export const credential = { file: ".linear-credentials", vars: ["LINEAR_API_KEY"] };
export const credentialLabel = credLabel(credential.file, credential.vars);

export const setupFix = [
  "Linear > Settings > Security & access > Personal API keys",
  "echo 'LINEAR_API_KEY=lin_api_...' > ~/.linear-credentials && chmod 600 ~/.linear-credentials",
];

const API = "https://api.linear.app/graphql";
const creds = () => resolveCreds(credential.file, credential.vars);

export function configured() { return creds().ok; }

async function gql(query, variables = {}) {
  const c = creds();
  if (!c.ok) throw new Error("LINEAR_API_KEY yok");
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: c.values.LINEAR_API_KEY },
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
    return {
      state: "ok",
      detail: `${d.viewer.name} · ${d.organization.name}`,
      note: "Linear GraphQL API — kota sınırı belgelenmemiş, panel yalnızca doğrulama çağrısı yapar",
      fix: [],
    };
  } catch (e) {
    return {
      state: "warn",
      detail: String(e.message).slice(0, 50),
      fix: ["API anahtarı iptal edilmiş olabilir — Linear'da yeniden üret"],
    };
  }
}

/** Jira connector'ıyla AYNI imza. Çağıran taraf hangisi olduğunu bilmez. */
export const tracker = {
  /** Linear anahtarı: TEAM-123 (Jira ile aynı biçim, ama doğrulama API'den). */
  keyPattern: /^[A-Z][A-Z0-9]+-\d+$/,
  async whoami() {
    const d = await gql("{ viewer { name email } }");
    return { name: d.viewer.name, email: d.viewer.email };
  },
  async listIssues(view, limit = 50) {
    const d = await gql(
      `query($n:Int!){ issues(first:$n, orderBy:updatedAt){ nodes{ identifier title state{name} assignee{name} updatedAt } } }`,
      { n: limit },
    );
    return { cards: d.issues.nodes.map((i) => ({
      key: i.identifier, summary: i.title, status: i.state.name,
      assignee: i.assignee?.name ?? null, updated: i.updatedAt,
    })) };
  },
  async getIssue(k) {
    const d = await gql(
      `query($id:String!){ issue(id:$id){ identifier title description state{name} comments{nodes{body user{name} createdAt}} } }`,
      { id: k },
    );
    const i = d.issue;
    return {
      key: i.identifier, summary: i.title, description: i.description ?? "",
      status: i.state.name,
      comments: i.comments.nodes.map((c) => ({ author: c.user?.name ?? "?", body: c.body, created: c.createdAt })),
    };
  },
  async comment(k, text) {
    const d = await gql(
      `mutation($id:String!,$b:String!){ commentCreate(input:{issueId:$id, body:$b}){ success } }`,
      { id: k, b: text },
    );
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
