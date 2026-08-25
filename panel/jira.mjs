/**
 * Jira katmanı (REST v3).
 *
 * Host, proje, epic, hata tipi ve özel alan id'leri proje profilinden gelir:
 * `panel/projects/<proje>.mjs → jira`. Bu dosyada proje bilgisi YOK.
 * Kimlik: ~/.jira-credentials (JIRA_EMAIL, JIRA_TOKEN) — repoya YAZILMAZ.
 *
 * Konvansiyonlar (ölçülerek doğrulandı 2026-08-18):
 *  - REST v3. Yorum gövdesi ADF formatında olmalı.
 *  - JQL'de issue type adı İNGİLİZCE: `issuetype = Bug` çalışır, `issuetype = "Hata"` 0 döner.
 *  - Arama ucu `/rest/api/3/search/jql`; sayfalama `nextPageToken` ile, `total` alanı YOK.
 *  - Statü geçişi id'ye göre değil, `/transitions`'tan okunan ada göre eşlenir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECT } from "./project.mjs";

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

/**
 * Profil değerleri; her biri aynı adlı ortam değişkeniyle ezilebilir
 * (JIRA_HOST, JIRA_PROJECT, JIRA_EPIC, JIRA_BUG_TYPE_ID, JIRA_PROJECT_FIELD,
 * JIRA_PROJECT_FIELD_VALUE, JIRA_SPRINT_FIELD) — tek seferlik denemeler için.
 */
const P = PROJECT.jira;

export const JIRA = {
  host: process.env.JIRA_HOST || P.host,
  project: process.env.JIRA_PROJECT || P.project,
  epic: process.env.JIRA_EPIC || P.epic,
  /**
   * Hata tipi ADIYLA değil id'siyle verilir: oluşturma ile sorgulama farklı ad
   * ister (yerelleştirilmiş Jira'da `POST /issue` İngilizce adı reddeder, JQL
   * ise yerel adı 0 sonuç döndürür). Ada güvenmek iki yönden de kırılgan.
   */
  bugTypeId: process.env.JIRA_BUG_TYPE_ID || P.bugTypeId,
  /**
   * Zorunlu select alan. Verilmezse oluşturma 400 ile düşer
   * ("<Alan>: <Alan> gerekiyor."). Profilde alan id'si ve değer id'si birlikte durur.
   */
  projectFieldId: process.env.JIRA_PROJECT_FIELD || P.projectFieldId,
  projectFieldValueId: process.env.JIRA_PROJECT_FIELD_VALUE || P.projectFieldValueId,
  sprintFieldId: process.env.JIRA_SPRINT_FIELD || P.sprintFieldId || "",
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
const BASE_FIELDS = "summary,status,issuetype,assignee,updated,priority,parent";
const FIELDS = JIRA.sprintFieldId ? `${BASE_FIELDS},${JIRA.sprintFieldId}` : BASE_FIELDS;

/**
 * Görünümler profilden gelir (`jira.views`), çünkü hangi JQL'in işe yaradığı
 * projeye göre değişir. Profil tanımlamamışsa epic tabanlı iki genel görünüm
 * kurulur — panel Jira sekmesi profilsiz de açılabilsin diye.
 */
export const VIEWS =
  typeof PROJECT.jira.views === "function"
    ? PROJECT.jira.views(JIRA)
    : (PROJECT.jira.views ?? {
        test: {
          label: "Test kolonu (bende bekleyen)",
          jql: `parent = ${JIRA.epic} AND status = "Test" ORDER BY key`,
        },
        epic: {
          label: "Tüm epic",
          jql: `parent = ${JIRA.epic} ORDER BY status, key`,
        },
      });

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
      sprint: (i.fields[JIRA.sprintFieldId] ?? []).map((s) => s?.name).filter(Boolean),
      url: `${JIRA.host}/browse/${i.key}`,
    })),
  };
}

/**
 * Anahtar listesi icin toplu durum. Kapsam agacindaki canli kart gostergesi
 * bunu kullanir (bir dugumde birden fazla kart olabilir, tek istekte cozulur).
 *
 * Donen sekil tracker arayuzunun ortak sozlesmesi:
 *   { KEY: { found, statusName, statusCategory, summary } }
 * Bulunamayan anahtar `found:false` ile doner — cagiran taraf "gecersiz ID"
 * ayrimini buradan yapar.
 */
export async function statusByKeys(keys) {
  const list = (keys ?? []).filter(Boolean);
  if (!list.length) return {};
  const jql = `key in (${list.map((k) => `"${k.replace(/"/g, "")}"`).join(", ")})`;
  const qs = new URLSearchParams({ jql, fields: "status,summary", maxResults: String(list.length) });
  const page = await api(`/rest/api/3/search/jql?${qs}`);
  const out = {};
  for (const k of list) out[k] = { found: false, statusName: "", statusCategory: "", summary: "" };
  for (const issue of page?.issues ?? []) {
    const fields = issue.fields ?? {};
    out[issue.key] = {
      found: true,
      statusName: fields.status?.name ?? "",
      statusCategory: fields.status?.statusCategory?.key ?? "",
      summary: fields.summary ?? "",
    };
  }
  return out;
}

export async function getCard(key) {
  const issue = await api(
    `/rest/api/3/issue/${key}?fields=${FIELDS},description,${JIRA.projectFieldId},subtasks`,
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
    projectField:
      issue.fields[JIRA.projectFieldId]?.value ?? issue.fields[JIRA.projectFieldId] ?? "",
    sprint: (issue.fields[JIRA.sprintFieldId] ?? []).map((s) => s?.name).filter(Boolean),
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

/**
 * ⚠️ YAZMA İŞLEMİ — statü geçişi. transitionId `getCard().transitions`'tan gelir.
 *
 * Yorum AYRI bir çağrıyla yazılıyor. ESKİ HALİ geçiş gövdesine
 * `update.comment[].add` koyuyordu; Jira bunu **sessizce yutuyor** — geçiş
 * ekranında yorum alanı tanımlı değilse hata dönmez, statü değişir, yorum
 * kaybolur. Ölçüldü 2026-08-22: iki kart hedef statüye geçti ama gerekçe
 * yorumları hiç yazılmadı (kartların yorum sayısı değişmedi).
 * Geçişin gerekçesi kaybolursa kartta neden taşındığı görünmez — bu yüzden
 * yorum başarısız olursa hata fırlatıyoruz.
 */
export async function transition(key, transitionId, comment) {
  const res = await api(`/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    body: { transition: { id: String(transitionId) } },
  });
  if (comment) await postComment(key, comment);
  return res;
}

/**
 * ⚠️ YAZMA İŞLEMİ — yeni bug kartı açar.
 * Başlık kalıbı projeye göre değişir; ekibin biçimi profilin `jira` notunda.
 */
/**
 * Hata kartı açar. `assigneeAccountId` verilirse oluşturmadan sonra atar
 * (atama ayrı bir uç; oluşturma gövdesinde göndermek bazı ekranlarda reddediliyor).
 * NOT: assignee JQL'de ve API'de görünen adla ÇALIŞMAZ, accountId şart.
 */
export async function createBug({
  summary,
  description,
  parent = JIRA.epic,
  labels = [],
  assigneeAccountId = null,
}) {
  const issue = await api(`/rest/api/3/issue`, {
    method: "POST",
    body: {
      fields: {
        project: { key: JIRA.project },
        issuetype: { id: JIRA.bugTypeId },
        [JIRA.projectFieldId]: { id: JIRA.projectFieldValueId },
        summary,
        description: textToAdf(description),
        ...(parent ? { parent: { key: parent } } : {}),
        ...(labels.length ? { labels } : {}),
      },
    },
  });
  if (assigneeAccountId) {
    await api(`/rest/api/3/issue/${issue.key}/assignee`, {
      method: "PUT",
      body: { accountId: assigneeAccountId },
    });
  }
  return issue;
}

/** Karta dosya ekler (multipart; X-Atlassian-Token: no-check zorunlu). */
export async function attachFile(key, filePath) {
  if (!authHeader) throw new Error("~/.jira-credentials bulunamadı");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const name = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(filePath)]), name);
  const res = await fetch(`${JIRA.host}/rest/api/3/issue/${key}/attachments`, {
    method: "POST",
    headers: { authorization: authHeader, "X-Atlassian-Token": "no-check" },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ek ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * Karta atanabilecek kullanicilar. `/user/search` bu instance'ta BOS donuyor,
 * dogru uc `/user/assignable/search`. Ad ile filtreleme JQL'de de API'de de
 * calismiyor — accountId sart, bu yuzden id'yi de donduruyoruz.
 */
export async function assignableUsers() {
  const list = await api(
    `/rest/api/3/user/assignable/search?project=${encodeURIComponent(JIRA.project)}&maxResults=50`,
  );
  return list
    .filter((u) => u.accountType !== "app" && u.displayName)
    .map((u) => ({ accountId: u.accountId, name: u.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function whoami() {
  const me = await api("/rest/api/3/myself");
  return { accountId: me.accountId, name: me.displayName, email: me.emailAddress };
}
