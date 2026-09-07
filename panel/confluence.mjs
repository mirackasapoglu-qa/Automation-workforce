/**
 * Confluence katmanı — Doküman Drift Radarı'nın Confluence tarafı.
 *
 * `panel/design-drift.mjs` (Figma) ile AYNI ilke, farklı kaynak: bir düğüm
 * ✅ (Tamamlandı) VE Kaynaklar'da bir Confluence sayfası linkiyse, sayfanın
 * son düzenlenme zamanını (`version.when`) düğümün `lastVerifiedAt`'ıyla
 * kıyaslar. Ağaç mutasyonu burada YOK — `panel/scope.mjs → sweepResourceDrift`
 * yapıyor (Figma ile PAYLAŞILAN aynı fonksiyon, bkz. o dosyadaki gerekçe).
 *
 * ⚠️ KİMLİK VE HOST PROJE-BAĞIMSIZ TUTULUYOR: bu panel artık yalnızca
 * Machinarium için değil, herkese açılacak şekilde düşünülüyor, o yüzden
 * hiçbir yerde sabit bir *.atlassian.net yazmıyoruz.
 *  - Kendi kimlik dosyası var (`~/.confluence-credentials`,
 *    `CONFLUENCE_EMAIL`/`CONFLUENCE_TOKEN`) ama VERİLMEMİŞSE Jira'nın
 *    kimliğine düşer: Atlassian Cloud'da aynı hesap/API token'ı Jira VE
 *    Confluence'ı birlikte yetkilendiriyor, aynı email/token'ı iki dosyaya
 *    kopyalamak gereksiz bir sürtünme olurdu.
 *  - Host da aynı mantıkla: `CONFLUENCE_HOST` / profildeki `confluence.host`
 *    verilmemişse Jira'nın host'una düşer (çoğu kurulumda aynı site ikisini
 *    birden barındırıyor). Ayrı bir Confluence sitesi/Data Center kullanan
 *    proje `CONFLUENCE_HOST`'u açıkça vererek bunu ezer.
 *
 * ⚠️ ÖLÇÜM SINIRI, bilerek: yalnızca URL'sinde sayfa ID'si geçen linkler
 * çözülür (`/pages/<id>/...` ya da `?pageId=<id>`). `/wiki/display/<SPACE>/<Başlık>`
 * biçimi sayfa ID taşımaz — bunu çözmek CQL araması (ekstra istek) ister;
 * ilk sürüm bunu atlıyor, link sessizce "tanınmadı" sayılır (Figma'nın
 * dosya-vs-frame sınırıyla aynı gerekçe: ucuz + kaba ama işe yarar sinyal).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveCreds } from "./connectors/credentials.mjs";
import { isCut } from "./connectors/cuts.mjs";
import { PROJECT } from "./project.mjs";

const CACHE_DIR = path.join(process.cwd(), "panel-data", "confluence-cache");
/** Figma tarafındaki design-drift.mjs ile aynı TTL gerekçesi: tazelik ile israf arası denge. */
const CACHE_TTL_MS = Number(process.env.CONFLUENCE_DRIFT_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);

const OWN_CRED = { file: ".confluence-credentials", vars: ["CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN"] };
const JIRA_CRED = { file: ".jira-credentials", vars: ["JIRA_EMAIL", "JIRA_TOKEN"] };

function auth() {
  if (isCut("confluence")) return null;
  const own = resolveCreds(OWN_CRED.file, OWN_CRED.vars);
  if (own.ok) return { email: own.values.CONFLUENCE_EMAIL, token: own.values.CONFLUENCE_TOKEN };
  const jira = resolveCreds(JIRA_CRED.file, JIRA_CRED.vars);
  if (jira.ok) return { email: jira.values.JIRA_EMAIL, token: jira.values.JIRA_TOKEN };
  return null;
}

function host() {
  return process.env.CONFLUENCE_HOST || PROJECT.confluence?.host || process.env.JIRA_HOST || PROJECT.jira?.host || null;
}

/** Confluence URL'inden sayfa ID'sini çıkarır — hem `/pages/<id>/` hem `?pageId=<id>` biçimi. */
export function extractConfluencePageId(url) {
  const s = String(url ?? "");
  const m1 = /\/pages\/(\d+)(?:\/|$|\?)/.exec(s);
  if (m1) return m1[1];
  try {
    const q = new URL(s).searchParams.get("pageId");
    if (q && /^\d+$/.test(q)) return q;
  } catch { /* gecersiz url — genel link, atla */ }
  return null;
}

const cachePath = (pageId) => path.join(CACHE_DIR, `lastmod_${pageId.replace(/[^0-9]/g, "")}.json`);

/**
 * Bir sayfanın son düzenlenme zamanını döner (ISO string) — önbellek öncelikli.
 * Kimlik/host yok, ağ hatası ya da yanıt hatalıysa sessizce `null` döner: bu
 * bir sayfa için "bilinmiyor" demektir, sweep'in geri kalanını durdurmaz.
 */
async function pageLastModified(pageId) {
  const cf = cachePath(pageId);
  if (fs.existsSync(cf)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cf, "utf8"));
      if (Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) return cached.lastModified;
    } catch { /* bozuksa yeniden cek */ }
  }
  const a = auth();
  const h = host();
  if (!a || !h) return null;
  // Cloud siteleri Confluence'ı /wiki altında sunar, Data Center genelde sunmaz
  // (bkz. resources.js → detectResourceType'taki aynı ayrım).
  const cloud = h.includes("atlassian.net");
  const base = cloud ? `${h}/wiki/rest/api` : `${h}/rest/api`;
  const url = `${base}/content/${pageId}?expand=version`;
  const authHeader = "Basic " + Buffer.from(`${a.email}:${a.token}`).toString("base64");
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: authHeader, Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!res.ok) return null; // 401/404/429 dahil — bu sayfayi atla, digerleri devam etsin
  const json = await res.json().catch(() => null);
  const lastModified = json?.version?.when ?? null;
  if (lastModified) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cf, JSON.stringify({ lastModified, checkedAt: new Date().toISOString() }));
  }
  return lastModified;
}

/**
 * Birden çok sayfa ID'si için `lastModified` haritası. SIRALI çağırır
 * (Figma tarafıyla aynı gerekçe: paylaşılan host/kimliğe karşı eşzamanlı
 * çoklu istek riskini artırmamak).
 * @param {string[]} pageIds
 * @returns {Promise<Record<string, string|null>>}
 */
export async function lastModifiedByKey(pageIds) {
  const out = {};
  for (const id of pageIds) out[id] = await pageLastModified(id);
  return out;
}
