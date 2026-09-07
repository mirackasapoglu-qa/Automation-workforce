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
 * YETENEKLER: tracker (kart) · design (tasarım) · docs (dokümantasyon) · ai · chat (bildirim) · device
 *
 * MALİYET: ağ isteyen kontroller 10 dk önbellekli. Figma HİÇ çağrı yapmaz
 * (kotası ayda 6 istek — yoklamanın kendisi tüketiyordu).
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../project.mjs";

import * as OAUTH from "../oauth.mjs";
import { isCut, cutAt, setCut } from "./cuts.mjs";

import * as claudeCode from "./claude-code.mjs";
import * as confluence from "./confluence.mjs";
import * as figma from "./figma.mjs";
import * as jira from "./jira.mjs";
import * as linear from "./linear.mjs";
import * as mobai from "./mobai.mjs";
import * as slack from "./slack.mjs";

/** Kayıtlı tüm connector'lar. Yeni servis = bu listeye bir satır. */
export const ALL = { "claude-code": claudeCode, confluence, figma, jira, linear, mobai, slack };

/** Gösterim sırası: önce çekirdek iş (kart/tasarım/doküman), sonra yardımcılar. */
const ORDER = ["claude-code", "figma", "jira", "confluence", "linear", "mobai", "slack"];

/** Profil demezse makul varsayılan — paneli mevcut projelerde bozmamak için. */
const DEFAULT_MAP = { tracker: "jira", design: "figma", docs: "confluence", ai: "claude-code", device: "mobai", chat: null };

/**
 * Panelden yapılan yetenek değişikliği: `panel-data/connectors.json`.
 *
 * NEDEN dosya, neden profili düzenlemiyoruz: profil KOD (`projects/<proje>.mjs`)
 * ve paneli kod yazacak hâle getirmek istemiyoruz. "Bu projede kullan"
 * düğmesi bu küçük JSON'a yazar, profil olduğu gibi kalır ve dosya silinince
 * profildeki değere geri dönülür.
 */
const OVERRIDE_FILE = path.join(process.cwd(), "panel-data", "connectors.json");
const readOverride = () => {
  try { return JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf8")); } catch { return {}; }
};

/** Bu projenin yetenek → connector eşlemesi (profil + panel override'ı). */
export const MAP = { ...DEFAULT_MAP, ...(PROJECT.connectors ?? {}), ...readOverride() };

/** Panelden yetenek atama. `null` → o yeteneği kapat. */
export function setCapability(name, key) {
  if (!Object.hasOwn(DEFAULT_MAP, name)) {
    throw new Error(`Bilinmeyen yetenek: ${name} (${Object.keys(DEFAULT_MAP).join(", ")})`);
  }
  if (key !== null) {
    const mod = ALL[key];
    if (!mod) throw new Error(`Bilinmeyen connector: ${key}`);
    if (!mod.capabilities.includes(name)) {
      throw new Error(`${mod.label} "${name}" yeteneğini sunmuyor (sunduğu: ${mod.capabilities.join(", ")}).`);
    }
  }
  const cur = readOverride();
  cur[name] = key;
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(cur, null, 1));
  // MAP modül yüklenirken donuyor; değişiklik sunucu yeniden başlayınca değil
  // HEMEN geçerli olsun diye canlı nesne de güncellenir.
  MAP[name] = key;
  USED.clear();
  for (const v of Object.values(MAP)) if (v) USED.add(v);
  return { ok: true, capability: name, connector: key };
}

/** Bu projede fiilen kullanılan connector anahtarları (setCapability günceller). */
const USED = new Set(Object.values(MAP).filter(Boolean));

/**
 * Bir yeteneği karşılayan connector modülünü döndürür.
 * Çağıran taraf hangi servis olduğunu bilmez — kural bu.
 * @example const t = capability("tracker"); await t.tracker.createIssue({...})
 */
export function capability(name) {
  const key = MAP[name];
  if (!key) return null;
  /*
   * Elle koparilmis connector yetenegi KARSILAMAZ. Cagiranlar `null`i zaten
   * dogru isliyor ("tracker tanimli degil" gibi acik bir yanit doner) —
   * yarim calisan bir servisten iyidir.
   */
  if (isCut(key)) return null;
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
const DATA_DIR = path.join(process.cwd(), "panel-data");

async function row(key, origin) {
  const mod = ALL[key];
  const used = USED.has(key);
  const base = {
    key,
    label: mod.label,
    /** Panelden koparilip geri baglanabilir — kapi/oturum satirlarinda yok. */
    canCut: true,
    cut: isCut(key) || undefined,
    icon: mod.icon ?? undefined,
    credential: mod.credentialLabel,
    /** Token uretme sayfasi — arayuz "kimlik" satirini buna link yapar. */
    setupUrl: mod.setupUrl ?? undefined,
    capabilities: mod.capabilities,
    passive: !used || undefined,
    /*
     * OAuth durumu: "Bağlan" düğmesini gösterecek mi, uygulama kaydı var mı,
     * bağlıysa ne zamandan beri. Sağlayıcısı olmayan connector'da alan yok.
     */
    oauth: OAUTH.isSupported(key) ? OAUTH.statusFor(DATA_DIR, key, origin) : undefined,
  };

  /*
   * Koparilmissa AG YOKLAMASI YAPILMAZ: sonucu kullanilmayacak bir istek hem
   * kotadan yer (Figma) hem preflight'i yavaslatir. Satir neden kopuk oldugunu
   * ve geri acmanin tek tik oldugunu soyler.
   */
  if (isCut(key)) {
    const ne = cutAt(key);
    return {
      ...base,
      state: "off",
      detail: `elle koparıldı${ne ? ` · ${new Date(ne).toLocaleString("tr-TR")}` : ""}`,
      note:
        "Kimlik, OAuth token'ı ve oturumlar YERİNDE duruyor — yalnızca " +
        "kullanım kapalı. Rozete tıklayınca geri bağlanır.",
      fix: [],
    };
  }

  if (!used) {
    // Kullanılmıyorsa AĞA ÇIKMA — sadece kimlik var mı diye bak.
    // `local === false` diyen connector'ın configured()'ı da ağa çıkar (mobai
    // köprüyü yokluyor); kullanılmıyorken onu hiç çağırmıyoruz, yoksa her
    // preflight boşa timeout bekliyordu.
    let has = false;
    if (mod.local !== false) {
      try { has = await mod.configured(); } catch { has = false; }
    }
    const bagli = base.oauth?.connected || has;
    return {
      ...base,
      state: bagli ? "unknown" : "off",
      detail: base.oauth?.connected
        ? "bağlandı (OAuth) — bu projede kullanılmıyor"
        : has
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
/** Panelden kopar / geri bagla. Bilinmeyen anahtar sessizce gecmesin. */
export function setConnectorCut(key, cut) {
  if (!ALL[key]) throw new Error(`Bilinmeyen connector: ${key}`);
  const out = setCut(key, cut);
  /*
   * Onbellekteki satiri dusur: geri baglandiginda 10 dk'lik eski sonuc degil,
   * TAZE bir yoklama gorunsun. Kopartirken de dusuyoruz — kopukken saklanan
   * bir sey yok, ama sira/artik kalmasin.
   */
  const c = readJson(CACHE_FILE, {});
  if (delete c[`${PROJECT.id}:${key}`]) writeJson(CACHE_FILE, c);
  return out;
}

export async function preflight(extra = [], opts = {}) {
  const rows = await Promise.all(ORDER.map((k) => row(k, opts.origin)));
  return [...rows, ...extra];
}
