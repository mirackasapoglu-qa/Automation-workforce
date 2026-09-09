/**
 * Sağlayıcı kayıt defteri (registry).
 *
 * FİKİR: panel çekirdeği "Jira" demez, **"tracker"** der. Hangi sağlayıcının o
 * yeteneği karşıladığını proje profili söyler:
 *
 *     projects/<proje>.mjs → export const connectors = { tracker: "jira", ... }
 *
 * SAĞLAYICILAR OTOMATİK KEŞFEDİLİR: `panel/providers/*.mjs` altındaki her dosya
 * bir sağlayıcıdır; buraya satır eklenmez (eskiden elle liste vardı, 7 taneyle
 * idare ediyordu, 20 taneyle etmezdi). Her dosya şu yüzeyi taşır:
 *
 *   key · label · icon · order · capabilities[] · configured() · check()
 *   auth: { apiKey?: { file, vars:[{name,label,secret}], setupUrl, steps },
 *           oauth2?: { authorizeUrl, tokenUrl, scope, var, tokenType, pkce?, ... } }
 *   + yetenek nesnesi (tracker / design / docs / chat / device)
 *
 * Kimlik ÇÖZÜMÜ sağlayıcının içinde değil `auth/credential-store.mjs`'te
 * (ortam > panel kaydı > dosya, çağrı anında); OAuth akışı `auth/oauth2.mjs`'te.
 * Bu dosya durum satırlarını (preflight) kurar ve arayüze `auth` özetini verir:
 * hangi yol var, hangisi bağlı, kimlik nereden geliyor.
 *
 * YETENEKLER: tracker (kart) · design (tasarım) · docs · ai · chat · device
 * MALİYET: ağ isteyen kontroller 10 dk önbellekli. Figma HİÇ çağrı yapmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROJECT } from "../project.mjs";
import * as OAUTH2 from "../auth/oauth2.mjs";
import { resolve as resolveCred, sourceLabel } from "../auth/credential-store.mjs";
import { isCut, cutAt, setCut } from "./cuts.mjs";

const PROVIDER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "providers");
const DATA_DIR = path.join(process.cwd(), "panel-data");
const REQUIRED = ["key", "label", "capabilities", "configured", "check"];

/** providers/*.mjs → { key: modül }. Bozuk bir sağlayıcı sessizce kaybolmaz, açılışta hata verir. */
async function discover() {
  const files = fs.readdirSync(PROVIDER_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")).sort();
  const out = {};
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(PROVIDER_DIR, f)).href);
    for (const r of REQUIRED) {
      if (mod[r] == null) throw new Error(`providers/${f}: "${r}" export'u eksik`);
    }
    if (!Array.isArray(mod.capabilities) || !mod.capabilities.length) throw new Error(`providers/${f}: capabilities boş`);
    if (mod.auth != null && typeof mod.auth !== "object") throw new Error(`providers/${f}: auth bir nesne olmalı`);
    if (mod.auth?.apiKey && !Array.isArray(mod.auth.apiKey.vars)) throw new Error(`providers/${f}: auth.apiKey.vars dizi olmalı`);
    if (mod.auth?.oauth2 && !(mod.auth.oauth2.authorizeUrl && mod.auth.oauth2.tokenUrl && mod.auth.oauth2.var)) {
      throw new Error(`providers/${f}: auth.oauth2 için authorizeUrl, tokenUrl ve var zorunlu`);
    }
    if (out[mod.key]) throw new Error(`sağlayıcı anahtarı çakışıyor: ${mod.key} (${f})`);
    out[mod.key] = mod;
  }
  return out;
}

/** Kayıtlı tüm sağlayıcılar. */
export const ALL = await discover();

/** Gösterim sırası: `order` (küçük önce), sonra ad. */
const ORDER = Object.values(ALL)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.key.localeCompare(b.key))
  .map((m) => m.key);

/** Bilinen yetenek adları — sağlayıcıların ilan ettikleri + çekirdeğin bildikleri. */
const KNOWN_CAPS = new Set(["tracker", "design", "docs", "ai", "chat", "device", ...Object.values(ALL).flatMap((m) => m.capabilities)]);

/** Profil demezse makul varsayılan — paneli mevcut projelerde bozmamak için. */
const DEFAULT_MAP = { tracker: "jira", design: "figma", docs: "confluence", ai: "claude-code", device: "mobai", chat: null };

/**
 * Panelden yapılan yetenek değişikliği: `panel-data/connectors.json`.
 * Profil KOD; paneli kod yazacak hâle getirmiyoruz. Dosya silinince profile dönülür.
 */
const OVERRIDE_FILE = path.join(DATA_DIR, "connectors.json");
const readOverride = () => { try { return JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf8")); } catch { return {}; } };

/** Bu projenin yetenek → sağlayıcı eşlemesi (profil + panel override'ı). */
export const MAP = { ...DEFAULT_MAP, ...(PROJECT.connectors ?? {}), ...readOverride() };

/** Bu projede fiilen kullanılan sağlayıcı anahtarları (setCapability günceller). */
const USED = new Set(Object.values(MAP).filter(Boolean));

/** Panelden yetenek atama. `null` → o yeteneği kapat. */
export function setCapability(name, key) {
  if (!KNOWN_CAPS.has(name)) throw new Error(`Bilinmeyen yetenek: ${name} (${[...KNOWN_CAPS].join(", ")})`);
  if (key !== null) {
    const mod = ALL[key];
    if (!mod) throw new Error(`Bilinmeyen sağlayıcı: ${key}`);
    if (!mod.capabilities.includes(name)) {
      throw new Error(`${mod.label} "${name}" yeteneğini sunmuyor (sunduğu: ${mod.capabilities.join(", ")}).`);
    }
  }
  const cur = readOverride();
  cur[name] = key;
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(cur, null, 1));
  MAP[name] = key;
  USED.clear();
  for (const v of Object.values(MAP)) if (v) USED.add(v);
  return { ok: true, capability: name, connector: key };
}

/**
 * Bir yeteneği karşılayan sağlayıcı modülü. Çağıran hangi servis olduğunu bilmez.
 * Elle koparılmış sağlayıcı yeteneği KARŞILAMAZ (null) — yarım çalışan servisten iyidir.
 */
export function capability(name) {
  const key = MAP[name];
  if (!key) return null;
  if (isCut(key)) return null;
  const mod = ALL[key];
  if (!mod) throw new Error(`Profil "${name}" için "${key}" diyor ama panel/providers/${key}.mjs yok.`);
  if (!mod.capabilities.includes(name)) {
    throw new Error(`providers/${key}.mjs "${name}" yeteneğini sunmuyor (sunduğu: ${mod.capabilities.join(", ")}).`);
  }
  return mod;
}

/** Kısayol: aktif tracker'ın arayüzü. */
export const tracker = () => capability("tracker")?.tracker ?? null;

// ---- önbellek (yalnız ağ isteyen kontroller)
const CACHE_FILE = path.join(DATA_DIR, ".preflight-cache.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); }
  catch { /* yazilamazsa onbelleksiz devam */ }
};

async function cached(key, ttlMs, fn) {
  const c = readJson(CACHE_FILE, {});
  // Anahtar profili içerir: iki profil aynı makinede aynı dosyayı paylaşıyor.
  const ck = `${PROJECT.id}:${key}`;
  const hit = c[ck];
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cachedAgeSec: Math.round((Date.now() - hit.at) / 1000) };
  const value = await fn();
  c[ck] = { at: Date.now(), value };
  writeJson(CACHE_FILE, c);
  return { ...value, cachedAgeSec: 0 };
}

/** Bir sağlayıcının önbellekli satırını düşür — kimlik değişince taze sonuç görünsün. */
export function invalidatePreflight(key) {
  const c = readJson(CACHE_FILE, {});
  if (delete c[`${PROJECT.id}:${key}`]) writeJson(CACHE_FILE, c);
}

/** Ağ isteyen sağlayıcılar — 10 dk önbellek. Diğerleri yerel ve bedava. */
const NETWORK = new Set(["jira", "linear", "slack"]);
const TTL = 10 * 60 * 1000;

/** Arayüzün göreceği kimlik özeti: hangi yollar var, hangisi bağlı, kaynak ne. */
function authSummary(mod, origin) {
  const out = {};
  const ak = mod.auth?.apiKey;
  if (ak) {
    const r = resolveCred(mod.key, ak.vars.map((v) => v.name), { file: ak.file });
    out.apiKey = {
      vars: ak.vars.map((v) => ({ name: v.name, label: v.label ?? v.name, secret: Boolean(v.secret) })),
      setupUrl: ak.setupUrl ?? null,
      steps: ak.steps ?? [],
      connected: r.ok,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      expiresAt: r.expiresAt ?? null,
    };
  }
  if (mod.auth?.oauth2) {
    out.oauth2 = OAUTH2.statusFor({ dataDir: DATA_DIR, svc: mod.key, cfg: mod.auth.oauth2, origin });
  }
  return out;
}

/** Tek bir sağlayıcının durum satırı. Kullanılmayan `passive` işaretlenir: rozeti etkilemez. */
async function row(key, origin) {
  const mod = ALL[key];
  const used = USED.has(key);
  const auth = authSummary(mod, origin);
  const base = {
    key,
    label: mod.label,
    canCut: true,
    cut: isCut(key) || undefined,
    icon: mod.icon ?? undefined,
    credential: mod.credentialLabel,
    credentialSource: auth.apiKey?.source ?? (auth.oauth2?.connected ? "oauth" : null),
    credentialSourceLabel: sourceLabel(auth.apiKey?.source ?? (auth.oauth2?.connected ? "oauth" : null)),
    setupUrl: mod.setupUrl ?? undefined,
    capabilities: mod.capabilities,
    passive: !used || undefined,
    auth,
    /** Geriye dönük: arayüzün OAuth kutusu `c.oauth`a bakıyor. */
    oauth: auth.oauth2,
  };

  if (isCut(key)) {
    const ne = cutAt(key);
    return {
      ...base,
      state: "off",
      detail: `elle koparıldı${ne ? ` · ${new Date(ne).toLocaleString("tr-TR")}` : ""}`,
      note: "Kimlik, OAuth token'ı ve oturumlar YERİNDE duruyor — yalnızca kullanım kapalı. Rozete tıklayınca geri bağlanır.",
      fix: [],
    };
  }

  if (!used) {
    let has = false;
    if (mod.local !== false) {
      try { has = await mod.configured(); } catch { has = false; }
    }
    const bagli = auth.oauth2?.connected || has;
    return {
      ...base,
      state: bagli ? "unknown" : "off",
      detail: auth.oauth2?.connected
        ? "bağlandı (OAuth) — bu projede kullanılmıyor"
        : has ? "kimlik var — bu projede kullanılmıyor" : `bu projede kullanılmıyor (${mod.capabilities.join("/")})`,
      note: `Kullanmak için: projects/${PROJECT.id}.mjs → connectors.${mod.capabilities[0]} = "${key}"`,
      fix: [],
    };
  }

  const run = () => Promise.resolve(mod.check());
  const r = NETWORK.has(key) ? await cached(key, TTL, run) : await run();
  return { ...base, ...r };
}

/** Panelden kopar / geri bağla. Bilinmeyen anahtar sessizce geçmesin. */
export function setConnectorCut(key, cut) {
  if (!ALL[key]) throw new Error(`Bilinmeyen sağlayıcı: ${key}`);
  const out = setCut(key, cut);
  invalidatePreflight(key);
  return out;
}

/** Panelin "Bağlantılar" listesi. `extra` ile çağıran kendi satırlarını ekler. */
export async function preflight(extra = [], opts = {}) {
  const rows = await Promise.all(ORDER.map((k) => row(k, opts.origin)));
  return [...rows, ...extra];
}
