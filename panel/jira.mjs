/**
 * Jira katmanı (REST v3).
 *
 * Host, proje, epic, hata tipi ve özel alan id'leri proje profilinden gelir:
 * `panel/projects/<proje>.mjs → jira`. Bu dosyada proje bilgisi YOK.
 * Kimlik: ortam değişkeni ya da ~/.jira-credentials (JIRA_EMAIL, JIRA_TOKEN) —
 * repoya YAZILMAZ. Çözüm sırası connectors/credentials.mjs'de: env > dosya.
 *
 * Konvansiyonlar (ölçülerek doğrulandı 2026-08-18):
 *  - REST v3. Yorum gövdesi ADF formatında olmalı.
 *  - JQL'de issue type adı İNGİLİZCE: `issuetype = Bug` çalışır, `issuetype = "Hata"` 0 döner.
 *  - Arama ucu `/rest/api/3/search/jql`; sayfalama `nextPageToken` ile, `total` alanı YOK.
 *  - Statü geçişi id'ye göre değil, `/transitions`'tan okunan ada göre eşlenir.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveCreds, credLabel } from "./connectors/credentials.mjs";
import { listSorters } from "./jira-sorters.mjs";
import { PROJECT } from "./project.mjs";
import { readTree, collectJiraTaskIds } from "./scope.mjs";

/*
 * ⚠️ Bu dosya eskiden kimliği YALNIZCA ~/.jira-credentials'tan okuyordu
 * (`fs.existsSync(CRED_FILE)` → yoksa null). Container'ın home dizininde o dosya
 * yok ve ortam değişkeni de okunmadığı için Dokploy'a JIRA_EMAIL/JIRA_TOKEN
 * yazmak işe yaramıyordu: deploy edilmiş panelde Jira KALICI olarak kapalı
 * görünüyordu (ölçüldü 2026-09-02, <sunucu-domain> →
 * /api/preflight `jira: off, "~/.jira-credentials yok"`). Diğer connector'lar
 * (figma, slack) baştan resolveCreds kullanıyordu; tutarsızlık buradaydı.
 */
export const CRED = { file: ".jira-credentials", vars: ["JIRA_EMAIL", "JIRA_TOKEN"] };
export const CRED_LABEL = credLabel(CRED.file, CRED.vars);
/** İnsan tarafına: kimlik yoksa gösterilecek tek satır. */
export const CRED_HINT = `JIRA_EMAIL / JIRA_TOKEN yok — ortam değişkeni ver ya da ~/${CRED.file} yaz`;

/*
 * KİMLİK ÇAĞRI ANINDA ÇÖZÜLÜR. Eskiden modül yüklenirken bir kez çözülüp
 * donuyordu: panelden bağlanmak (ya da token'ı yenilemek) ancak süreç yeniden
 * başlayınca görünüyordu (ölçüldü 2026-09-08). Depo ucuz (üç küçük dosya),
 * her istekte okumak sorun değil.
 */
const creds = () => {
  const r = resolveCreds(CRED.file, CRED.vars);
  return r.ok ? { values: r.values, source: r.source } : null;
};

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
  /** Kimlik var mı — her okumada taze (getter). */
  get available() { return Boolean(creds()); },
  get email() { return creds()?.values.JIRA_EMAIL ?? ""; },
  /** "env" | "store" | "oauth" | "file" | null — kimliğin nereden geldiği. */
  get credSource() { return creds()?.source ?? null; },
};

/** Basic başlığı — çağrı anında; kimlik yoksa null. */
function authHeader() {
  const c = creds();
  return c ? "Basic " + Buffer.from(`${c.values.JIRA_EMAIL}:${c.values.JIRA_TOKEN}`).toString("base64") : null;
}

async function api(pathAndQuery, { method = "GET", body } = {}) {
  if (!authHeader()) throw new Error(CRED_HINT);
  const res = await fetch(`${JIRA.host}${pathAndQuery}`, {
    method,
    headers: {
      authorization: authHeader(),
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

// ---------------------------------------------------------------- sorter
const BASE_FIELDS = "summary,status,issuetype,assignee,updated,priority,parent";
const FIELDS = JIRA.sprintFieldId ? `${BASE_FIELDS},${JIRA.sprintFieldId}` : BASE_FIELDS;

/**
 * "Tümü" — TEK sabit sorter. 2026-09-11'e kadar profil kod içinde 4 statik
 * görünüm (Test kolonu/Bloklu/Tüm epic/Bug'lar) tanımlıyordu; bunlar
 * kaldırıldı (bkz. CLAUDE.md → "Jira: Sorter") — kodda projeye özgü statik
 * bir sorter YOK. Bunun yerine bağlı Jira projesinden (epic'ten DEĞİL —
 * epic'i olmayan bir profilde bile çalışsın diye) dinamik türetilen bu tek
 * seçenek var; bunun dışındaki her sorter kullanıcının panelden eklediği bir
 * kayıt (bkz. jira-sorters.mjs).
 */
export const ALL_SORTER = { id: "all", label: "Tümü", mode: "filter", filter: {} };

/**
 * "Flowscope'a Bağlı" — ikinci sabit sorter, ama "Tümü"nün aksine filtresi HER
 * ÇAĞRIDA yeniden hesaplanıyor: kapsam ağacındaki düğümlere bağlı Task ID'ler
 * çalışma zamanında değişiyor (bkz. CLAUDE.md → "Panel ↔ Flowscope"). Ağaçta
 * hiç bağlı kart yoksa `null` döner — boş `key in ()` geçersiz JQL olurdu,
 * bu durumda sorter listede hiç görünmez (çağıran taraf `null`ı filtreler).
 */
export function flowscopeSorter() {
  const { tree } = readTree();
  const keys = collectJiraTaskIds(tree);
  if (!keys.length) return null;
  return { id: "flowscope", label: "Flowscope'a Bağlı", mode: "filter", filter: { keys: { in: keys } } };
}

/**
 * "Flowscope'a Bağlı Değil" — `flowscopeSorter()`'ın simetriği: hiçbir sayfaya/
 * düğüme bağlanmamış kartları gösterir (QA modelimizin dışında kalan iş
 * kalemleri, bkz. CLAUDE.md → "Panel ↔ Flowscope"). Bağlı kart hiç yoksa
 * (`keys.length === 0`) bu sorgu "Tümü" ile birebir aynı sonucu verirdi —
 * anlamsız bir kopya olmasın diye o durumda da `null` döner (flowscopeSorter
 * ile TUTARLI: ikisi de "hiç bağlı kart yok" durumunda birlikte kaybolur).
 */
export function flowscopeUnlinkedSorter() {
  const { tree } = readTree();
  const keys = collectJiraTaskIds(tree);
  if (!keys.length) return null;
  return { id: "flowscope-unlinked", label: "Flowscope'a Bağlı Değil", mode: "filter", filter: { keys: { notIn: keys } } };
}

/**
 * Genel (sağlayıcıdan bağımsız) filtreyi JQL'e çevirir — bkz. CLAUDE.md →
 * "Provider yapısı: Sorter'ı tracker-agnostic yapmak". `ALL_SORTER`,
 * `flowscopeSorter`, `flowscopeUnlinkedSorter` VE panelden eklenen "filter"
 * modlu özel sorter'lar hepsi bu tek fonksiyondan geçer; eski "raw JQL"
 * modundaki sorter'lar (kullanıcının elle yazdığı JQL) buna hiç uğramaz.
 *
 * ⚠️ Bu çeviri gerçek bir Jira örneğine karşı DENENMEDİ (bu ortamda kimlik
 * yok) — `statusCategory in (...)` JQL sözdizimi Atlassian'ın dokümante
 * ettiği, iyi bilinen bir kalıp ama canlı doğrulama panele kimlik girilene
 * kadar eksik kalıyor. Şüphe doğarsa `testJql()` ile elle doğrula.
 */
export function filterToJql(filter = {}) {
  const clauses = [`project = ${JIRA.project}`];
  const q = (s) => `"${String(s).replace(/"/g, "")}"`;
  if (filter.keys?.in?.length) clauses.push(`key in (${filter.keys.in.map(q).join(", ")})`);
  if (filter.keys?.notIn?.length) clauses.push(`key not in (${filter.keys.notIn.map(q).join(", ")})`);
  if (filter.statusCategory?.length) {
    const CAT = { todo: "To Do", inprogress: "In Progress", done: "Done" };
    clauses.push(`statusCategory in (${filter.statusCategory.map((c) => q(CAT[c] ?? c)).join(", ")})`);
  }
  if (filter.assignee) clauses.push(`assignee = ${q(filter.assignee)}`);
  return clauses.join(" AND ") + " ORDER BY status, key";
}

/** Bir sorter kaydının JQL'i — "filter" modundaysa türetir, "raw"/eski kayıtlarda olduğu gibi kullanır. */
function jqlFor(sorter) {
  return sorter.mode === "filter" ? filterToJql(sorter.filter ?? {}) : sorter.jql;
}

/** "all" / "flowscope" / "flowscope-unlinked" sabitleri ya da panelden eklenen özel bir sorter. */
export function resolveSorter(view) {
  if (view === "all" || !view) return ALL_SORTER;
  if (view === "flowscope") return flowscopeSorter();
  if (view === "flowscope-unlinked") return flowscopeUnlinkedSorter();
  return listSorters().find((s) => s.id === view) ?? null;
}

function mapIssues(issues) {
  return issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name ?? "",
    type: i.fields.issuetype?.name ?? "",
    assignee: i.fields.assignee?.displayName ?? "",
    priority: i.fields.priority?.name ?? "",
    updated: i.fields.updated ?? "",
    sprint: (i.fields[JIRA.sprintFieldId] ?? []).map((s) => s?.name).filter(Boolean),
    url: `${JIRA.host}/browse/${i.key}`,
  }));
}

/**
 * Bir sorter'ı çeker; sayfalama nextPageToken ile (total alanı YOK).
 * `view` ya kayıtlı bir sorter id'si (string) ya da HENÜZ KAYDEDİLMEMİŞ bir
 * sorter nesnesi (`{label, mode, jql|filter}`) olabilir — "Dene" adımı ikinci
 * yolu kullanır, diskte olmayan bir taslağı gerçek bir kayıtmış gibi test eder.
 */
export async function getCards(view = "all", limit = 100) {
  const v = typeof view === "object" && view ? view : resolveSorter(view);
  if (!v) throw new Error(`Sorter bulunamadı: ${view}`);
  const jql = jqlFor(v);

  const issues = [];
  let token = null;
  do {
    const qs = new URLSearchParams({ jql, maxResults: "50", fields: FIELDS });
    if (token) qs.set("nextPageToken", token);
    const page = await api(`/rest/api/3/search/jql?${qs}`);
    issues.push(...(page.issues ?? []));
    token = page.isLast ? null : page.nextPageToken;
  } while (token && issues.length < limit);

  return { view: v.id ?? "test", label: v.label, jql, cards: mapIssues(issues) };
}

/**
 * Bir sorter'ı KAYDETMEDEN ÖNCE dener — kullanıcının panelden yazdığı ham
 * JQL'i doğrudan Jira'ya sorar. Kayıtlı bir sorter aramaz, `getCards`'tan
 * ayrı tutulmasının sebebi bu: burada henüz diskte olmayan bir metin var.
 * Küçük bir örnek (ilk 5) + toplam sayı döner; tam liste çekmez.
 */
export async function testJql(jql) {
  const clean = String(jql ?? "").trim();
  if (!clean) throw new Error("JQL boş olamaz");
  const qs = new URLSearchParams({ jql: clean, maxResults: "20", fields: FIELDS });
  const page = await api(`/rest/api/3/search/jql?${qs}`);
  const cards = mapIssues(page.issues ?? []);
  return { count: cards.length, sample: cards.slice(0, 5) };
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
  if (!authHeader()) throw new Error(CRED_HINT);
  const fs = await import("node:fs");
  const path = await import("node:path");
  const name = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(filePath)]), name);
  const res = await fetch(`${JIRA.host}/rest/api/3/issue/${key}/attachments`, {
    method: "POST",
    headers: { authorization: authHeader(), "X-Atlassian-Token": "no-check" },
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
