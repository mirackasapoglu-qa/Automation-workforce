/**
 * Proje profili yükleyici.
 *
 * Panel çekirdeği hangi projede koştuğunu SADECE buradan öğrenir. Proje adı,
 * Jira anahtarı, Figma dosyası, rota/kart eşlemeleri ve ortam değişkeni adları
 * `panel/projects/<ad>.mjs` içinde durur.
 *
 * Profil seçimi:
 *  1. `PANEL_PROJECT` verilmişse o.
 *  2. Verilmemişse ve `projects/` içinde TEK profil varsa o (taşınırken sıfır ayar).
 *  3. Birden fazla varsa hata — hangisi olduğu tahmin edilmez.
 *
 * Bağımlılık yok; `node panel/server.mjs` ile açılabilirliği bozmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "projects");

function pick() {
  const want = (process.env.PANEL_PROJECT || "").trim();
  if (want) {
    const file = path.join(DIR, `${want}.mjs`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `PANEL_PROJECT="${want}" ama panel/projects/${want}.mjs yok. Mevcut: ${list().join(", ") || "(hiç profil yok)"}`,
      );
    }
    return { name: want, file };
  }
  const found = list();
  if (found.length === 0) {
    throw new Error(
      "panel/projects/ içinde profil yok. Bir tane oluştur (panel/projects/<proje>.mjs) ya da PANEL_PROJECT ver.",
    );
  }
  if (found.length > 1) {
    throw new Error(
      `panel/projects/ içinde ${found.length} profil var (${found.join(", ")}). Hangisi olduğunu PANEL_PROJECT ile söyle.`,
    );
  }
  return { name: found[0], file: path.join(DIR, `${found[0]}.mjs`) };
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => f.replace(/\.mjs$/, ""))
    .sort();
}

const { name, file } = pick();
const mod = await import(pathToFileURL(file).href);

for (const need of ["id", "title", "jira", "routes"]) {
  if (mod[need] == null) {
    throw new Error(`panel/projects/${name}.mjs içinde "${need}" export'u eksik.`);
  }
}

export const PROJECT = {
  name,
  id: mod.id,
  title: mod.title,
  /** Test edilen urunun adi (panelin adi degil) — kapsam agacinin kok dugumu. */
  product: mod.product ?? mod.title,
  /**
   * Yetenek → connector eslemesi (tracker/design/ai/chat/device).
   * Bkz. panel/connectors/index.mjs. Profil demezse orada makul varsayilan var.
   */
  connectors: mod.connectors ?? null,
  env: { var: null, default: "test", ordersVar: null, ...(mod.env ?? {}) },
  issuePrefixes: mod.issuePrefixes ?? [],
  knownIssuePrefix: mod.knownIssuePrefix ?? null,
  apiHostMatch: mod.apiHostMatch ?? null,
  jira: mod.jira,
  figma: mod.figma ?? { file: null, routes: [] },
  routes: { rules: [], specRuns: {}, cardSpecs: {}, ...mod.routes },
  quickRoutes: mod.quickRoutes ?? [],
  scenarioPresets: mod.scenarioPresets ?? [],
};

/** Aktif ortam adı. `PANEL_ENV` her zaman kazanır; yoksa profilin değişkeni. */
export function activeEnv() {
  const fromProfile = PROJECT.env.var ? process.env[PROJECT.env.var] : "";
  return (process.env.PANEL_ENV || fromProfile || PROJECT.env.default).toLowerCase();
}

/**
 * Gerçek sipariş açan koşumlara izin verilmiş mi. Panel bunu yalnızca GÖSTERİR;
 * guard'ın kendisi suite tarafında.
 */
export function ordersAllowed() {
  const v = PROJECT.env.ordersVar ? process.env[PROJECT.env.ordersVar] : "";
  return (process.env.ALLOW_ORDERS || v) === "1";
}

/** Dayanak kodu yakalayan regex; önekler profilden gelir. Önek yoksa null. */
export function issueRe() {
  if (!PROJECT.issuePrefixes.length) return null;
  return new RegExp(`(?:${PROJECT.issuePrefixes.join("|")})-\\d+`);
}

/** Profillerin listesi (hata mesajları ve `panel:check` için). */
export const profiles = list();
