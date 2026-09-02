/**
 * Connector kayıt defteri.
 *
 * FİKİR: panel çekirdeği "Jira" demez, **"tracker"** der. Hangi servisin o
 * yeteneği karşıladığını proje profili söyler:
 *
 *     projects/<proje>.mjs → export const connectors = { tracker: "jira", ... }
 *
 * Böylece Linear kullanan bir proje eklendiğinde çekirdekte tek satır
 * değişmez — profilde `tracker: "linear"` yazmak yeter. Flowscope'un kapsam
 * ağacını taşırken bu şart: orada "❌ için Jira ID zorunlu" kuralı her yere
 * SABİT kodlanmış (R3-R9), o hâliyle Linear kullanan proje sisteme giremez.
 *
 * YETENEKLER: tracker (kart) · design (tasarım) · ai · chat (bildirim) · device
 *
 * MALİYET: ağ isteyen kontroller 10 dk önbellekli. Figma HİÇ çağrı yapmaz
 * (kotası ayda 6 istek — yoklamanın kendisi tüketiyordu).
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../project.mjs";

import * as claudeCode from "./claude-code.mjs";
import * as figma from "./figma.mjs";
import * as jira from "./jira.mjs";
import * as linear from "./linear.mjs";
import * as mobai from "./mobai.mjs";
import * as slack from "./slack.mjs";

/** Kayıtlı tüm connector'lar. Yeni servis = bu listeye bir satır. */
export const ALL = { "claude-code": claudeCode, figma, jira, linear, mobai, slack };

/** Gösterim sırası: önce çekirdek iş (kart/tasarım), sonra yardımcılar. */
const ORDER = ["claude-code", "figma", "jira", "linear", "mobai", "slack"];

/** Profil demezse makul varsayılan — paneli mevcut projelerde bozmamak için. */
const DEFAULT_MAP = { tracker: "jira", design: "figma", ai: "claude-code", device: "mobai", chat: null };

/** Bu projenin yetenek → connector eşlemesi. */
export const MAP = { ...DEFAULT_MAP, ...(PROJECT.connectors ?? {}) };

/** Bu projede fiilen kullanılan connector anahtarları. */
const USED = new Set(Object.values(MAP).filter(Boolean));

/**
 * Bir yeteneği karşılayan connector modülünü döndürür.
 * Çağıran taraf hangi servis olduğunu bilmez — kural bu.
 * @example const t = capability("tracker"); await t.tracker.createIssue({...})
 */
export function capability(name) {
  const key = MAP[name];
  if (!key) return null;
  const mod = ALL[key];
  if (!mod) throw new Error(`Profil "${name}" için "${key}" diyor ama panel/connectors/${key}.mjs yok.`);
  if (!mod.capabilities.includes(name)) {
    throw new Error(`connectors/${key}.mjs "${name}" yeteneğini sunmuyor (sunduğu: ${mod.capabilities.join(", ")}).`);
  }
  return mod;
}

/** Kısayol: aktif tracker'ın arayüzü (Jira mı Linear mı — çağıranı ilgilendirmez). */
export const tracker = () => capability("tracker")?.tracker ?? null;

// ---- önbellek (yalnız ağ isteyen kontroller)
const CACHE_FILE = path.join(process.cwd(), "panel-data", ".preflight-cache.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); }
  catch { /* yazilamazsa onbelleksiz devam */ }
};

async function cached(key, ttlMs, fn) {
  const c = readJson(CACHE_FILE, {});
  /*
   * ⚠️ ANAHTAR PROFILI ICERIR. Onbellek dosyasi makine genelinde tek; iki
   * profil (ornek: homee ve mto) ayni anda kosunca `jira` anahtari birbirini
   * eziyordu ve MAC panelinin "Baglantilar" listesi MTO'nun sonucunu
   * gosteriyordu (olculdu 2026-08-27: 4646 paneli "Mirac · MTO" diyordu).
   */
  const ck = `${PROJECT.id}:${key}`;
  const hit = c[ck];
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cachedAgeSec: Math.round((Date.now() - hit.at) / 1000) };
  const value = await fn();
  c[ck] = { at: Date.now(), value };
  writeJson(CACHE_FILE, c);
  return { ...value, cachedAgeSec: 0 };
}

/** Ağ isteyen connector'lar — 10 dk önbellek. Diğerleri yerel ve bedava. */
const NETWORK = new Set(["jira", "linear", "slack"]);
const TTL = 10 * 60 * 1000;

/**
 * Tek bir connector'ın durum satırı.
 * Projede kullanılmayan connector `passive` işaretlenir: rozeti ve genel
 * durumu ETKİLEMEZ — panelin işleyişi ona bağlı değil.
 */
async function row(key) {
  const mod = ALL[key];
  const used = USED.has(key);
  const base = {
    key,
    label: mod.label,
    icon: mod.icon ?? undefined,
    credential: mod.credentialLabel,
    capabilities: mod.capabilities,
    passive: !used || undefined,
  };

  if (!used) {
    // Kullanılmıyorsa AĞA ÇIKMA — sadece kimlik var mı diye bak.
    // `local === false` diyen connector'ın configured()'ı da ağa çıkar (mobai
    // köprüyü yokluyor); kullanılmıyorken onu hiç çağırmıyoruz, yoksa her
    // preflight boşa timeout bekliyordu.
    let has = false;
    if (mod.local !== false) {
      try { has = await mod.configured(); } catch { has = false; }
    }
    return {
      ...base,
      state: has ? "unknown" : "off",
      detail: has
        ? "kimlik var — bu projede kullanılmıyor"
        : `bu projede kullanılmıyor (${mod.capabilities.join("/")})`,
      note: `Kullanmak için: projects/${PROJECT.id}.mjs → connectors.${mod.capabilities[0]} = "${key}"`,
      fix: [],
    };
  }

  const run = () => Promise.resolve(mod.check());
  const r = NETWORK.has(key) ? await cached(key, TTL, run) : await run();
  return { ...base, ...r };
}

/**
 * Panelin "Bağlantılar" listesi. `extra` ile çağıran taraf kendi satırlarını
 * ekler (kapı oturumu gibi projeye özgü, servis olmayan şeyler).
 */
export async function preflight(extra = []) {
  const rows = await Promise.all(ORDER.map(row));
  return [...rows, ...extra];
}
