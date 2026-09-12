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

/**
 * Linear'ın kendi 6 durumlu `WorkflowStateType`'ını (triage/backlog/unstarted/
 * started/completed/cancelled) tracker sözleşmesinin 3 kategorisine indirger
 * (new/indeterminate/done — bkz. panel/jira.mjs, CLAUDE.md → "Flowscope: Jira
 * durumu"). BU EŞLEME OLMADAN auto-flag/sweep mantığı (scope.mjs) Linear'da
 * SESSİZCE YANLIŞ çalışırdı: oradaki kod literal `"done"` string'ini arıyor,
 * Linear ham hâliyle hiç "done" döndürmüyor (tamamlanan bir işte "completed"
 * döner) — her Linear görevi, gerçekten tamamlanmış olsa bile, hiçbir zaman
 * "done" sayılmaz ve düğüm sürekli ❌'da kalırdı. `cancelled` de "done" sayılır:
 * ikisi de "bu iş üzerinde artık değişiklik beklenmiyor" anlamına geliyor,
 * QA açısından aynı sonucu doğuruyor.
 */
const STATUS_CATEGORY = { triage: "new", backlog: "new", unstarted: "new", started: "indeterminate", completed: "done", cancelled: "done" };
export function toStatusCategory(linearType) {
  return STATUS_CATEGORY[linearType] ?? "";
}

/**
 * ⚠️ YUKARIDAKİ `STATUS_CATEGORY`'den KASITLI OLARAK AYRI bir sözlük — ikisini
 * birbirinden TÜRETMEK tam bu hataya yol açtı (bkz. linear.test.mjs, ilk
 * sürümde bir testi kırdı). `STATUS_CATEGORY` OKUMA yönü: Linear'dan gelen
 * durumu Jira'nın kendi iç sözlüğüyle (`new`/`indeterminate`/`done`) rapor
 * eder — bu, scope.mjs'nin zaten bildiği, DEĞİŞTİRİLEMEZ sözleşme. Sorter
 * FİLTRESİNİN `statusCategory` alanı ise tamamen ayrı, bu özellik için
 * uydurulmuş, insan diline daha yakın bir sözlük (`todo`/`inprogress`/`done`
 * — bkz. jira.mjs → filterToJql'deki AYNI üç isim). İkisi aynı gibi
 * göründüğü için karıştırmak kolay; bilerek iki ayrı sabit tutuluyor.
 */
const FILTER_CATEGORY_TO_LINEAR_TYPES = {
  todo: ["triage", "backlog", "unstarted"],
  inprogress: ["started"],
  done: ["completed", "cancelled"],
};

/**
 * Genel (sağlayıcıdan bağımsız) Sorter filtresini Linear'ın `IssueFilter`
 * biçimine çevirir — bkz. CLAUDE.md → "Provider yapısı: Sorter'ı
 * tracker-agnostic yapmak", panel/jira.mjs → filterToJql (JQL karşılığı).
 *
 * ⚠️ Alan adları Linear'ın resmi geliştirici dokümanından doğrulandı
 * (linear.app/developers/filtering, 2026-09-12) — `identifier: {in/nin}` takım
 * sınırı olmadan çalışıyor (Jira'nın `key in (...)`ına birebir karşılık),
 * `state: {type: {in}}` durum kategorisi, `assignee: {email: {eq}}` atanan
 * kişi. Gerçek bir Linear hesabına karşı DENENMEDİ (bu ortamda kimlik yok) —
 * şüphe doğarsa Sorter ekranındaki "Dene" adımıyla elle doğrula.
 */
export function filterToLinearFilter(filter = {}) {
  const f = {};
  if (filter.keys?.in?.length) f.identifier = { ...(f.identifier || {}), in: filter.keys.in };
  if (filter.keys?.notIn?.length) f.identifier = { ...(f.identifier || {}), nin: filter.keys.notIn };
  if (filter.statusCategory?.length) {
    const types = filter.statusCategory.flatMap((c) => FILTER_CATEGORY_TO_LINEAR_TYPES[c] ?? []);
    if (types.length) f.state = { type: { in: types } };
  }
  if (filter.assignee) f.assignee = { email: { eq: filter.assignee } };
  return f;
}

/** Sabit üç sorter — jira.mjs'teki karşılığıyla AYNI id/label, farklı çeviri (bkz. jira.mjs → ALL_SORTER). */
async function systemSorters() {
  const { readTree, collectJiraTaskIds } = await import("../scope.mjs");
  const { tree } = readTree();
  const keys = collectJiraTaskIds(tree);
  const out = [{ id: "all", label: "Tümü", mode: "filter", filter: {} }];
  if (keys.length) {
    out.push({ id: "flowscope", label: "Flowscope'a Bağlı", mode: "filter", filter: { keys: { in: keys } } });
    out.push({ id: "flowscope-unlinked", label: "Flowscope'a Bağlı Değil", mode: "filter", filter: { keys: { notIn: keys } } });
  }
  return out;
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
        out[k] = { found: true, statusName: r.issue.state.name, statusCategory: toStatusCategory(r.issue.state.type), summary: r.issue.title };
      } catch { out[k] = { found: false, statusName: "", statusCategory: "", summary: "" }; }
    }));
    return out;
  },
  /** Jira'nın aksine kendi metin sorgu dili (JQL benzeri) yok — Sorter'da yalnızca "filter" modu geçerli. */
  supportsRawQuery: false,
  systemSorters,
  /**
   * `view` kayıtlı bir sorter id'si (sabit üçlerden biri ya da panelden
   * eklenmiş `provider:"linear"` etiketli özel bir kayıt, bkz. jira-sorters.mjs)
   * YA DA "Dene" adımının henüz kaydetmediği bir sorter NESNESİ olabilir
   * (jira.mjs → getCards ile aynı ikili giriş deseni).
   */
  async query(view, limit = 100) {
    let v;
    if (typeof view === "object" && view) {
      v = view;
    } else {
      const { listSorters } = await import("../jira-sorters.mjs");
      const sorters = await systemSorters();
      v = sorters.find((s) => s.id === view) ?? listSorters().find((s) => s.id === view && s.provider === "linear");
    }
    if (!v) throw new Error(`Sorter bulunamadı: ${view}`);
    if (v.mode !== "filter") throw new Error("Linear yalnızca yapılandırılmış filtreyi destekler, ham sorgu metnini değil.");
    const gqlFilter = filterToLinearFilter(v.filter ?? {});
    const d = await gql(
      `query($f:IssueFilter,$n:Int!){ issues(filter:$f, first:$n, orderBy:updatedAt){ nodes{ identifier title state{name} assignee{name} updatedAt } } }`,
      { f: gqlFilter, n: limit },
    );
    // url alanı GraphQL şemasından DEĞİL — `tracker.issueUrl()` ile aynı, önceden var olan
    // elle kurulan adres kalıbı (Issue tipinde doğrulanmış bir `url` alanı bulunamadı,
    // şemaya belirsiz bir alan eklemek yerine zaten kullanılan kalıbı tekrarlamak daha güvenli).
    const cards = d.issues.nodes.map((i) => ({
      key: i.identifier, summary: i.title, status: i.state.name, assignee: i.assignee?.name ?? null,
      updated: i.updatedAt, url: `https://linear.app/issue/${i.identifier}`,
    }));
    return { view: v.id ?? "test", label: v.label, cards };
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
