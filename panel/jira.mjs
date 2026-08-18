/**
 * Homee QA Paneli — Jira katmanı (machinarium.atlassian.net)
 *
 * Kapsam: MAC projesi, `MAC-7035 Tepe - Redesign` epic'i.
 * Kimlik: ~/.jira-credentials (JIRA_EMAIL, JIRA_TOKEN) — repoya YAZILMAZ.
 *
 * Konvansiyonlar (ölçülerek doğrulandı 2026-08-18):
 *  - REST v3. Yorum gövdesi ADF formatında olmalı.
 *  - JQL'de issue type adı İNGİLİZCE: `issuetype = Bug` çalışır, `issuetype = "Hata"` 0 döner.
 *  - Arama ucu `/rest/api/3/search/jql`; sayfalama `nextPageToken` ile, `total` alanı YOK.
 *  - Statü geçişleri projede ortak id'ler: 11 Yapılacaklar · 21 Devam Ediyor · 31 Tamam ·
 *    41 Test · 51 Ready For Deploy · 61 Ready For Release · 71 Blocked · 81 Failed ·
 *    91 Test Blocked · 5 Move to Release for Stage
 *  - Özel alanlar: customfield_10072 = Project (TEPEHOME), customfield_10020 = Sprint
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CRED_FILE = path.join(os.homedir(), ".jira-credentials");

function readCreds() {
  if (!fs.existsSync(CRED_FILE)) return null;
  const out = {};
  for (const line of fs.readFileSync(CRED_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.JIRA_EMAIL || !out.JIRA_TOKEN) return null;
  return out;
}

const creds = readCreds();

export const JIRA = {
  host: process.env.JIRA_HOST_HOMEE || "https://machinarium.atlassian.net",
  project: process.env.JIRA_PROJECT_HOMEE || "MAC",
  epic: process.env.JIRA_EPIC_HOMEE || "MAC-7035",
  available: Boolean(creds),
  email: creds?.JIRA_EMAIL ?? "",
};

const authHeader = creds
  ? "Basic " + Buffer.from(`${creds.JIRA_EMAIL}:${creds.JIRA_TOKEN}`).toString("base64")
  : null;

async function api(pathAndQuery, { method = "GET", body } = {}) {
  if (!authHeader) throw new Error("~/.jira-credentials bulunamadı (JIRA_EMAIL / JIRA_TOKEN)");
  const res = await fetch(`${JIRA.host}${pathAndQuery}`, {
    method,
    headers: {
      authorization: authHeader,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON değilse ham metni hata mesajında göster */
  }
  if (!res.ok) {
    const msg = json?.errorMessages?.join(", ") || json?.errors || text.slice(0, 200);
    throw new Error(`Jira ${res.status}: ${msg}`);
  }
  return json;
}

// ---------------------------------------------------------------- ADF
/** ADF ağacından düz metin çıkarır (yorum okuma). */
export function adfToText(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(adfToText).join("");
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const inner = adfToText(node.content ?? []);
  return ["paragraph", "heading", "listItem", "codeBlock"].includes(node.type)
    ? inner + "\n"
    : inner;
}

/** Düz metni ADF'ye çevirir (yorum yazma). Boş satırlar paragraf ayırır. */
export function textToAdf(text) {
  const paragraphs = String(text).split(/\n{2,}/);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) =>
        i === 0
          ? [{ type: "text", text: line }]
          : [{ type: "hardBreak" }, { type: "text", text: line }],
      ),
    })),
  };
}

// ---------------------------------------------------------------- görünümler
const FIELDS = "summary,status,issuetype,assignee,updated,priority,parent,customfield_10020";

export const VIEWS = {
  test: {
    label: "Test kolonu (bende bekleyen)",
    jql: `parent = ${JIRA.epic} AND status = "Test" ORDER BY key`,
  },
  blocked: {
    label: "Bloklu",
    jql: `parent = ${JIRA.epic} AND status IN ("Test Blocked", "Blocked", "Failed") ORDER BY key`,
  },
  epic: {
    label: "Tüm redesign epic'i",
    jql: `parent = ${JIRA.epic} ORDER BY status, key`,
  },
  bugs: {
    label: "Redesign bug'ları (son 30 gün)",
    jql: `project = ${JIRA.project} AND issuetype = Bug AND summary ~ "Redesign" AND updated >= -30d ORDER BY updated DESC`,
  },
};

/** Bir görünümü çeker; sayfalama nextPageToken ile (total alanı YOK). */
export async function getCards(view = "test", limit = 100) {
  const v = VIEWS[view] ?? VIEWS.test;
  const issues = [];
  let token = null;
  do {
    const qs = new URLSearchParams({ jql: v.jql, maxResults: "50", fields: FIELDS });
    if (token) qs.set("nextPageToken", token);
    const page = await api(`/rest/api/3/search/jql?${qs}`);
    issues.push(...(page.issues ?? []));
    token = page.isLast ? null : page.nextPageToken;
  } while (token && issues.length < limit);

  return {
    view,
    label: v.label,
    jql: v.jql,
    cards: issues.map((i) => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status?.name ?? "",
      type: i.fields.issuetype?.name ?? "",
      assignee: i.fields.assignee?.displayName ?? "",
      priority: i.fields.priority?.name ?? "",
      updated: i.fields.updated ?? "",
      sprint: (i.fields.customfield_10020 ?? []).map((s) => s?.name).filter(Boolean),
      url: `${JIRA.host}/browse/${i.key}`,
    })),
  };
}

export async function getCard(key) {
  const issue = await api(
    `/rest/api/3/issue/${key}?fields=${FIELDS},description,customfield_10072,subtasks`,
  );
  const comments = await api(`/rest/api/3/issue/${key}/comment?maxResults=20&orderBy=-created`);
  const transitions = await api(`/rest/api/3/issue/${key}/transitions`);
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? "",
    type: issue.fields.issuetype?.name ?? "",
    assignee: issue.fields.assignee?.displayName ?? "",
    parent: issue.fields.parent?.key ?? "",
    projectField: issue.fields.customfield_10072?.value ?? issue.fields.customfield_10072 ?? "",
    sprint: (issue.fields.customfield_10020 ?? []).map((s) => s?.name).filter(Boolean),
    description: adfToText(issue.fields.description).slice(0, 4000),
    url: `${JIRA.host}/browse/${issue.key}`,
    comments: (comments.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? "",
      created: c.created,
      text: adfToText(c.body).slice(0, 2000),
    })),
    transitions: (transitions.transitions ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name ?? "",
    })),
  };
}

/**
 * Karta yorum yazar. ⚠️ YAZMA İŞLEMİ — panel bunu ancak kullanıcı
 * "Jira'ya gönder" butonuna basınca çağırır, otomatik tetiklenmez.
 */
export async function postComment(key, text) {
  return api(`/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    body: { body: textToAdf(text) },
  });
}

/** ⚠️ YAZMA İŞLEMİ — statü geçişi. transitionId `getCard().transitions`'tan gelir. */
export async function transition(key, transitionId, comment) {
  return api(`/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    body: {
      transition: { id: String(transitionId) },
      ...(comment ? { update: { comment: [{ add: { body: textToAdf(comment) } }] } } : {}),
    },
  });
}

/**
 * ⚠️ YAZMA İŞLEMİ — yeni bug kartı açar.
 * İsim kalıbı ekibin kullandığı biçime uyar: "TEPE - Redesign > <Alan> > <problem>"
 */
export async function createBug({ summary, description, parent = JIRA.epic, labels = [] }) {
  return api(`/rest/api/3/issue`, {
    method: "POST",
    body: {
      fields: {
        project: { key: JIRA.project },
        issuetype: { name: "Bug" },
        summary,
        description: textToAdf(description),
        ...(parent ? { parent: { key: parent } } : {}),
        ...(labels.length ? { labels } : {}),
      },
    },
  });
}

export async function whoami() {
  const me = await api("/rest/api/3/myself");
  return { accountId: me.accountId, name: me.displayName, email: me.emailAddress };
}
