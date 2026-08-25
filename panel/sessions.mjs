/**
 * Oturum kasası — "her URL çalışsın"ın kimlik tarafı.
 *
 * PROBLEM: her ürün farklı korunuyor. Biri "Geçici Erişim" kapısının arkasında,
 * biri Google OAuth, biri kendi form login'i, biri 2FA. Her biri için ayrı kod
 * yazmak çıkmaz sokak.
 *
 * ÇÖZÜM: kimlik doğrulamayı UYGULAMA YAPMAZ — insan yapar. Görünür bir tarayıcı
 * penceresi açılır, kişi sitenin kendi ekranında ne gerekiyorsa girer ("Girişi
 * tamamladım"a basar), oluşan oturum (cookie + localStorage) kasaya yazılır.
 * Sonrasında tarama ve koşum o oturumu kullanır. Şifre bu araca hiç girilmez,
 * hiçbir yerde saklanmaz.
 *
 * ANAHTAR = HOST. Bir oturum yalnızca kendi host'una takılır. Bu bir kolaylık
 * değil güvenlik kuralı: aksi halde bir müşteri ortamının cookie'leri başka bir
 * siteye gönderilebilirdi.
 *
 * ESKI DOSYALARLA UYUM: suite `playwright/.auth/<ortam>-gate.json` kullanmaya
 * devam ediyor (playwright.config oradan okuyor). Kasa onu EZMEZ; proje host'u
 * için kasada kayıt yoksa o dosyaya düşer.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT, activeEnv } from "./project.mjs";

const DIR = path.join(process.cwd(), "panel-data", "sessions");
const nowIso = () => new Date().toISOString();

/** Host → dosya adı. Nokta ve iki nokta dosya adında sorun çıkarmasın. */
const slug = (host) => host.replace(/[^a-zA-Z0-9.-]/g, "_");

const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

/** Kasadaki tüm oturumlar (state gövdesi HARİÇ — listeleme ucuz kalsın). */
export function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(DIR, f)))
    .filter(Boolean)
    .map(({ host, label, createdAt, updatedAt, state }) => ({
      host, label, createdAt, updatedAt,
      cookies: state?.cookies?.length ?? 0,
      ...health(state),
    }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * Oturumun sağlığı: en YAKIN dolan cookie'ye bakar.
 *
 * NEDEN dosya yaşına değil: dolmuş bir oturumla yapılan ölçüm hata vermiyor,
 * sessizce yanlış sonuç üretiyor (her sayfa giriş/kapı ekranı döner ama HTTP
 * 200'dür). 20 Ağustos'ta dolmuş bir kapı 33 rotalık ölçümü çöpe attırmıştı.
 */
export function health(state) {
  const cookies = state?.cookies ?? [];

  /**
   * Profil kimlik cookie'sinin ADINI söylüyorsa yalnızca ona bakılır — kesin
   * bilgi. Söylemiyorsa sezgiye düşülür (aşağıda).
   */
  const adlar = PROJECT.authCookies ?? [];
  const kimlik = adlar.length ? cookies.filter((c) => adlar.includes(c.name)) : [];

  /**
   * ⚠️ SEZGİ: kimlik cookie'si bilinmiyorsa "en yakın dolan cookie" YANLIŞ
   * ölçüt. Ölçüldü (2026-08-25): kapı oturumundaki 8 cookie'den üçü üçüncü
   * taraf analitiği (`personaclick_*`, `sid_*`) ve saatler önce dolmuş, ama
   * asıl kimlik (`temporary_auth_verified`) yarına kadar geçerliydi. En yakına
   * bakmak "oturum bitti" diye yanlış alarm veriyordu.
   *
   * O yüzden: DOLMUŞLAR YOK SAYILIR, sayıları ayrıca bildirilir. Hiçbirinin
   * geleceği yoksa oturum gerçekten bitmiştir.
   *
   * Bu bir sezgi — kesin doğrulama, oturumla korumalı bir sayfayı açıp giriş
   * ekranına düşülmediğini görmektir. Profil `authCookies` verirse sezgi devre
   * dışı kalır.
   */
  const havuz = kimlik.length ? kimlik : cookies;
  const suresi = havuz.map((c) => c.expires).filter((e) => typeof e === "number" && e > 0).map((e) => e * 1000);
  if (!suresi.length) return { hoursLeft: null, status: "unknown", expiredCount: 0, precise: kimlik.length > 0 };

  const gelecek = suresi.filter((t) => t > Date.now());
  const expiredCount = suresi.length - gelecek.length;
  if (!gelecek.length) {
    return { hoursLeft: 0, status: "expired", expiredCount, precise: kimlik.length > 0 };
  }
  const hoursLeft = (Math.min(...gelecek) - Date.now()) / 3_600_000;
  return {
    hoursLeft: Number(hoursLeft.toFixed(1)),
    status: hoursLeft < 4 ? "warn" : "ok",
    expiredCount,
    precise: kimlik.length > 0,
  };
}

/** Bir host için kasadaki kayıt (state dahil) ya da null. */
export function get(host) {
  const f = path.join(DIR, `${slug(host)}.json`);
  return fs.existsSync(f) ? readJson(f) : null;
}

export function save({ host, label, state }) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, `${slug(host)}.json`);
  const eski = readJson(f);
  const kayit = {
    host,
    label: label ?? eski?.label ?? host,
    createdAt: eski?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    state,
  };
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(kayit, null, 1));
  fs.renameSync(tmp, f);
  return { host, ...health(state) };
}

export function remove(host) {
  const f = path.join(DIR, `${slug(host)}.json`);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

/** Projenin eski kapı dosyası — kasa boşsa buna düşülür. */
function legacyGateFile() {
  const f = path.join(process.cwd(), "playwright", ".auth", `${activeEnv()}-gate.json`);
  return fs.existsSync(f) ? f : null;
}

/**
 * Hedef URL için kullanılacak oturumu çözer.
 *
 * @returns {{storageState: object|string, source: string, hoursLeft: number|null}|null}
 *   `storageState` doğrudan Playwright'a verilebilir (obje ya da dosya yolu).
 */
export function resolveFor(targetUrl, projectBaseUrl = "") {
  const host = hostOf(targetUrl);
  if (!host) return null;

  const kasa = get(host);
  if (kasa?.state) {
    const h = health(kasa.state);
    return { storageState: kasa.state, source: `kasa:${host}`, ...h };
  }

  // Kasada yok: yalnızca projenin KENDİ host'u için eski kapı dosyasına düş.
  const sameHost = projectBaseUrl && host === hostOf(projectBaseUrl);
  if (sameHost) {
    const f = legacyGateFile();
    if (f) {
      const st = readJson(f);
      return { storageState: f, source: `eski-kapi:${activeEnv()}`, ...health(st) };
    }
  }
  return null;
}

/** Panelin "Bağlantılar" listesine tek satır: kaç oturum, en kötü durum. */
export function preflightRow() {
  const hepsi = list();
  const legacy = legacyGateFile();
  if (!hepsi.length) {
    return {
      key: "sessions",
      label: "Oturumlar",
      state: legacy ? "unknown" : "off",
      detail: legacy
        ? `kasa boş — proje host'u için eski kapı dosyası kullanılıyor (${activeEnv()})`
        : "kayıtlı oturum yok — korumalı siteler taranamaz",
      credential: "panel-data/sessions/<host>.json",
      note: "Oturum insan tarafından bir kez açılır (görünür pencere); şifre panele girilmez.",
      fix: hepsi.length ? [] : ["Kapsam ekranında 'URL'den İçe Aktar' → 'giriş yapmam gerekiyor' ile bir oturum oluştur"],
    };
  }
  const kotu = hepsi.filter((s) => s.status === "expired");
  const yakin = hepsi.filter((s) => s.status === "warn");
  return {
    key: "sessions",
    label: "Oturumlar",
    state: kotu.length ? "blocked" : yakin.length ? "warn" : "ok",
    detail: hepsi
      .map((s) => `${s.host}: ${s.hoursLeft === null ? "süre bilinmiyor" : `${s.hoursLeft} saat`}`)
      .join(" · "),
    credential: "panel-data/sessions/<host>.json",
    note: `${hepsi.length} oturum. Dolmuş oturum hata vermez, sessizce yanlış ölçüm üretir — bu yüzden süre burada duruyor.`,
    fix: kotu.length ? [`Dolmuş oturumu yenile: ${kotu.map((s) => s.host).join(", ")}`] : [],
  };
}

// ---------------- insan destekli giriş akışı ----------------
const loginJobs = new Map();

/**
 * Görünür bir tarayıcı açar ve kişinin giriş yapmasını bekler.
 * `confirmLogin` çağrılınca oluşan oturumu kasaya yazar.
 */
export function startLogin({ url, label }) {
  const host = hostOf(url);
  if (!host) return { ok: false, error: "Geçersiz URL." };
  const id = `login-${slug(host)}-${Date.now().toString(36)}`;
  const job = {
    id, url, host, label: label ?? host,
    status: "waiting_login",   // waiting_login | saved | error | cancelled
    error: null, confirmed: false, cancelled: false,
    startedAt: nowIso(),
  };
  loginJobs.set(id, job);
  runLogin(job).catch((e) => { job.status = "error"; job.error = e.message; });
  return { ok: true, id, host };
}

export const getLogin = (id) => { const j = loginJobs.get(id); return j ? { ...j } : null; };
export const confirmLogin = (id) => { const j = loginJobs.get(id); if (j) j.confirmed = true; };
export const cancelLogin = (id) => { const j = loginJobs.get(id); if (j) j.cancelled = true; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN_TIMEOUT_MS = 600_000;

async function runLogin(job) {
  const { chromium } = await import("@playwright/test");
  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: "chrome" });
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try { await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 }); }
    catch { /* acilmasa da kisi pencerede elle gezinebilir */ }

    let waited = 0;
    while (!job.confirmed) {
      if (job.cancelled) { job.status = "cancelled"; return; }
      await sleep(500);
      waited += 500;
      if (waited > LOGIN_TIMEOUT_MS) {
        job.status = "error";
        job.error = "Giriş için ayrılan süre (10 dakika) doldu.";
        return;
      }
    }
    const state = await ctx.storageState();
    const sonuc = save({ host: job.host, label: job.label, state });
    job.status = "saved";
    job.result = sonuc;
  } finally {
    await browser.close().catch(() => {});
  }
}
