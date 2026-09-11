#!/usr/bin/env node
/**
 * QA Paneli — http://localhost:4646  (PANEL_PORT ile degisir)
 *
 * Mimari: whitelist'li kosum tetikleme + SSE canli log + verdict/kanit kaydi
 * + rapor gorunumu + JIRA katmani.
 *
 * Bu dosya hangi projede kostugunu bilmez: proje adi, Jira anahtari, Figma
 * dosyasi, rota/kart eslemeleri ve ortam degiskeni adlari panel/projects/
 * icindeki profilden gelir (bkz. panel/project.mjs).
 *
 * Jira kimligi ~/.jira-credentials'tan okunur (repoya yazilmaz). Yazma uclari
 * (/api/jira/comment, /api/jira/transition, /api/jira/bug) SADECE kullanici
 * panelden tetikleyince calisir; otomatik yazma YOK.
 *
 * Guvenlik notu: sadece panel/runs.json icindeki komutlar calisir. Istekten gelen
 * serbest komut ASLA exec edilmez.
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../env.mjs";
import {
  JIRA,
  ALL_SORTER,
  flowscopeSorter,
  getCards,
  getCard,
  postComment,
  transition,
  createBug,
  whoami,
  attachFile,
  assignableUsers,
  testJql,
} from "./jira.mjs";
import { listSorters, saveSorter, deleteSorter } from "./jira-sorters.mjs";
import { startProxy } from "./proxy.mjs";
import { matchRoute, runsForCard, CARD_SPECS } from "./route-map.mjs";
import { PROJECT, activeEnv, ordersAllowed, issueRe } from "./project.mjs";

/**
 * Sipariş tamamlama guard'ının OTURUM İÇİ override'ı.
 *
 * `null` = dokunulmamış, `.env`deki değer geçerli. `true/false` = panelden elle
 * açıldı/kapatıldı. `.env` KASITLI OLARAK yazılmıyor: kalıcı 1 yapmak toplu
 * koşumlarda siparişi tamamlayan spec'i de tetikler ve her tetiklenme iptal
 * edilemeyen bir sipariş kaydı bırakır (iptal akışı POM'da yok). Override panel
 * kapanınca kendiliğinden sıfırlanır — güvenli varsayılan.
 */
let ordersOverride = null;
const ordersOn = () => ordersOverride ?? ordersAllowed();
/** Koşum sürecine geçirilecek guard ortam değişkeni (override varsa). */
const ordersEnv = () =>
  ordersOverride === null || !PROJECT.env.ordersVar
    ? {}
    : { [PROJECT.env.ordersVar]: ordersOverride ? "1" : "0" };
import { figmaForRoute } from "./figma-map.mjs";
import { preflight } from "./preflight.mjs";
import { tracker } from "./connectors/index.mjs";
import { readTree, writeTree, countNodes, findNode as findScopeNode, applyRunResults, attachJiraTask, collectJiraTaskIds, sweepJiraStatuses, collectVerifiedResourceLinks, sweepResourceDrift, findNodesByJiraTask } from "./scope.mjs";
import { extractFigmaFileKey, lastModifiedByKey as figmaLastModifiedByKey } from "./design-drift.mjs";
import { extractConfluencePageId, lastModifiedByKey as confluenceLastModifiedByKey } from "./confluence.mjs";
import * as crawler from "./crawler.mjs";
import { validateTarget, createRateLimiter, clientKey } from "./crawl-guard.mjs";
import * as sessions from "./sessions.mjs";
import { runCommentDraft, verdictCommentDraft } from "./jira-report.mjs";
import { capture as perfCapture, list as perfHistory, diffRoutes } from "./perf-history.mjs";
/*
 * HTTP katmani: yeni uclar panel/routes/*.mjs icinde, createRouter ile kayitli
 * (auth/body bayraklari kayitta). Kosum motoru run-engine.mjs; SSE havuzu
 * http/sse.mjs. Asagidaki if-zinciri henuz tasinmamis eski uclar icin duruyor.
 */
import { createRouter } from "./http/router.mjs";
import { createSseHub } from "./http/sse.mjs";
import { createRunEngine } from "./run-engine.mjs";
import { readPerfData } from "./perf-read.mjs";
import { registerAiRoutes } from "./routes/ai.mjs";
import { registerRagRoutes } from "./routes/rag.mjs";
import { registerRunRoutes } from "./routes/runs.mjs";
import { registerAssetRoutes } from "./routes/assets.mjs";
import { registerConnectorRoutes } from "./routes/connectors.mjs";
import { registerClaudeRoutes } from "./routes/claude.mjs";
import { createRunGate } from "./run-queue.mjs";
import { listMapping, mappingFor, setMapping, clearMapping, snippet as mapSnippet } from "./card-map.mjs";
import * as runJournal from "./run-journal.mjs";
import { renderForRoute, cachedRoutes } from "./figma-render.mjs";
import {
  readHistory,
  lastOf,
  historyStats,
  mergeHistory,
  lastResults,
} from "./case-history.mjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PANEL_PORT || 4646);
const ENV = activeEnv();
const ISSUE_RE = issueRe();
const API_HOST_RE = PROJECT.apiHostMatch ? new RegExp(PROJECT.apiHostMatch) : null;
const BASE_URL = process.env[`BASE_URL_${ENV.toUpperCase()}`] || "";

const DATA_DIR = path.join(ROOT, "panel-data");
const VERDICT_DIR = path.join(DATA_DIR, "verdicts");
const EVIDENCE_DIR = path.join(DATA_DIR, "evidence");
for (const d of [DATA_DIR, VERDICT_DIR, EVIDENCE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const RUNS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "runs.json"), "utf8"),
).runs;

// ---------------- guvenlik ----------------
/**
 * Panel localhost'ta dinleyen bir HTTP sunucusu: gezdigin HERHANGI bir sayfa ona
 * istek atabilir (CSRF) ve makinedeki her surec uclari cagirabilir. Bu yuzden:
 *  - acilista oturum token'i uretilir, index.html'e enjekte edilir (baska origin
 *    HTML'i okuyamaz, dolayisiyla token'i alamaz)
 *  - TUM yazma uclari `x-panel-token` ister
 *  - Origin verilmisse localhost olmak zorunda
 */
/**
 * Panel token'i DISKTE kalici. Eskiden her baslangicta yeniden uretiliyordu ve
 * sunucu yeniden basladiginda ACIK SEKMELERDEKI token eskiyordu: kullanici
 * "Panel token gerekli" hatasi aliyor, sayfayi yenileyince de o ana kadar
 * toplanmis kayit adimlarini KAYBEDIYORDU (2026-08-21'de 52 adim boyle riske girdi).
 * Dosya panel-data altinda ve gitignore'da.
 */
/**
 * Kaydedici taslaklari BURAYA yazilir — `tests/` altina DEGIL.
 *
 * Neden: playwright.config.ts `testDir: "./tests"` diyor, yani tests/ altindaki
 * her alt klasor de toplaniyor. Taslaklar orada dururken (a) ham adimlarla
 * gercek suite'e karisiyorlar, (b) uye fixture'i iceren taslagin `./fixtures`
 * import'u alt klasorden cozulemedigi icin TUM suite "0 tests in 0 files"
 * veriyordu. Karantina testDir'in disinda olmali.
 */
/** Regex'e gomulecek metni kacir — toHaveURL(new RegExp(...)) icin. */
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RECORD_DIR = path.join(process.cwd(), "panel-data", "recorded");

/**
 * Taslaklar `./fixtures`den import ediyor (tests/ altina tasindiklarinda dogru
 * olan yol bu). Yerinde de kosabilsinler diye karantinaya ayni adla bir kopru
 * yaziyoruz. panel-data gitignore'da, dosya silinmis olabilir — her seferinde
 * varligini garanti ediyoruz.
 */
function ensureDraftBridge() {
  fs.mkdirSync(RECORD_DIR, { recursive: true });
  const f = path.join(RECORD_DIR, "fixtures.ts");
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, `export * from "../../tests/fixtures";\n`, "utf8");
  }
}

/** Karantinadaki taslak dosya adini dogrular; disaridan yol gecirilemez. */
function draftFile(name) {
  const base = path.basename(String(name ?? ""));
  if (!/^[\w.-]+\.spec\.ts$/.test(base)) return null;
  const full = path.join(RECORD_DIR, base);
  if (!fs.existsSync(full)) return null;
  return { base, full };
}

/**
 * BAYAT SUREC TESPITI.
 *
 * Panelin arayuzu (public/*.html) her istekte DISKTEN okunuyor, sunucu kodu ise
 * surec basladiginda bir kere yukleniyor. Yani `git pull` ya da bir duzenleme
 * sonrasi tarayicidaki arayuz YENI, calisan sunucu ESKI olabiliyor — kullanici
 * yeni bir dugmeye basiyor ve "Bilinmeyen uc: /api/..." goruyor. Bu 2026-08-26'da
 * gerceklesti: arayuz kart bazli test case uretimini gosteriyordu ama 3 saat once
 * baslatilmis surecte o uc yoktu.
 *
 * Cozum: panel dosyalarinin en yeni degisiklik zamani surecin basladigi andan
 * SONRA ise arayuz bunu bir seritte soyluyor. Tarih karsilastirmasi yeterli;
 * icerik hash'i almak her istekte butun panel dizinini okumak demekti.
 */
const BOOT_MS = Date.now();
const PANEL_DIR = path.join(ROOT, "panel");

function newestPanelMtime() {
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // panel-data surekli yaziliyor (verdict, kanit, log) — surum sinyali degil.
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch { /* silinmis olabilir */ }
      }
    }
  };
  walk(PANEL_DIR);
  return newest;
}

/** 5 sn onbellek: serit her sayfa yuklemesinde soruyor, dizin taramasi bedava degil. */
let mtimeCache = { at: 0, value: 0 };
function panelMtime() {
  if (Date.now() - mtimeCache.at < 5000) return mtimeCache.value;
  mtimeCache = { at: Date.now(), value: newestPanelMtime() };
  return mtimeCache.value;
}

const TOKEN_FILE = path.join(DATA_DIR, ".panel-token");
const PANEL_TOKEN = (() => {
  if (process.env.PANEL_TOKEN) return process.env.PANEL_TOKEN;
  try {
    const saved = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (/^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch {
    /* yok, uretilecek */
  }
  const t = crypto.randomBytes(16).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  } catch {
    /* yazilamazsa bellekte kalir */
  }
  return t;
})();
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  // Sunucu `*` (IPv6) dinliyor; `localhost` macOS'ta ::1'e cozulebiliyor ve
  // tarayici Origin'i bu bicimde yolluyor. Listede olmayinca TUM yazma uclari
  // 403 donuyordu — ayni makinedeki mesru kullanim.
  `http://[::1]:${PORT}`,
]);
/*
 * PANEL_ORIGIN: panel bir domain arkasina konuldugunda (Dokploy) gereken EK
 * origin'ler, virgulle ayrilmis. Bunu vermeden deploy edilen panelde tarayici
 * Origin olarak domain'i yolluyor ve TUM yazma uclari 403 donuyor: kosum
 * tetikleme, verdict, Jira yorumu, kapi yenileme. Arayuz her 403'u "token
 * eskimis" diye gosterdigi icin sebep gorunmuyordu (olculdu 2026-09-02:
 * POST /api/scenarios/prompt + gecerli token → "Origin reddedildi:
 * https://<sunucu-domain>").
 *
 * ⚠️ Origin kontrolu CSRF icindir, kimlik dogrulamasi DEGILDIR: `Origin`
 * basligini hic gondermeyen bir istemci (curl) bu kontrolu atlar ve token
 * servis edilen HTML'de durur. Panel internete acik bir domain'e konacaksa
 * onune ayrica kimlik dogrulama (proxy basic-auth / SSO) gerekir.
 */
/**
 * OAuth redirect_uri buradan turetilir ve saglayiciya KAYITLI olanla harfi
 * harfine ayni olmak zorunda.
 *
 * Sira: PANEL_PUBLIC_URL → PANEL_ORIGIN'in ilki → ISTEGIN KENDI ADRESI.
 *
 * ⚠️ Son basamak sabit `localhost:PORT` DEGIL: ikisi de verilmeden deploy
 * edilen panelde arayuz "Callback URL" olarak `http://localhost:3000/...`
 * gosteriyordu (olculdu 2026-09-04, <sunucu-domain>/api/preflight
 * → redirectUri) — o adresi Linear/Slack uygulamasina yapistiran kisi calismayan
 * bir OAuth kurar. Host olculebilir bir sey; landingUrlFor'da da ayni karar
 * ortam degiskenine degil Host'a bakiyor. Ters vekil arkasinda
 * `x-forwarded-proto/host` kullanilir, yoksa soketin kendisi.
 *
 * Ortam degiskeni verilmisse HER ZAMAN o kazanir: yabanci bir `Host` basligi
 * akisi baska adrese kaydiramasin diye.
 */
const PUBLIC_ORIGIN_ENV = (
  process.env.PANEL_PUBLIC_URL
  || (process.env.PANEL_ORIGIN || "").split(",")[0].trim()
  || ""
).replace(/\/+$/, "");

/*
 * Tarama iç adreslere gidebilir mi? Lokalde (panel yalnızca localhost'ta,
 * dışa açık adres yok) evet: kişi kendi makinesindeki uygulamayı tarar.
 * Sunucuda (PANEL_PUBLIC_URL / PANEL_ORIGIN verilmiş) hayır — SSRF kapısı.
 * `CRAWL_ALLOW_PRIVATE=1|0` ile elle ezilir.
 */
const CRAWL_ALLOW_PRIVATE = process.env.CRAWL_ALLOW_PRIVATE !== undefined
  ? process.env.CRAWL_ALLOW_PRIVATE === "1"
  : !PUBLIC_ORIGIN_ENV;
const crawlRate = createRateLimiter({
  limit: Math.max(1, Number(process.env.CRAWL_RATE_PER_10M) || 6),
  windowMs: 10 * 60_000,
});
function publicOriginFor(req) {
  if (PUBLIC_ORIGIN_ENV) return PUBLIC_ORIGIN_ENV;
  const first = (v) => String(v || "").split(",")[0].trim();
  const host = first(req?.headers?.["x-forwarded-host"]) || first(req?.headers?.host);
  if (!host) return `http://localhost:${PORT}`;
  const proto = first(req?.headers?.["x-forwarded-proto"]) || (req?.socket?.encrypted ? "https" : "http");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/**
 * Flowscope'taki "Landing" dugmesinin hedefi.
 *
 * ⚠️ Varsayilan YALNIZCA lokal isteklerde verilir: landing ayri bir surec
 * (`npm run up` → vite preview, 4321) ve sunucuda o domainde HIC YOK (olculdu
 * 2026-09-02: <sunucu-domain>/onboarding → 404). Sunucuda
 * varsayilan koyulsa dugme OLU bir localhost adresine giderdi.
 *
 * ⚠️ Karar ISTEGIN HOST'una gore verilir, ortam degiskenine gore DEGIL. Ilk
 * hali "PANEL_ORIGIN verilmemisse lokaldeyiz" sayiyordu; sunucuda o degisken
 * de verilmemis oldugu icin (kanit: yazma uclari "Origin reddedildi" donuyor)
 * heuristik ters teptiler ve dugme sunucuda localhost:4321'i gosterecekti.
 * Host dogrudan olculebilir bir sey — tahmin gerekmiyor.
 *
 * LANDING_URL acikca verilirse her yerde o kullanilir; `off`/bos → dugme
 * hic basilmaz.
 */
const LANDING_PORT = Number(process.env.LANDING_PORT || 4321);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function landingUrlFor(req) {
  const raw = process.env.LANDING_URL;
  if (raw !== undefined) {
    const v = raw.trim();
    return v === "" || v.toLowerCase() === "off" ? "" : v.replace(/\/+$/, "");
  }
  // "localhost:4646" → "localhost" · "[::1]:4646" → "[::1]"
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  return LOCAL_HOSTS.has(host) ? `http://localhost:${LANDING_PORT}` : "";
}

/**
 * Ust barin adres tablosu — `window.HQ_NAV` olarak enjekte edilir.
 *
 * Landing IKI YERDE olabiliyor ve adresi buna gore degisiyor:
 *   lokal   → ayri surec (vite preview, 4321), kokte.  HMR calissin diye
 *             lokalde HEP o tercih edilir, imajdaki dist degil.
 *   sunucu  → panelin KENDISI servis ediyor: /home ve /onboarding
 *             (bkz. SITE_DIST blogu). Origin panelin origin'i.
 * Ikisi de yoksa tablo BOS doner ve bar "Home"u hic basmaz — olu link yok.
 *
 * `urls` yuzey basina TAM adres; nav.js oradaki degeri oldugu gibi kullanir.
 * `landing` (tekil) eski bicim: landing'in ORIGIN'i, yollar nav.js'te eklenir.
 */
function navConfigFor(req) {
  const acik = landingUrlFor(req);
  if (acik) return { landing: acik };
  if (SITE_DIST) {
    /*
     * DORT YUZEYIN DE adresi ACIKCA veriliyor, yalniz landing'inkiler degil.
     * NEDEN: landing sayfasindayken nav.js panel origin'ini kendisi tahmin
     * etmeye calisiyor ve bunu YALNIZCA localhost'ta yapabiliyor (port 4646
     * varsayimi). Sunucuda tahmin bos donuyor ve landing'in barinda
     * "Panel"/"Kapsam" dugmeleri HIC BASILMIYORDU (olculdu: sunucu taklidi
     * 4700'de ikisi de localhost:4646'yi gosteriyordu). Panel landing'i
     * kendisi servis ettigine gore dogru adres zaten elimizde.
     */
    const o = publicOriginFor(req);
    return {
      urls: {
        landing: `${o}/home`,
        onboarding: `${o}/onboarding`,
        panel: `${o}/`,
        scope: `${o}/scope`,
      },
    };
  }
  return {};
}

for (const raw of (process.env.PANEL_ORIGIN || "").split(",")) {
  const o = raw.trim().replace(/\/+$/, "");
  if (o) ALLOWED_ORIGINS.add(o);
}

/**
 * Derlenmis landing (`site/dist`). Yoksa (site hic build edilmemisse) landing
 * uclari HIC tanimlanmaz ve bar "Home"u basmaz — olu link gostermek yerine.
 */
const SITE_DIST = (() => {
  const d = path.join(__dirname, "..", "site", "dist");
  try {
    return fs.existsSync(path.join(d, "index.html")) ? d : null;
  } catch {
    return null;
  }
})();

const SITE_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

function serveSiteFile(res, rel, req) {
  const file = path.normalize(path.join(SITE_DIST, rel));
  // Dizin disina cikma denemesi: normalize SONRASI kok kontrolu sart.
  if (!file.startsWith(SITE_DIST + path.sep)) return send(res, 403, { error: "yol reddedildi" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: "yok" });
  const type = SITE_MIME[path.extname(file)] ?? "application/octet-stream";
  // HTML her istekte diskten okunur (panelin kendi arayuzu gibi); varliklar
  // icerik-hash'li isim tasidigi icin uzun sureli onbelleklenebilir.
  const cache = file.endsWith(".html") ? "no-store" : "public, max-age=604800";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  if (!file.endsWith(".html")) return res.end(fs.readFileSync(file));

  /*
   * Landing'in KENDI barina da adres tablosu gerekiyor: yoksa o sayfadaki
   * "Panel"/"Kapsam" dugmeleri sunucuda cozulemez (nav.js panel origin'ini
   * yalnizca localhost'ta tahmin eder) ve serit yine eksik cikar.
   *
   * Derlenmis HTML'de yer tutucu YOK — enjeksiyon `/nav.js` etiketinin
   * hemen ONUNE yapiliyor. Bagimlilik: site/vite.config.ts'teki sharedNav
   * eklentisi bu etiketi basmaya devam etmeli.
   */
  const html = fs.readFileSync(file, "utf8");
  const tablo = `<script>window.HQ_NAV = ${JSON.stringify(navConfigFor(req))};</script>`;
  return res.end(html.replace('<script src="/nav.js">', tablo + '<script src="/nav.js">'));
}

function requireAuth(req, res) {
  if (req.headers["x-panel-token"] !== PANEL_TOKEN) {
    send(res, 403, {
      code: "STALE_TOKEN",
      error:
        "Panel token gerekli. Bu uc yazma islemi yapar; sadece panel arayuzunden cagrilabilir.",
    });
    return false;
  }
  /*
   * PANELIN KENDI ADRESI HER ZAMAN KABUL. `Origin`, sayfanin servis edildigi
   * adrese esitse istek TANIMI GEREGI ayni kaynaktan geliyor — panelin kendi
   * arayuzu tam olarak bunu yolluyor.
   *
   * NEDEN GEREKLI: sunucuda PANEL_ORIGIN verilmemisti ve Flowscope'ta yapilan
   * her degisiklik sessizce diske YAZILMIYORDU (olculdu 2026-09-07,
   * <sunucu-domain>/scope → "Origin reddedildi"). Kullanicinin
   * elinde tek cozum olarak "sunucuya su env'i ver" kaliyordu; oysa sunucu
   * kendi adresini zaten biliyor (publicOriginFor → x-forwarded-proto/host).
   *
   * ⚠️ BU BIR ZAYIFLATMA DEGIL. Tarayici, sayfa JS'inin `X-Forwarded-Host`
   * yollamasina izin vermez (CORS guvenli-liste disinda), yani baska bir
   * origin'deki sayfa bu esitligi uyduramaz. Tarayici olmayan istemci
   * (curl) uydurabilir ama o zaten `Origin`i hic gondermeyerek kontrolu
   * atliyor — kod yorumunda yazili bilinen sinir. Yeni bir delik acilmiyor.
   *
   * PANEL_ORIGIN hala isliyor: ikinci bir domain ya da farkli bir proxy
   * adresi eklemek icin duruyor.
   */
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin) && origin !== publicOriginFor(req)) {
    // `code` sart: arayuz aksi halde bunu "token eskimis, sayfayi yenile" diye
    // gosteriyor ve kullanici sayfayi yenileyip yenileyip ayni duvara carpiyor.
    send(res, 403, {
      code: "BAD_ORIGIN",
      error:
        `Origin reddedildi: ${origin}. Panelin kendi adresi ` +
        `${publicOriginFor(req)} olarak gorunuyor — ikisi ayni degil. Baska bir ` +
        `domain'den cagriliyorsa sunucuya PANEL_ORIGIN=${origin} ver (virgulle birden fazla).`,
    });
    return false;
  }
  return true;
}

// ---------------- denetim kaydi ----------------
/** Suren codegen kaydi (aynı anda bir tane). */
let RECORDING = null;

/** package.json scriptleri — headless cevrimi icin gerekli. */
const PKG_SCRIPTS = (() => {
  try {
    return (
      JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
      ).scripts ?? {}
    );
  } catch {
    return {};
  }
})();

const AUDIT = path.join(DATA_DIR, "command-log.jsonl");
function audit(entry) {
  fs.appendFileSync(
    AUDIT,
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
  );
}

// ---------------- parametreli kosum ----------------
/**
 * tests/ altindaki spec dosyalari + case envanteri.
 * Parametre dogrulamasinin ve panelin "Case'ler" sekmesinin tek kaynagi —
 * elle liste tutulmaz, spec dosyalari parse edilir.
 */
function listSpecs() {
  const dir = path.join(ROOT, "tests");
  const history = readHistory();
  const statusOf = (file, title) => lastOf(history[`${file}||${title}`]);
  const statsOf = (file, title) => historyStats(history[`${file}||${title}`]);

  return fs
    .readdirSync(dir)
    .filter((f) => /^[\w.-]+\.spec\.ts$/.test(f))
    .sort()
    .map((file) => {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      const member = /from "\.\/fixtures"/.test(src);
      const describe = src.match(/test\.describe\(\s*"([^"]+)"/)?.[1] ?? file;

      const pos = [
        ...src.matchAll(/\n\s*test\(\s*(?:"([^"]+)"|`([^`]+)`)/g),
      ].map((m) => ({
        i: m.index,
        title: m[1] ?? m[2],
      }));

      const cases = pos.map((cur, idx) => {
        let end = idx + 1 < pos.length ? pos[idx + 1].i : src.length;
        if (idx + 1 < pos.length) {
          const from = Math.max(cur.i, end - 700);
          const cut = src.slice(from, end).lastIndexOf("/**");
          if (cut > -1) end = from + cut;
        }
        const body = src.slice(cur.i, end);
        // Onceki case'in bitisinden bu case'e kadarki alan = bu case'in yorum blogu
        const doc =
          src
            .slice(idx > 0 ? pos[idx - 1].i : 0, cur.i)
            .split(/\n\s*\}\);/)
            .pop() ?? "";
        return {
          title: cur.title,
          parametric: cur.title.includes("${"),
          mutates:
            /addToCart|removeLine|\.clear\(\)|fillForm|deleteAddress|favoriteButton|setFavorite|togglePermission|logout\(/.test(
              body,
            ),
          known: /test\.fail\(/.test(body),
          // Dayanak kodu (profilin issuePrefixes'i) testin USTUNDEKI JSDoc'ta
          // yaziliyor, govdede degil — yalnizca govdeye bakmak hepsini
          // "bilinen hata" yapiyordu.
          issue: ISSUE_RE ? ((doc + body).match(ISSUE_RE)?.[0] ?? null) : null,
          conditional: /test\.skip\(/.test(body),
          last: statusOf(file, cur.title),
          stats: statsOf(file, cur.title),
        };
      });

      // Bu spec'i kullanan Jira kartlari (esleme ters haritasi).
      // CARD_SPECS artik FONKSIYON: panelden yapilan esleme duzenlemesi
      // yeniden baslatma beklemeden burada da gorunsun.
      const cards = Object.entries(CARD_SPECS())
        .filter(([, specs]) => specs.includes(file))
        .map(([key]) => key);

      return {
        file,
        describe,
        member,
        cases: cases.length,
        cards,
        list: cases,
      };
    });
}

/**
 * Serbest komut YOK. Kullanicidan gelen parametreler tek tek dogrulanir ve
 * argv dizisi olarak spawn edilir (shell: false) — kabuk hic devreye girmez,
 * yani `;`, `&&`, backtick gibi seyler etkisiz.
 */
function buildCustomArgs(params = {}) {
  const errors = [];
  const args = ["playwright", "test"];

  const available = new Set(listSpecs().map((s) => s.file));
  const specs = Array.isArray(params.specs) ? params.specs : [];
  for (const sp of specs) {
    if (!available.has(sp)) errors.push(`Bilinmeyen spec: ${sp}`);
  }
  if (!specs.length) errors.push("En az bir spec secilmeli");
  args.push(...specs.map((sp) => `tests/${sp}`));

  args.push("--project=chromium");

  if (params.grep != null && String(params.grep).trim()) {
    const g = String(params.grep);
    if (g.length > 80) errors.push("grep en fazla 80 karakter");
    // eslint-disable-next-line no-control-regex
    else if (/[\u0000-\u001f]/.test(g))
      errors.push("grep kontrol karakteri iceremez");
    else args.push("-g", g);
  }

  const rep = Number(params.repeatEach ?? 1);
  if (!Number.isInteger(rep) || rep < 1 || rep > 10)
    errors.push("tekrar 1–10 arasinda olmali");
  else if (rep > 1) args.push(`--repeat-each=${rep}`);

  const to = Number(params.timeout ?? 0);
  if (to) {
    if (!Number.isInteger(to) || to < 10_000 || to > 300_000)
      errors.push("timeout 10000–300000 ms arasinda olmali");
    else args.push(`--timeout=${to}`);
  }

  if (params.headed === true) args.push("--headed");
  args.push("--workers=1"); // suite paralel kosmaya gore tasarlanmadi
  // ⚠️ --reporter VERILMEZ: CLI'dan verilen reporter listesi config'i ezer ve
  // test-results/results.json yazilmaz (JSON stdout'a basilir). Config zaten
  // list+html+json veriyor; "Son sonuclar" sekmesi bu dosyaya bagli.

  return { args, errors };
}
const PROXY_PORT = Number(process.env.PANEL_PROXY_PORT || PORT + 1);
let PROXY_URL = "";

// ---------------- tasarim diff ----------------
const FIGMA_OUT_DIR = path.join(DATA_DIR, "figma");
fs.mkdirSync(FIGMA_OUT_DIR, { recursive: true });
let activeDiff = null; // { slug, child, startedAt }

function startDiff({ path: routePath }) {
  if (activeDiff)
    return { ok: false, error: `Diff zaten kosuyor: ${activeDiff.slug}` };
  const map = figmaForRoute(routePath ?? "/");
  if (!map)
    return {
      ok: false,
      error: `Bu rota icin Figma eslesmesi yok: ${routePath}`,
    };

  const slug = (
    map.matched === "/"
      ? "anasayfa"
      : map.matched.replace(/[^a-zA-Z0-9]+/g, "-")
  ).replace(/^-|-$/g, "");
  const htmlOut = path.join("panel-data", "figma", `${slug}.html`);
  const jsonOut = path.join("panel-data", "figma", `${slug}.json`);

  const args = [
    "scripts/figma-diff.mjs",
    "--file",
    map.file,
    "--node",
    map.node,
    "--route",
    map.matched,
    "--out",
    htmlOut,
    "--json",
    jsonOut,
  ];
  if (map.frame) args.push("--frame", map.frame);
  // Login arkasindaki rotalar uye oturumu ister; profildeki `auth` alani soyler.
  if (map.auth === "member") args.push("--state", "member");

  const child = spawn("node", args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  activeDiff = { slug, child, startedAt: Date.now(), map };
  broadcast("diff-start", {
    slug,
    route: map.matched,
    page: map.page,
    cards: map.cards,
  });

  const push = (chunk, stream) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) broadcast("diff-log", { stream, line });
    }
  };
  child.stdout.on("data", (c) => push(c, "out"));
  child.stderr.on("data", (c) => push(c, "err"));

  child.on("close", (code) => {
    let summary = null;
    try {
      summary = JSON.parse(fs.readFileSync(path.join(ROOT, jsonOut), "utf8"));
    } catch {
      /* rapor uretilemedi */
    }
    broadcast("diff-end", {
      slug,
      code,
      durationMs: Date.now() - activeDiff.startedAt,
      summary,
      reportUrl: `/figma/${slug}.html`,
    });
    activeDiff = null;
  });

  return { ok: true, slug, reportUrl: `/figma/${slug}.html` };
}

// ---------------- SSE ----------------
const sse = createSseHub();
const broadcast = (event, data) => sse.broadcast(event, data);

// ---------------- kosum motoru ----------------
/*
 * Tek slot + idempotency + kuyruk run-engine.mjs'te (birim testli). Buradaki
 * tek is bagimliliklari vermek; hicbir uc kendi basina spawn ETMEZ.
 */
const engine = createRunEngine({
  root: ROOT,
  runs: RUNS,
  pkgScripts: PKG_SCRIPTS,
  buildCustomArgs,
  draftFile,
  ensureDraftBridge,
  broadcast,
  audit,
  journal: runJournal,
  mergeHistory,
  lastResults,
  applyRunResults,
});

// ---------------- verdict ----------------
function verdictPath(key) {
  return path.join(VERDICT_DIR, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}
function readVerdict(key) {
  const p = verdictPath(key);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
function allVerdicts() {
  return fs
    .readdirSync(VERDICT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8")))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function saveVerdict(body) {
  const key = body.key;
  if (!key) throw new Error("key zorunlu");
  const existing = readVerdict(key) || {};
  const rec = {
    ...existing,
    key,
    scope: body.scope ?? existing.scope ?? "",
    status: body.status ?? existing.status ?? "",
    /**
     * Bagli Jira karti (opsiyonel). Verdict artik karta yorum olarak
     * gonderilebiliyor; hangi karta gidecegi kayitta durmali, yoksa her
     * gonderimde elle yazmak gerekiyordu. Bicim profilden geliyor (issueRe).
     */
    card: (body.card ?? existing.card ?? "").trim(),
    note: body.note ?? existing.note ?? "",
    evidence: body.evidence ?? existing.evidence ?? [],
    env: ENV,
    baseURL: BASE_URL,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(verdictPath(key), JSON.stringify(rec, null, 2));
  return rec;
}

/**
 * `text[quoteStart]`'ten başlayan bir JS string literalini (tek ya da çift
 * tırnak, ters eğik çizgiyle kaçışlı tırnaklara saygılı) okur.
 *
 * ESKİ regex'in (`"([^"]+)"`) anlamadığı şey kaçış: bir `detail` metninde
 * `\"` geçince (ör. `pageerror: \"...\"`) `[^"]+` kaçışlı tırnağın KENDİSİNDE
 * duruyordu — metin yanlış yerden kesiliyordu (ölçüldü: <önek>-010). Değer tek
 * tırnakla yazılmışsa (içinde kaçışsız `"` geçtiği için, ör. <önek>-001) durum
 * daha kötüydü: `detail:\s*"` deseni HİÇ eşleşmiyor, arayış bir SONRAKİ
 * kaydın `detail:"..."`ına kadar sürüklenip onu bu kayda mal ediyordu —
 * sonraki kayıt (<önek>-002/<önek>-005) TAMAMEN kayboluyordu. İkisi de bu
 * fonksiyonun kaçış-duyarlı, tek karakter karakter okumasıyla düzeldi.
 */
function readStringLiteral(text, quoteStart) {
  const quote = text[quoteStart];
  if (quote !== '"' && quote !== "'") return null;
  let out = "";
  for (let i = quoteStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { out += text[i + 1] ?? ""; i++; continue; }
    if (ch === quote) return out;
    out += ch;
  }
  return null; // kapanis tirnagi yok — bozuk dosya, alan bos donsun
}

/** `field: "..."` ya da `field: '...'`ı bir blok icinde bulup degerini okur. */
function extractField(block, field) {
  const m = new RegExp(`${field}:\\s*\\n?\\s*(["'])`).exec(block);
  if (!m) return null;
  return readStringLiteral(block, m.index + m[0].length - 1);
}

function knownIssues() {
  const f = path.join(ROOT, "tests", "known-issues.ts");
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, "utf8");

  // Her kaydın SINIRI kendi `id:"..."` alanı — bir SONRAKİ `id:"..."`
  // başlayana kadarki metin o kaydın bloğu sayılır. Böylece bir kaydın
  // içindeki tırnak/kaçış çeşitliliği ne olursa olsun kayıtlar BİRBİRİNE
  // KARIŞAMAZ (eski regex'in asıl hatası tam buradaydı: tek bir eşleşme
  // birden fazla kaydın alanlarını birbirine bağlayabiliyordu).
  const idMatches = [...src.matchAll(/id:\s*"([^"]+)"/g)];
  const out = [];
  for (let i = 0; i < idMatches.length; i++) {
    const m = idMatches[i];
    const blockEnd = idMatches[i + 1]?.index ?? src.length;
    const block = src.slice(m.index, blockEnd);
    out.push({
      id: m[1],
      where: extractField(block, "where") ?? "",
      detail: extractField(block, "detail") ?? "",
      nodeId: extractField(block, "nodeId"),
    });
  }
  return out;
}

// ---------------- HTTP ----------------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

/**
 * Govde okuyucu. UST SINIR var: kapsam agaci PUT'u birkac MB olabilir ama
 * sinirsiz govde, yerel de olsa bir sunucuda bellegi doldurmanin en kolay yolu.
 * Asim → 413'e eslenen hata (cagiran try/catch'i 500 yerine bunu gorsun).
 */
const BODY_LIMIT = Number(process.env.PANEL_BODY_LIMIT_BYTES) || 8 * 1024 * 1024;
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) {
      const e = new Error(`govde ${Math.round(BODY_LIMIT / 1024 / 1024)} MB sinirini asiyor`);
      e.code = "BODY_TOO_LARGE";
      throw e;
    }
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

// ---------------- yonlendirici ----------------
/*
 * YENI UCLAR BURAYA: panel/routes/<alan>.mjs icinde register*(router, CTX).
 * Kayitta `auth:true` (x-panel-token) ve `body:true` (JSON govde) bildirilir;
 * token kontrolu ya da govde okuma unutulamaz, `router.list()` hepsini soyler.
 * Asagidaki if-zinciri tasinmamis eski uclar icindir; yenisi oraya eklenmez.
 */
const router = createRouter();
const CTX = {
  send, readBody, requireAuth, audit, broadcast, sse, engine,
  RUNS, ROOT, DATA_DIR, ENV, BASE_URL,
  buildCustomArgs, journal: runJournal, readTree, findScopeNode, getCard,
  readPerf: () => readPerfData({ dataDir: DATA_DIR, apiHostRe: API_HOST_RE }),
  /* Baglanti rotalari: OAuth /start token'i query'de karsilastirir, geri donus
   * adresi istegin genel adresinden turer (publicOriginFor). */
  panelToken: PANEL_TOKEN,
  publicOriginFor,
};
registerAssetRoutes(router, { send, publicDir: path.join(__dirname, "public") });
registerRunRoutes(router, CTX);
registerAiRoutes(router, CTX);
registerRagRoutes(router, CTX);
registerConnectorRoutes(router, CTX);
registerClaudeRoutes(router, CTX);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // Kayitli uclar (routes/*.mjs) once; eslesmezse eski zincire duser.
    if (await router.dispatch(req, res, { ...CTX, url })) return;

    if (p === "/" || p === "/index.html") {
      const html = fs
        .readFileSync(path.join(__dirname, "public", "index.html"), "utf8")
        .replace("__PANEL_TOKEN__", PANEL_TOKEN)
        // Ust barin adres tablosu; bos gelirse dugme HIC basilmaz.
        .replace("__HQ_NAV__", JSON.stringify(navConfigFor(req)));
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    /* ---------------- Kapsam agaci (Flowscope yuzu) ----------------
     * Statikler panel tarafindan servis edilir; Flowscope'un kendi
     * `server.py`si emekli. Token enjeksiyonu ana index.html ile ayni.
     */
    if (p === "/scope" || p === "/scope/" || p === "/scope/index.html") {
      const html = fs
        .readFileSync(path.join(__dirname, "public", "scope", "index.html"), "utf8")
        .replace("__PANEL_TOKEN__", PANEL_TOKEN)
        .replace("__HQ_NAV__", JSON.stringify(navConfigFor(req)));
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    if (p.startsWith("/scope/")) {
      const rel = p.slice("/scope/".length);
      const root = path.join(__dirname, "public", "scope");
      const file = path.normalize(path.join(root, rel));
      // Dizin disina cikma denemesi: normalize sonrasi kok kontrolu sart.
      if (!file.startsWith(root + path.sep)) return send(res, 403, { error: "yol reddedildi" });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: "yok" });
      const MIME = {
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".png": "image/png",
      };
      const type = MIME[path.extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return res.end(fs.readFileSync(file));
    }

    /**
     * KOSUM KAYITLARI (video / trace / ekran goruntusu).
     *
     * Playwright her test icin `test-results/<spec>-<baslik>-<proje>/` altina
     * yaziyor: video.webm, trace.zip, test-failed-1.png. Panel bunlari
     * gostermiyordu, yani kayit acilsa bile kimse bulamazdi.
     *
     * `spec` verilirse yalnizca o spec'in klasorleri donuyor — kart detayinda
     * kartin spec'lerine suzmek icin.
     */
    if (p === "/api/artifacts") {
      const dir = path.join(ROOT, "test-results");
      const specFilter = url.searchParams.get("spec");
      if (!fs.existsSync(dir)) return send(res, 200, { ok: true, rows: [] });
      const rows = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const klasor = path.join(dir, e.name);
        const dosyalar = fs.readdirSync(klasor).filter((f) => /\.(webm|zip|png)$/i.test(f));
        if (!dosyalar.length) continue;
        /*
         * Klasor adi "03-category-listing-urun-listesi-render-olur-chromium"
         * gibi: spec adi bastaki parca ama ".spec.ts" yok. Spec'i eslemek icin
         * dosya adinin govdesini kullaniyoruz.
         */
        const specAdi = (specFilter || "").replace(/\.spec\.ts$/, "");
        if (specFilter && !e.name.startsWith(specAdi)) continue;
        const st = fs.statSync(klasor);
        rows.push({
          dir: e.name,
          at: st.mtime.toISOString(),
          video: dosyalar.find((f) => f.endsWith(".webm")) ?? null,
          trace: dosyalar.find((f) => f.endsWith(".zip")) ?? null,
          shots: dosyalar.filter((f) => f.endsWith(".png")),
        });
      }
      rows.sort((a, b) => b.at.localeCompare(a.at));
      return send(res, 200, { ok: true, rows: rows.slice(0, 60) });
    }

    /**
     * Kayit dosyasini servis eder. Video oynatici HTTP ister; dosyayi diskten
     * okuyup vermek yeterli. YOL KONTROLU sart: normalize sonrasi
     * test-results dizininin disina cikan istek reddediliyor.
     */
    if (p.startsWith("/artifact/")) {
      const rel = decodeURIComponent(p.slice("/artifact/".length));
      const root = path.join(ROOT, "test-results");
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep)) return send(res, 403, { error: "yol reddedildi" });
      if (!/\.(webm|zip|png)$/i.test(file)) return send(res, 403, { error: "bu tur servis edilmiyor" });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: "yok" });
      const MIME = { ".webm": "video/webm", ".zip": "application/zip", ".png": "image/png" };
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": fs.statSync(file).size,
        "cache-control": "no-store",
      });
      return res.end(fs.readFileSync(file));
    }

    /**
     * KAYITLARI SIL. Tek kayitli kosum ~44 MB birakiyor (olculdu: 5 test,
     * video+trace). `results.json` DOKUNULMAZ — o sonucun kendisi, kayit degil;
     * silinse case defteri ve kart ozetleri korlesirdi.
     */
    if (p === "/api/artifacts/clear" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const dir = path.join(ROOT, "test-results");
      let silinen = 0;
      let bayt = 0;
      if (fs.existsSync(dir)) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const full = path.join(dir, e.name);
          for (const f of fs.readdirSync(full)) {
            try { bayt += fs.statSync(path.join(full, f)).size; } catch { /* yok */ }
          }
          fs.rmSync(full, { recursive: true, force: true });
          silinen++;
        }
      }
      audit({ event: "artifacts-clear", dirs: silinen, bytes: bayt });
      return send(res, 200, { ok: true, dirs: silinen, mb: Math.round(bayt / 1048576) });
    }

    /**
     * Trace'i Playwright'in kendi goruntuleyicisinde acar (yerel GUI).
     * Whitelist'li kosum motorunu KULLANMIYOR: bu bir test kosumu degil,
     * goruntuleyici; kosum motoruna sokmak "aktif kosum" durumunu kirletirdi.
     */
    if (p === "/api/trace/open" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { file } = await readBody(req);
      const root = path.join(ROOT, "test-results");
      const full = path.normalize(path.join(root, String(file ?? "")));
      if (!full.startsWith(root + path.sep) || !full.endsWith(".zip"))
        return send(res, 403, { ok: false, error: "yol reddedildi" });
      if (!fs.existsSync(full)) return send(res, 404, { ok: false, error: "trace yok" });
      const ch = spawn("npx", ["playwright", "show-trace", full], {
        cwd: ROOT,
        env: { ...process.env },
        detached: true,
        stdio: "ignore",
      });
      ch.unref();
      audit({ event: "trace-open", file: String(file) });
      return send(res, 200, { ok: true, opened: String(file) });
    }

    /* ---------------- Landing + Onboarding (site/dist) ----------------
     * NEDEN BURADA: landing lokalde AYRI bir surecte kosuyor (vite preview,
     * 4321) ama sunucuda o surec yok — deploy edilen tek sey panel
     * konteyneri. Sonuc olarak ust bardaki "Home" dugmesi sunucuda HIC
     * BASILMIYORDU (adres cozulemedigi icin; olculdu 2026-09-07:
     * <sunucu-domain>/onboarding → 404) ve "sabit uc oge"
     * dedigimiz serit orada ikiye dusuyordu.
     *
     * Dockerfile `site`i ZATEN build ediyor (`npm run build --prefix site`),
     * yani `site/dist` imajda hazir duruyordu; eksik olan tek sey onu servis
     * etmekti.
     *
     * ⚠️ YOL SECIMI TESADUF DEGIL: landing'in urettigi mutlak referanslar
     * (`/assets/*`, `/shots/*`, `/nav.css`, `/onboarding`) panelin sahip
     * oldugu yollarla CAKISMIYOR — bu yuzden Vite'in `base`ini degistirmek
     * gerekmedi ve AYNI dist hem 4321'de hem panel origin'inde calisiyor.
     * Yeni bir panel ucu eklerken bu listeyi ez(me)digine dikkat et.
     *
     * Kok `/` panelde kaldi: yer imleri ve deploy adresi bozulmasin.
     */
    if (SITE_DIST) {
      const SITE_HTML = {
        "/home": "index.html",
        "/onboarding": "onboarding/index.html",
        "/landing": "landing/index.html",
      };
      const dokuman = SITE_HTML[p.replace(/\/$/, "") || "/home"];
      if (dokuman && (p in SITE_HTML || p.replace(/\/$/, "") in SITE_HTML)) {
        return serveSiteFile(res, dokuman, req);
      }
      if (/^\/(assets|shots)\//.test(p) || p === "/favicon.svg" || p === "/icons.svg") {
        return serveSiteFile(res, p.slice(1), req);
      }
    }

    if (p === "/api/scope/tree" && req.method === "GET") {
      const { tree, seeded } = readTree();
      return send(res, 200, {
        tree,
        seeded,
        nodes: countNodes(tree),
        trackerBaseUrl: JIRA.host,
      });
    }

    if (p === "/api/scope/tree" && req.method === "PUT") {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      // Hata YUTULMAZ: yazma basarisizsa cagiran gorsun (Flowscope'un sessiz
      // catch'i dokumante edilmis veri kaybi riskiydi, tasinmadi).
      const info = writeTree(body.tree);
      audit({ event: "scope-tree-save", nodes: info.nodes });
      return send(res, 200, { ok: true, ...info });
    }

    /**
     * Bir kart (Jira Task ID) ile bir/birden çok kapsam ağacı düğümünü bağlar —
     * insanın drawer'daki "Jira Task ID ekle" akışının agent'lar için sunucu
     * karşılığı (bkz. product-owner agent'ı). Bağladığı Task ID bilinen ve "done"
     * değilse, ilgili yaprak düğüm(ler) `jira.js → autoFlagFromJiraStatus()`
     * ile AYNI kuralla anında ❌'ya çekilir — drawer açılana kadar beklenmez.
     */
    if (p === "/api/scope/jira/attach" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { nodeIds, taskId } = await readBody(req);
      try {
        const t = tracker();
        let statusInfo = null;
        if (t) {
          try {
            const statuses = await t.statusByKeys([taskId]);
            statusInfo = statuses?.[taskId] ?? null;
          } catch {
            statusInfo = null; // durum bilinmiyor — attachJiraTask belirsiz veriyle karar vermez
          }
        }
        const out = attachJiraTask({ nodeIds, taskId, statusInfo });
        audit({ event: "scope-jira-attach", taskId, ...out });
        if (out.flagged.length) {
          broadcast("log", { stream: "out", line: `[scope] ${taskId} done degil, ${out.flagged.length} dugum Hatali'ya cekildi` });
        }
        return send(res, 200, { ok: true, ...out });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }

    /**
     * Ağaç genelinde Jira taraması. Tüm jiraTasks'lardaki benzersiz Task ID'leri
     * TEK istekte tracker'a sorar (Figma bölümündeki "istek sayısını düşür"
     * ilkesiyle aynı gerekçe — bkz. CLAUDE.md), sonra `sweepJiraStatuses` ile
     * hem yeni ❌'ları uygular hem "done ama hâlâ ❌" listesini (insan onayı
     * bekliyor) döner. Flowscope'un "Dikkat" görünümündeki Jira kartının
     * "Tara" düğmesi bu ucu çağırır (bkz. attention-view.js).
     */
    if (p === "/api/scope/jira/sweep" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const { tree } = readTree();
        const keys = collectJiraTaskIds(tree);
        let statuses = {};
        const t = tracker();
        if (t && keys.length) {
          try { statuses = await t.statusByKeys(keys); } catch { statuses = {}; }
        }
        const out = sweepJiraStatuses(statuses);
        audit({
          event: "scope-jira-sweep",
          scannedKeys: keys.length,
          scannedNodes: out.scannedNodes,
          flagged: out.flagged.length,
          reviewSuggested: out.reviewSuggested.length,
        });
        if (out.flagged.length) {
          broadcast("log", { stream: "out", line: `[scope] jira taramasi: ${out.flagged.length} dugum Hatali'ya cekildi` });
        }
        return send(res, 200, { ok: true, scannedKeys: keys.length, ...out, statuses });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }

    /**
     * Tasarım Drift Radarı (Figma): ✅ olan VE Kaynaklar'da Figma linki olan
     * yaprak düğümleri toplar, benzersiz dosya anahtarları için TEK TEK (ama
     * az sayıda, önbellekli) `lastModified` sorar, `sweepResourceDrift` ile
     * `lastVerifiedAt`'tan sonra değişenleri ⚠️'ye çeker. Jira sweep'iyle aynı
     * tetikleyici nokta: "Dikkat" görünümündeki Tasarım kartının "Tara"
     * düğmesi (bkz. attention-view.js). Figma kimliği yok/koparılmışsa ya da 429
     * alırsa ilgili dosyalar sessizce atlanır, sweep patlamaz.
     */
    if (p === "/api/scope/design/sweep" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const { tree } = readTree();
        const links = collectVerifiedResourceLinks(tree, "figma", extractFigmaFileKey);
        const uniqueKeys = [...new Set(links.map((l) => l.key))];
        const lastMod = await figmaLastModifiedByKey(uniqueKeys);
        const out = sweepResourceDrift(lastMod, links, "Tasarım");
        audit({
          event: "scope-design-sweep",
          scannedNodes: links.length,
          scannedFiles: uniqueKeys.length,
          flagged: out.flagged.length,
        });
        if (out.flagged.length) {
          broadcast("log", { stream: "out", line: `[scope] tasarim taramasi: ${out.flagged.length} dugum Uyarili'ya cekildi` });
        }
        return send(res, 200, { ok: true, scannedNodes: links.length, scannedFiles: uniqueKeys.length, ...out });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }

    /**
     * Doküman Drift Radarı (Confluence): Figma sweep'iyle BİREBİR AYNI ilke ve
     * aynı `sweepResourceDrift` fonksiyonu, farklı kaynak — ✅ olan VE
     * Kaynaklar'da bir Confluence sayfa linki olan yaprak düğümleri tarar.
     * Kimlik yoksa (ne Confluence'a özel ne Jira üzerinden) ya da sayfa
     * ID'si URL'den çözülemiyorsa (bkz. confluence.mjs → ölçüm sınırı)
     * ilgili düğümler sessizce atlanır.
     */
    if (p === "/api/scope/confluence/sweep" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const { tree } = readTree();
        const links = collectVerifiedResourceLinks(tree, "confluence", extractConfluencePageId);
        const uniqueKeys = [...new Set(links.map((l) => l.key))];
        const lastMod = await confluenceLastModifiedByKey(uniqueKeys);
        const out = sweepResourceDrift(lastMod, links, "Confluence dokümanı");
        audit({
          event: "scope-confluence-sweep",
          scannedNodes: links.length,
          scannedPages: uniqueKeys.length,
          flagged: out.flagged.length,
        });
        if (out.flagged.length) {
          broadcast("log", { stream: "out", line: `[scope] dokuman taramasi: ${out.flagged.length} dugum Uyarili'ya cekildi` });
        }
        return send(res, 200, { ok: true, scannedNodes: links.length, scannedPages: uniqueKeys.length, ...out });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }

    /* ---------------- Oturum kasasi ----------------
     * Kimlik dogrulamayi UYGULAMA YAPMAZ: gorunur pencere acilir, kisi sitenin
     * kendi ekraninda giris yapar, olusan oturum kasaya yazilir. Sifre panele
     * hic girilmez.
     */
    if (p === "/api/sessions") return send(res, 200, { sessions: sessions.list() });

    if (p === "/api/session/for") {
      const target = url.searchParams.get("url") ?? "";
      const r = sessions.resolveFor(target, BASE_URL);
      return send(res, 200, r
        ? { found: true, source: r.source, hoursLeft: r.hoursLeft, status: r.status }
        : { found: false });
    }

    if (p === "/api/session/start" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { url: target, label } = await readBody(req);
      const out = sessions.startLogin({ url: String(target ?? ""), label });
      if (out.ok) audit({ event: "session-login-start", host: out.host });
      return send(res, out.ok ? 200 : 400, out);
    }

    if (p === "/api/session/status") {
      const j = sessions.getLogin(url.searchParams.get("id") ?? "");
      return send(res, 200, j ? { ok: true, job: j } : { ok: false, error: "Is bulunamadi." });
    }

    if (p === "/api/session/confirm" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      sessions.confirmLogin((await readBody(req)).id ?? "");
      return send(res, 200, { ok: true });
    }

    if (p === "/api/session/cancel" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      sessions.cancelLogin((await readBody(req)).id ?? "");
      return send(res, 200, { ok: true });
    }

    if (p === "/api/session/remove" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { host } = await readBody(req);
      const silindi = sessions.remove(String(host ?? ""));
      audit({ event: "session-remove", host, silindi });
      return send(res, 200, { ok: silindi });
    }

    /* ---------------- Tarama (URL → kapsam agaci) ----------------
     * Playwright panelin baslangicinda YUKLENMEZ; crawler.mjs onu yalnizca
     * tarama basladiginda dinamik import eder.
     */
    if (p === "/api/crawl" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      /*
       * Tarama kapısı (crawl-guard.mjs). Landing'deki URL kutusu bu ucu tek
       * tıkla tetikliyor; hedef SSRF/şema denetiminden, istemci hız
       * sınırından, toplam iş eşzamanlılık tavanından geçmeden tarayıcı açılmaz.
       */
      const hiz = crawlRate.take(clientKey(req));
      if (!hiz.ok) {
        res.setHeader("retry-after", String(hiz.retryAfterSec));
        audit({ event: "crawl-ratelimit", client: clientKey(req) });
        return send(res, 429, { ok: false, error: `Çok sık tarama isteği. ${hiz.retryAfterSec} sn sonra tekrar dene.` });
      }
      const hedef = await validateTarget(body.url, { projectBaseUrl: BASE_URL, allowPrivate: CRAWL_ALLOW_PRIVATE });
      if (!hedef.ok) {
        audit({ event: "crawl-reject", url: String(body.url ?? "").slice(0, 200), reason: hedef.error });
        return send(res, 400, { ok: false, error: hedef.error });
      }
      const target = hedef.url;
      const jobId = crawler.startCrawlJob({
        url: target,
        maxDepth: body.maxDepth,
        maxPages: body.maxPages,
        requireLogin: body.requireLogin,
        interactWithUI: body.interactWithUI,
        ignoreRobots: body.ignoreRobots,
        // Kapi oturumu YALNIZCA projenin kendi host'una eklenir (crawler.mjs).
        projectBaseUrl: BASE_URL,
      });
      if (typeof jobId !== "string") return send(res, 429, { ok: false, error: jobId.error, code: jobId.code });
      audit({ event: "crawl-start", url: target, jobId, interact: Boolean(body.interactWithUI) });
      broadcast("log", { stream: "out", line: `[tarama] basladi: ${target}` });
      return send(res, 200, { ok: true, jobId });
    }

    if (p === "/api/crawl-status") {
      const job = crawler.getJob(url.searchParams.get("jobId") ?? "");
      if (!job) return send(res, 200, { ok: false, error: "Is bulunamadi." });
      return send(res, 200, { ok: true, job });
    }

    if (p === "/api/crawl-continue" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      crawler.confirmLogin((await readBody(req)).jobId ?? "");
      return send(res, 200, { ok: true });
    }

    if (p === "/api/crawl-cancel" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { jobId } = await readBody(req);
      crawler.cancelJob(jobId ?? "");
      audit({ event: "crawl-cancel", jobId });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/crawl-limits") return send(res, 200, crawler.limits());

    /* Tracker (kart) uclari — Jira'ya DEGIL, aktif tracker'a gider. */
    if (p === "/api/tracker/status") {
      const keys = (url.searchParams.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
      const t = tracker();
      if (!t) return send(res, 200, { ok: false, error: "Bu projede tracker tanimli degil (profil: connectors.tracker)." });
      try {
        return send(res, 200, { ok: true, statuses: await t.statusByKeys(keys) });
      } catch (e) {
        return send(res, 200, { ok: false, error: String(e.message).slice(0, 160) });
      }
    }

    if (p === "/api/tracker/comment" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { key, text } = await readBody(req);
      const t = tracker();
      if (!t) return send(res, 400, { ok: false, error: "tracker tanimli degil" });
      await t.comment(key, text);
      audit({ event: "tracker-comment", key, chars: (text ?? "").length });
      return send(res, 200, { ok: true });
    }

    /* Ortak tasarim katmani — panel ve kapsam ekrani ayni dosyayi okur. */
    if (p === "/theme.css") {
      const css = fs.readFileSync(path.join(__dirname, "public", "theme.css"));
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      return res.end(css);
    }

    /* Ortak ust bar — panel, kapsam ekrani ve landing AYNI dosyayi okur.
     * Kaynak repo kokunde (`shared/nav/`) cunku landing ayri bir surecte
     * (vite, 4321) kosuyor ve panelin `public/` klasorunu goremiyor; site
     * tarafi ayni dosyayi kendi sunucusundan servis eder (site/vite.config.ts
     * → sharedNav eklentisi). Kopya YOK, iki servis tek dosyayi okur. */
    if (p === "/nav.js" || p === "/nav.css") {
      const file = path.join(__dirname, "..", "shared", "nav", p.slice(1));
      const type = p.endsWith(".css") ? "text/css" : "text/javascript";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
      return res.end(fs.readFileSync(file));
    }

    if (p === "/api/meta") {
      return send(res, 200, {
        env: ENV,
        baseURL: BASE_URL,
        proxyUrl: PROXY_URL,
        jira: {
          available: JIRA.available,
          host: JIRA.host,
          project: JIRA.project,
          epic: JIRA.epic,
          // Sorter listesi ARTIK burada değil — bkz. GET /api/jira/sorters.
          // Tek seferlik /api/meta anlık görüntüsü yerine her Jira sekmesi
          // açılışında taze çekiliyor (yeni eklenen/silinen sorter'lar için).
        },
        project: {
          id: PROJECT.id,
          title: PROJECT.title,
          issuePrefixes: PROJECT.issuePrefixes,
          quickRoutes: PROJECT.quickRoutes,
          scenarioPresets: PROJECT.scenarioPresets,
        },
        ordersAllowed: ordersAllowed(),
        runs: Object.entries(RUNS).map(([id, r]) => ({
          id,
          label: r.label,
          group: r.group ?? "",
          tip: r.tip ?? "",
          cmd: [r.cmd, ...(r.args ?? [])].join(" "),
        })),
        active: engine.active(),
        knownIssues: knownIssues(),
      });
    }

    if (p === "/api/results")
      return send(res, 200, lastResults() ?? { rows: [], counts: {} });

    // ---------------- Site (iframe) ----------------
    if (p === "/api/figma/match") {
      const m = figmaForRoute(url.searchParams.get("path") ?? "/");
      return send(
        res,
        200,
        m ?? { matched: url.searchParams.get("path"), node: null },
      );
    }

    // Rota icin tasarim render'i (yan yana gorunum) — onbellekten, aninda
    if (p === "/api/figma/render") {
      const r = await renderForRoute(url.searchParams.get("path") ?? "/");
      if (r.error)
        return send(res, 404, { error: r.error, map: r.map ?? null });
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=600",
        "x-figma-frame": encodeURIComponent(r.frame.name),
        "x-figma-size": `${r.frame.w}x${r.frame.h}`,
      });
      return res.end(r.buf);
    }

    if (p === "/api/figma/cache") return send(res, 200, cachedRoutes());

    if (p === "/api/figma/frame") {
      const r = await renderForRoute(url.searchParams.get("path") ?? "/");
      return send(
        res,
        r.error ? 404 : 200,
        r.error
          ? { error: r.error }
          : {
              frame: r.frame,
              page: r.map.page,
              cards: r.map.cards,
              cached: r.cached,
            },
      );
    }

    if (p === "/api/figma/diff" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      return send(res, 200, startDiff(body));
    }

    if (p === "/api/figma/reports") {
      const files = fs.existsSync(FIGMA_OUT_DIR)
        ? fs.readdirSync(FIGMA_OUT_DIR).filter((f) => f.endsWith(".json"))
        : [];
      return send(
        res,
        200,
        files.map((f) => {
          const j = JSON.parse(
            fs.readFileSync(path.join(FIGMA_OUT_DIR, f), "utf8"),
          );
          return {
            slug: f.replace(/\.json$/, ""),
            ...j,
            reportUrl: `/figma/${f.replace(/\.json$/, "")}.html`,
          };
        }),
      );
    }

    if (p.startsWith("/figma/")) {
      const f = path.join(FIGMA_OUT_DIR, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: "dosya yok" });
      if (f.endsWith(".png")) {
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-store",
        });
        return res.end(fs.readFileSync(f));
      }
      return send(
        res,
        200,
        fs.readFileSync(f, "utf8"),
        "text/html; charset=utf-8",
      );
    }

    if (p === "/api/site/match") {
      const rule = matchRoute(url.searchParams.get("path") ?? "/");
      return send(
        res,
        200,
        rule ?? { matched: url.searchParams.get("path"), runId: null },
      );
    }

    // ---------------- Jira: OKUMA ----------------
    if (p === "/api/jira/whoami") return send(res, 200, await whoami());

    if (p === "/api/jira/cards") {
      const view = url.searchParams.get("view") ?? "all";
      return send(res, 200, await getCards(view));
    }

    /**
     * Sorter'lar — bkz. CLAUDE.md → "Jira: Sorter". "Tümü" (`ALL_SORTER`)
     * tek sabit seçenek; geri kalanı `panel-data/jira-sorters.json`'da
     * kullanıcının kendi eklediği kayıtlar (bkz. jira-sorters.mjs).
     */
    if (p === "/api/jira/sorters" && req.method === "GET") {
      return send(res, 200, { ok: true, all: ALL_SORTER, flowscope: flowscopeSorter(), custom: listSorters() });
    }
    if (p === "/api/jira/sorters" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { id, label, jql } = await readBody(req);
      try {
        const record = saveSorter({ id, label, jql });
        audit({ event: "jira-sorter-save", id: record.id, label: record.label });
        return send(res, 200, { ok: true, sorter: record });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }
    if (p === "/api/jira/sorters/delete" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { id } = await readBody(req);
      try {
        deleteSorter(id);
        audit({ event: "jira-sorter-delete", id });
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }
    /**
     * KAYDETMEDEN ÖNCE dene — kullanıcının panelde yazdığı ham JQL'i
     * doğrudan Jira'ya sorar, diske hiçbir şey yazmaz (bkz. jira.mjs → testJql).
     */
    if (p === "/api/jira/sorters/test" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { jql } = await readBody(req);
      try {
        const result = await testJql(jql);
        return send(res, 200, { ok: true, ...result });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }

    if (p.startsWith("/api/jira/card/")) {
      const key = p.split("/").pop();
      const card = await getCard(key);
      // Karti dogrulayan whitelist kosumlari — panelden tek tikla tetiklenir
      card.runs = runsForCard(key).map((r) => ({
        ...r,
        label: RUNS[r.runId]?.label ?? r.runId,
      }));
      // Esleme nereden geliyor (profil mi panel mi) — arayuz bunu gosteriyor.
      card.mapping = mappingFor(key);
      // Bu karta bagli Flowscope dugumleri (varsa) — çapraz-gezinme ipucu,
      // bkz. CLAUDE.md → "Panel ↔ Flowscope". Iki sistem AYRI kalıyor, bu
      // sadece bir link; veri modelleri birlestirilmedi.
      card.scopeNodes = findNodesByJiraTask(readTree().tree, key);
      /*
       * SON KOSUM OZETI. Arayuzdeki 3 adimli akisin 1. adimi tek satirda
       * "7/7 gecti · 120 sn · 11:06" diyor; bu sayilari istemcide iki ayri
       * uctan toplamak (sonuclar + journal) her kart acilisinda iki istek
       * demekti. Kartin spec'lerine SUZULMUS olarak burada hesapliyoruz —
       * suzgec bossa `matched: 0` gelir ve arayuz "bu kartin testi kosulmadi"
       * diyebilir (yanlislikla baska bir grubun sonucunu kartin sonucu
       * saymamak icin).
       */
      /*
       * Kayit KARTIN KOSUMLARINA gore eslestiriliyor (id'ler `<runId>-<rastgele>`).
       * Ilk halinde journal'in en yeni "done" kaydi aliniyordu; kartla ilgisiz bir
       * kosumun suresini kartin sonucu gibi gostermek mumkundu.
       */
      const gecmis = runJournal.list(30);
      const kartRunIds = (card.runs ?? []).map((r) => r.runId);
      const kayit = gecmis.find(
        (k) => k.counts && kartRunIds.some((id) => String(k.id).startsWith(id + "-")),
      );
      if (kayit) {
        /*
         * failedTitles yalnizca bu kosum EN SON kosum ise doldurulur:
         * test-results/results.json tek dosya, her kosumda uzerine yaziliyor —
         * daha eski bir kosumun basliklarini oradan okumak baska kosumun
         * sonucunu kartin altina yazmak olurdu.
         */
        const enSon = gecmis[0]?.id === kayit.id;
        const specs = card.mapping.specs ?? [];
        const rows = enSon && specs.length
          ? (lastResults()?.rows ?? []).filter((r) => specs.includes(r.file))
          : [];
        card.lastRun = {
          runId: kayit.id,
          isLatest: enSon,
          total: kayit.counts.total ?? null,
          passed: kayit.counts.passed ?? 0,
          failed: kayit.counts.failed ?? 0,
          skipped: kayit.counts.skipped ?? 0,
          startedAt: kayit.startedAt ?? null,
          durationMs: kayit.durationMs ?? null,
          failedTitles: rows
            .filter((r) => r.status === "failed" || r.status === "timedOut")
            .slice(0, 5)
            .map((r) => r.title),
        };
      } else {
        card.lastRun = null;
      }
      return send(res, 200, card);
    }

    /**
     * KOSUM SONUCU → yorum TASLAGI. Jira'ya YAZMAZ; metni dondurur, gonderme
     * yine /api/jira/comment ucundan ve onayla oluyor (bkz. jira-report.mjs).
     */
    if (p === "/api/jira/comment-draft") {
      const key = url.searchParams.get("key");
      if (!key) return send(res, 400, { ok: false, error: "key zorunlu" });
      try {
        const specs = mappingFor(key).specs;
        const text = runCommentDraft({
          key,
          specs,
          results: lastResults(),
          env: ENV,
          baseURL: BASE_URL,
        });
        return send(res, 200, { ok: true, text, specs });
      } catch (e) {
        return send(res, e.code === "NO_RESULTS" ? 409 : 400, {
          ok: false,
          error: e.message,
          code: e.code ?? null,
        });
      }
    }

    /** VERDICT → yorum TASLAGI. Ayni ilke: metin doner, gonderme ayri. */
    if (p === "/api/jira/verdict-draft") {
      const vkey = url.searchParams.get("verdict");
      if (!vkey) return send(res, 400, { ok: false, error: "verdict zorunlu" });
      try {
        const text = verdictCommentDraft(readVerdict(vkey));
        return send(res, 200, { ok: true, text });
      } catch (e) {
        return send(res, 404, { ok: false, error: e.message, code: e.code ?? null });
      }
    }

    /**
     * KART → SPEC ESLEMESI. Profil kaynak; panelden yapilan duzenleme
     * panel-data/card-specs.json'a dusuyor ve profille birlesiyor
     * (gerekce: card-map.mjs basligi). `specs` bos dizi = "testi yok".
     */
    if (p === "/api/jira/map") {
      if (req.method === "POST") {
        if (!requireAuth(req, res)) return;
        const { key, specs, reset } = await readBody(req);
        if (!key) return send(res, 400, { ok: false, error: "key zorunlu" });
        if (reset) {
          const vardi = clearMapping(String(key));
          audit({ event: "jira-map-reset", key, vardi });
          return send(res, 200, { ok: true, ...mappingFor(String(key)), snippet: mapSnippet() });
        }
        if (!Array.isArray(specs))
          return send(res, 400, { ok: false, error: "specs dizisi bekleniyor" });
        // Var olmayan spec adi kabul edilmez: yazim hatasi, kart detayinda
        // sessizce "testi yok" gorunmesine yol aciyordu.
        const gecerli = new Set(listSpecs().map((x) => x.file));
        const hatali = specs.filter((x) => !gecerli.has(x));
        if (hatali.length)
          return send(res, 400, { ok: false, error: `tests/ altinda yok: ${hatali.join(", ")}` });
        setMapping(String(key), specs);
        audit({ event: "jira-map-set", key, specs: specs.length });
        return send(res, 200, { ok: true, ...mappingFor(String(key)), snippet: mapSnippet() });
      }
      return send(res, 200, { ok: true, rows: listMapping(), snippet: mapSnippet() });
    }

    // ---------------- Jira: YAZMA (yalnizca panelden tetiklenir) ----------------
    /**
     * Perf olcumleri. `scripts/perf-sweep.mjs` cikitisini okur — veri zaten
     * diskte duruyordu ama gorunecek yer yoktu; iki yapisal bulgu (token x3,
     * menu cache'siz) terminalde python ile okunarak bulundu.
     */
    if (p === "/api/perf") {
      // Okuma perf-read.mjs'te (AI uclari da ayni fonksiyonu cagirir, kendine
      // HTTP atmaz). Yakalama burada: panel-data/perf her sweep'te ezildigi
      // icin bu uc okundugunda olcum gecmise dusmeli; hata olcumu golgelemez.
      const payload = readPerfData({ dataDir: DATA_DIR, apiHostRe: API_HOST_RE });
      if (payload.measuredAt) {
        try { perfCapture(payload); }
        catch (e) { audit({ event: "perf-history-capture-error", message: e.message.slice(0, 160) }); }
      }
      return send(res, 200, payload);
    }

    /**
     * PERF GECMISI. Once /api/perf'i icten okuyor: boylece tab acilirken
     * mevcut olcum de geçmise dusmus oluyor (kullanici "Yenile"ye basmadan).
     */
    if (p === "/api/perf/history") {
      // Mevcut olcumu gecmise dusur — dogrudan okuma, kendine HTTP yok.
      try {
        const cur = readPerfData({ dataDir: DATA_DIR, apiHostRe: API_HOST_RE });
        if (cur.measuredAt) perfCapture(cur);
      } catch { /* olcum okunamadiysa gecmis yine donsun */ }
      const rows = perfHistory(Number(url.searchParams.get("limit")) || 40);
      return send(res, 200, {
        ok: true,
        rows,
        diff: rows.length > 1 ? diffRoutes(rows[0], rows[1]) : null,
      });
    }

    /**
     * ── Kotasiz tasarim diff'i ─────────────────────────────────────────────
     * Mevcut /api/figma/diff ucu scripts/figma-diff.mjs'i kosuyor ve API'ye
     * gidiyor: 10 rotanin YALNIZCA 2'sinde calisiyor (kalan 8 canvas onbellekte
     * yok, kota da kapali). Bu uc onbellekteki dugum agaclarini okur — 26 ekran
     * frame'i, Figma'ya SIFIR cagri.
     */
    if (p === "/api/figma/offline-frames") {
      const { listFrames } = await import("../scripts/figma-offline-diff.mjs");
      return send(res, 200, { frames: listFrames() });
    }

    if (p === "/api/figma/offline-diff" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const {
        frameId,
        route,
        state = "guest",
        ignore = [],
      } = await readBody(req);
      if (!frameId) return send(res, 400, { error: "frameId zorunlu" });
      if (!route || !/^\/[A-Za-z0-9\-_/?=&.%,]*$/.test(route)) {
        return send(res, 400, { error: `rota bicimi gecersiz: ${route}` });
      }
      if (!["guest", "member"].includes(state))
        return send(res, 400, { error: "state guest ya da member" });
      audit({ event: "figma-offline-diff", frameId, route, state });
      try {
        const mod = await import("../scripts/figma-offline-diff.mjs");
        const liveText = await mod.captureLive(route, state);
        const rx = (Array.isArray(ignore) ? ignore : [])
          .slice(0, 10)
          .map((x) => {
            try {
              return new RegExp(String(x), "i");
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const out = mod.diff(frameId, liveText, { ignore: rx, limit: 60 });
        broadcast("log", {
          stream: "out",
          line: `[diff] ${out.frame}: ${out.missing.length} eksik (${out.matched}/${out.static} esletti)`,
        });
        return send(res, 200, { ...out, route, state, apiCalls: 0 });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    /**
     * Onkosullar: disa bagimli her sey tek yerde. Kapi durumu da buraya katilir
     * ki ust barda tek serit olsun.
     */
    /**
     * Surum/tazelik bilgisi. `stale: true` = panel dosyalari bu surec
     * baslatildiktan SONRA degismis; arayuzun bildigi uclar sunucuda
     * olmayabilir. Arayuz bunu seritte gosteriyor.
     */
    if (p === "/api/version") {
      const newest = panelMtime();
      return send(res, 200, {
        startedAt: new Date(BOOT_MS).toISOString(),
        uptimeSec: Math.round((Date.now() - BOOT_MS) / 1000),
        newestFileAt: newest ? new Date(newest).toISOString() : null,
        stale: newest > BOOT_MS,
        env: ENV,
      });
    }

    if (p === "/api/preflight") {
      const gateRes = await fetch(`http://127.0.0.1:${PORT}/api/gate/status`)
        .then((r) => r.json())
        .catch(() => null);
      /**
       * Kapi satiri. `credential`/`fix` alanlari Baglantilar panelinde gosterilir
       * — durumu gormek yetmiyor, "nasil duzeltilir" de yaninda olmali.
       */
      const gateFile = `playwright/.auth/${activeEnv()}-gate.json`;
      const gate = gateRes
        ? {
            key: "gate",
            label: "Kapi",
            state:
              gateRes.state === "ok"
                ? "ok"
                : gateRes.state === "warn"
                  ? "warn"
                  : "blocked",
            detail: gateRes.label,
            hoursLeft: gateRes.hoursLeft ?? null,
            credential: gateFile,
            note:
              "Kapi cookie'si ~24 saatte doluyor ve dolunca TUM olcumler yanlis " +
              "olur (sayfalar 'Gecici Erisim' ekranini gosterir).",
            fix:
              gateRes.state === "ok"
                ? []
                : [
                    "Ust bardaki kapi pill'ine tikla (~45 sn)",
                    "ya da whitelist'li 'Kapi oturumunu yenile' kosumunu baslat",
                  ],
          }
        : {
            key: "gate",
            label: "Kapi",
            state: "unknown",
            detail: "okunamadi",
            credential: gateFile,
          };
      const checks = await preflight([gate, sessions.preflightRow()], { origin: publicOriginFor(req) });
      // `passive` satirlar (Slack/Linear gibi gosterim amacli olanlar) genel
      // duruma katilmaz — panelin isleyisi onlara bagli degil.
      const active = checks.filter((c) => !c.passive);
      const worst = active.some(
        (c) => c.state === "blocked" || c.state === "off",
      )
        ? "blocked"
        : active.some((c) => c.state === "warn")
          ? "warn"
          : "ok";
      return send(res, 200, { checks, worst, at: new Date().toISOString() });
    }

    /**
     * Kapi oturumunun sagligi. Dosya yasina DEGIL, storageState icindeki
     * `temporary_auth_verified` cookie'sinin gercek son kullanma tarihine bakar.
     * 2026-08-20'de suresi dolmus bir kapi 33 rotalik perf sweep'i sessizce
     * cope attirdi — bu gosterge onun tekrarlanmamasi icin var.
     */
    if (p === "/api/gate/status") {
      const env = activeEnv();
      const file = path.join(
        process.cwd(),
        "playwright",
        ".auth",
        `${env}-gate.json`,
      );
      if (!fs.existsSync(file)) {
        return send(res, 200, {
          exists: false,
          state: "missing",
          label: "kapi oturumu yok",
        });
      }
      let hoursLeft = null;
      try {
        const st = JSON.parse(fs.readFileSync(file, "utf8"));
        const c = (st.cookies || []).find(
          (x) => x.name === "temporary_auth_verified",
        );
        if (c && typeof c.expires === "number" && c.expires > 0) {
          hoursLeft = (c.expires * 1000 - Date.now()) / 3_600_000;
        }
      } catch {
        /* bozuk dosya: asagida expired sayilir */
      }
      const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 3_600_000;
      const state =
        hoursLeft === null
          ? "unknown"
          : hoursLeft <= 0
            ? "expired"
            : hoursLeft < 4
              ? "warn"
              : "ok";
      const label =
        state === "expired"
          ? "kapi suresi doldu"
          : state === "warn"
            ? `kapi ${hoursLeft.toFixed(1)} saat sonra doluyor`
            : state === "ok"
              ? `kapi ${hoursLeft.toFixed(1)} saat gecerli`
              : "kapi suresi okunamadi";
      return send(res, 200, {
        exists: true,
        state,
        label,
        hoursLeft: hoursLeft === null ? null : Number(hoursLeft.toFixed(2)),
        ageHours: Number(ageH.toFixed(2)),
        env,
      });
    }

    if (p === "/api/jira/comment" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { key, text } = await readBody(req);
      if (!key || !text)
        return send(res, 400, { error: "key ve text zorunlu" });
      audit({ event: "jira-comment", key, chars: text.length });
      await postComment(key, text);
      broadcast("log", {
        stream: "out",
        line: `[jira] ${key} kartina yorum yazildi`,
      });
      return send(res, 200, { ok: true, key });
    }

    if (p === "/api/jira/transition" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { key, transitionId, comment } = await readBody(req);
      if (!key || !transitionId)
        return send(res, 400, { error: "key ve transitionId zorunlu" });
      audit({ event: "jira-transition", key, transitionId });
      await transition(key, transitionId, comment);
      broadcast("log", {
        stream: "out",
        line: `[jira] ${key} statusu degistirildi (${transitionId})`,
      });
      return send(res, 200, { ok: true, key });
    }

    /**
     * ── Kayit (Playwright codegen) ─────────────────────────────────────────
     * Canli gezinmeyi test koduna cevirir. Oturum dosyasi YUKLENIR: kapiyi
     * gecmis (guest) ya da uye girisi yapilmis (member) halde baslar.
     *
     * GUVENLIK: argumanlar sunucuda sabit bir listeden kurulur, kabuk YOK.
     * Kullanicidan gelen tek serbest alan rota ve o da regex ile suzuluyor;
     * cihaz ve durum kapali listeden. Panelin whitelist modeliyle ayni mantik.
     *
     * NOT: cikti panel-data/recorded/ altina yazilir — testDir DISINDA.
     * Codegen ham locator uretir; repo POM konvansiyonuna elle cevrilmeli.
     */
    if (p === "/api/record/start" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      if (RECORDING)
        return send(res, 409, { error: "zaten bir kayit suruyor" });
      const { route = "/", state = "guest", device = "" } = await readBody(req);
      if (!/^\/[A-Za-z0-9\-_/?=&.%,]*$/.test(route)) {
        return send(res, 400, { error: `rota bicimi gecersiz: ${route}` });
      }
      if (!["guest", "member"].includes(state)) {
        return send(res, 400, { error: "state guest ya da member olmali" });
      }
      const DEVICES = ["", "iPhone 11", "iPhone 13", "Pixel 5", "iPad Mini"];
      if (!DEVICES.includes(device))
        return send(res, 400, { error: `cihaz listede yok: ${device}` });

      const env = activeEnv();
      const storage = path.join(
        process.cwd(),
        "playwright",
        ".auth",
        `${env}-${state === "member" ? "user" : "gate"}.json`,
      );
      if (!fs.existsSync(storage)) {
        return send(res, 400, {
          error: `oturum dosyasi yok: ${path.basename(storage)} — once bir spec kosun`,
        });
      }
      const outDir = RECORD_DIR;
      ensureDraftBridge();
      // SANIYE dahil: dakika cozunurluklu damga ayni dakikadaki iki kaydi
      // ayni dosyaya yaziyordu (2026-08-21'de iki kayit ust uste bindi).
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, "")
        .replace("T", "-");
      const outFile = path.join(outDir, `kayit-${stamp}.spec.ts`);

      const args = [
        "playwright",
        "codegen",
        "--target",
        "playwright-test",
        "--load-storage",
        storage,
        "-o",
        outFile,
      ];
      // ⚠️ --device WebKit/Chromium'u kendisi seciyor; ustune --channel chrome
      // vermek "Unsupported webkit channel" ile SUREC ANINDA olduruyor.
      // Kanal yalnizca masaustu kaydinda verilir.
      if (device) args.push("--device", device);
      else args.push("--channel", "chrome");
      args.push((process.env[`BASE_URL_${env.toUpperCase()}`] || "") + route);

      audit({
        event: "record-start",
        route,
        state,
        device: device || "desktop",
        out: path.basename(outFile),
      });
      const child = spawn("npx", args, {
        cwd: process.cwd(),
        env: process.env,
      });
      // Codegen'in kendi hatalarini SSE log'una ver — sessiz olum tespiti icin.
      // (--device + --channel cakismasi tam boyle sessizce olduruyordu.)
      child.stdout.on("data", (d) =>
        broadcast("log", {
          stream: "out",
          line: `[kayit] ${String(d).trim()}`,
        }),
      );
      child.stderr.on("data", (d) =>
        broadcast("log", {
          stream: "err",
          line: `[kayit] ${String(d).trim()}`,
        }),
      );
      RECORDING = { child, file: outFile };
      RECORDING.child.on("exit", (code) => {
        broadcast("log", {
          stream: "out",
          line: `[kayit] tarayici kapandi (kod ${code}) → ${path.basename(outFile)}`,
        });
        audit({ event: "record-end", out: path.basename(outFile), code });
        RECORDING = null;
      });
      broadcast("log", {
        stream: "out",
        line: `[kayit] basladi: ${route} (${state}${device ? ", " + device : ""})`,
      });
      return send(res, 200, {
        ok: true,
        file: path.basename(outFile),
        route,
        state,
        device,
      });
    }

    /**
     * ⚠️ IPTAL, "bitir" DEGIL. Codegen kod dosyasini tarayici penceresi
     * DUZGUN KAPATILINCA yaziyor; sureci oldurmek (SIGTERM de SIGINT de)
     * kodu KAYBEDIYOR — 2026-08-21'de olculdu. Bu uc yalnizca vazgecmek icin.
     */
    if (p === "/api/record/cancel" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      if (!RECORDING) return send(res, 200, { ok: true, note: "kayit yok" });
      RECORDING.child.kill("SIGTERM");
      audit({ event: "record-cancel", note: "kod kaydedilmedi" });
      return send(res, 200, { ok: true, discarded: true });
    }

    /**
     * Iframe kaydedicisinden gelen adimlari spec dosyasina cevirir.
     * Codegen ile ayni yere yazar (panel-data/recorded/) ama surec calistirmaz —
     * adimlar panelde toplanmis olarak gelir.
     */
    if (p === "/api/record/steps" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const {
        steps,
        route = "/",
        title = "kaydedilen akis",
        state = "guest",
      } = await readBody(req);
      if (!Array.isArray(steps) || !steps.length)
        return send(res, 400, { error: "steps bos" });

      /*
       * Uretilen kodun tek tirnakli dizgi bogazı. Satir sonunu KACIRMAK sart:
       * 2026-08-21'de bir iddia metni ham satir sonu icerdi ve uretilen dosya
       * gecersiz JS oldu — tests/ altina girdigi an tum suite "0 tests in 0 files"
       * verdi. Girdinin temiz oldugunu varsaymak yerine burada normalize ediyoruz.
       */
      const q = (v) =>
        "'" +
        String(v)
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'")
          .replace(/\r?\n/g, " ")
          .replace(/\t/g, " ")
          .replace(/\s{2,}/g, " ")
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u001f]/g, "")
          .trim() +
        "'";
      const asLocator = (l) => {
        if (!l) return "page.locator('body')";
        if (l.kind === "testid") return `page.getByTestId(${q(l.value)})`;
        if (l.kind === "role")
          return `page.getByRole(${q(l.role)}, { name: ${q(l.name)} })`;
        if (l.kind === "placeholder")
          return `page.getByPlaceholder(${q(l.value)})`;
        if (l.kind === "text") return `page.getByText(${q(l.value)})`;
        return `page.locator(${q(l.value)})`;
      };
      const lines = [];
      for (const st of steps.slice(0, 200)) {
        const loc = asLocator(st.loc);
        if (st.action === "goto")
          lines.push(`  await page.goto(${q(st.value ?? "/")});`);
        else if (st.action === "click") lines.push(`  await ${loc}.click();`);
        else if (st.action === "fill")
          lines.push(`  await ${loc}.fill(${q(st.value ?? "")});`);
        else if (st.action === "check") lines.push(`  await ${loc}.check();`);
        else if (st.action === "uncheck")
          lines.push(`  await ${loc}.uncheck();`);
        else if (st.action === "press")
          lines.push(`  await ${loc}.press(${q(st.key ?? "Enter")});`);
        // IDDIA: metin varsa icerik, yoksa gorunurluk. Testi test yapan satir bu.
        else if (st.action === "assert") {
          lines.push(
            st.value
              ? `  await expect(${loc}).toContainText(${q(st.value)});`
              : `  await expect(${loc}).toBeVisible();`,
          );
        } else if (st.action === "assertUrl") {
          lines.push(
            `  await expect(page).toHaveURL(new RegExp(${q(escapeRe(st.value ?? "/"))}));`,
          );
        }
      }
      const assertCount = steps.filter(
        (x) => x.action === "assert" || x.action === "assertUrl",
      ).length;
      const env = activeEnv();
      const fixture = state === "member" ? "memberPage" : "page";
      const code = `import { test, expect } from "${state === "member" ? "./fixtures" : "@playwright/test"}";

/**
 * TASLAK — panel iframe kaydedicisiyle uretildi (${new Date().toISOString().slice(0, 16).replace("T", " ")}).
 *
 * Adim: ${steps.length} · IDDIA: ${assertCount}
 *
 * ⚠️ Bu dosya repo konvansiyonunda DEGIL:
 *   - Locator'lar ham; pages/*Page.ts icindeki POM'lara tasinmali.
 *   - Dosya adi tests/NN-shortname.spec.ts kalibina uydurulmali.
 *   - Mutasyon yapiyorsa baslangic durumu geri alinmali (test hijyeni).
 * Cevirmeden tests/ altina tasima.${assertCount ? "" : "\n *\n * ⛔ IDDIA YOK — bu dosya bir script, test DEGIL: locator kirilmadikca\n *    her zaman gecer. Case olarak eklenemez."}
 */
test("${String(title).replace(/"/g, '\\"').slice(0, 90)}", async ({ ${fixture} }) => {
${lines.map((l) => l.replace(/\bpage\./g, `${fixture}.`)).join("\n")}
});
`;
      const outDir = RECORD_DIR;
      ensureDraftBridge();
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, "")
        .replace("T", "-");
      const file = path.join(outDir, `iframe-${stamp}.spec.ts`);
      fs.writeFileSync(file, code, "utf8");
      audit({
        event: "record-steps",
        steps: steps.length,
        asserts: assertCount,
        out: path.basename(file),
        route,
        state,
      });
      broadcast("log", {
        stream: "out",
        line: `[kayit] ${steps.length} adim → ${path.basename(file)}`,
      });
      return send(res, 200, {
        ok: true,
        file: path.basename(file),
        lines: lines.length,
        asserts: assertCount,
        code,
      });
    }

    /**
     * Taslagi gercek bir case'e yukseltir: tests/NN-shortname.spec.ts.
     *
     * KAPI: iddiasi olmayan taslak REDDEDILIR. Kaydedilen akis yalnizca
     * eylemden olusuyorsa locator kirilmadikca her zaman gecer — defterde
     * "passed" yazan ama hicbir sey kanitlamayan bir satir uretir. Kural
     * istemde degil BURADA, tek cikis noktasinda.
     */
    if (p === "/api/record/promote" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      const d = draftFile(body.name);
      if (!d) return send(res, 400, { error: "Taslak bulunamadi" });

      const src = fs.readFileSync(d.full, "utf8");
      const asserts = (src.match(/^\s*await expect\(/gm) || []).length;
      if (!asserts) {
        return send(res, 422, {
          error:
            "IDDIA YOK — eklenemez. Bu taslak yalnizca eylem iceriyor (tikla/yaz), " +
            "dolayisiyla locator kirilmadikca her zaman gecer ve hicbir seyi kanitlamaz. " +
            "Kaydederken 'Iddia modu'nu acip dogrulanmasini istedigin ogelere tikla.",
        });
      }

      // Baslik ve kisa ad
      const title = String(
        body.title ||
          src.match(/\btest\(\s*["'`]([^"'`]+)/)?.[1] ||
          "kaydedilen akis",
      ).trim();
      const slug =
        title
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{Mn}/gu, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 28) || "kayit";

      // Bos NN: mevcut en buyugun bir fazlasi
      const used = fs
        .readdirSync(path.join(ROOT, "tests"))
        .map((f) => Number(f.match(/^(\d{2})-/)?.[1]))
        .filter((n) => Number.isFinite(n));
      const nn = String(Math.max(0, ...used) + 1).padStart(2, "0");
      const outName = `${nn}-${slug}.spec.ts`;
      const outFile = path.join(ROOT, "tests", outName);
      if (fs.existsSync(outFile))
        return send(res, 409, { error: `Zaten var: ${outName}` });

      // Govdeyi al, describe ile sar, basligi konvansiyona cevir
      const bodyLines = src.split("\n");
      const testIdx = bodyLines.findIndex((l) => /^test\(/.test(l));
      if (testIdx < 0)
        return send(res, 500, { error: "Taslakta test() bulunamadi" });
      const importLine = bodyLines[0].replace('"./fixtures"', '"./fixtures"');
      const testBlock = bodyLines
        .slice(testIdx)
        .join("\n")
        .replace(/^/gm, "  ")
        .trimEnd();

      const out = `${importLine}

/**
 * ${nn} - ${title}
 *
 * Panel kaydedicisinden yukseltildi (${new Date().toISOString().slice(0, 16).replace("T", " ")}),
 * kaynak taslak: ${d.base} · ${asserts} iddia.
 *
 * ⚠️ ELDEN GECIRILMELI: locator'lar ham. pages/*Page.ts icindeki POM'lara
 * tasinmali. Mutasyon yapiyorsa baslangic durumu geri alinmali (test hijyeni).
 */
test.describe("${nn} - ${title.replace(/"/g, '\\"')}", () => {
${testBlock}
});
`;
      fs.writeFileSync(outFile, out, "utf8");

      /*
       * SON KAPI: dosya gercekten toplanabiliyor mu?
       * Bu oturumda iki kez tests/ altina gecersiz bir dosya girdi ve suite
       * "0 tests in 0 files" verdi (bir kez alt klasordeki import, bir kez
       * iddia metnindeki ham satir sonu). Sozdizimini varsaymak yerine
       * Playwright'e SORUYORUZ; toplanamiyorsa dosya geri aliniyor.
       */
      const check = await new Promise((resolve) => {
        const c = spawn(
          "npx",
          ["playwright", "test", "--list", outName, "--project=chromium"],
          {
            cwd: ROOT,
            env: { ...process.env, FORCE_COLOR: "0" },
            shell: false,
          },
        );
        let err = "";
        c.stdout.on("data", (x) => (err += x));
        c.stderr.on("data", (x) => (err += x));
        c.on("close", (code) => resolve({ code, err }));
        c.on("error", (e) => resolve({ code: 1, err: String(e.message) }));
      });
      if (check.code !== 0 || /Total: 0 tests/.test(check.err)) {
        fs.unlinkSync(outFile);
        audit({
          event: "record-promote-reject",
          from: d.base,
          to: outName,
          reason: "toplanamadi",
        });
        return send(res, 422, {
          error:
            `${outName} toplanamadi, geri alindi (suite bozulmadi). Playwright cikti:\n` +
            check.err.split("\n").slice(0, 8).join("\n"),
        });
      }

      audit({ event: "record-promote", from: d.base, to: outName, asserts });
      broadcast("log", {
        stream: "out",
        line: `[kayit] ${d.base} → tests/${outName} (${asserts} iddia)`,
      });
      return send(res, 200, { ok: true, file: outName, asserts });
    }

    if (p === "/api/record/run" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      const r = engine.start("draft", {
        name: body.name,
        project: body.project,
        headed: !!body.headed,
      });
      return send(res, r.ok ? 200 : 400, r);
    }

    if (p === "/api/record/list") {
      const dir = RECORD_DIR;
      const files = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".spec.ts"))
            .map((f) => {
              const full = path.join(dir, f);
              const st = fs.statSync(full);
              let src = "";
              try {
                src = fs.readFileSync(full, "utf8");
              } catch {}
              // Taslagin ne oldugunu dosyadan okuyoruz — UI'da adim sayisi ve
              // uye/misafir ayrimi gorunsun ki hangisini kosacagi belli olsun.
              return {
                name: f,
                size: st.size,
                at: st.mtime.toISOString(),
                title: src.match(/\btest\(\s*["'`]([^"'`]{1,90})/)?.[1] ?? null,
                steps: (src.match(/^\s*await /gm) || []).length,
                asserts: (src.match(/^\s*await expect\(/gm) || []).length,
                member: /from ["'`]\.\/fixtures["'`]/.test(src),
                draft: /TASLAK/.test(src),
              };
            })
            .sort((a, b) => b.at.localeCompare(a.at))
        : [];
      return send(res, 200, {
        recording: Boolean(RECORDING),
        current: RECORDING ? path.basename(RECORDING.file) : null,
        files,
      });
    }

    if (p.startsWith("/api/record/file/")) {
      const name = path.basename(
        decodeURIComponent(p.slice("/api/record/file/".length)),
      );
      const file = path.join(RECORD_DIR, name);
      if (!file.endsWith(".spec.ts") || !fs.existsSync(file))
        return send(res, 404, { error: "kayit yok" });
      return send(res, 200, { name, code: fs.readFileSync(file, "utf8") });
    }

    if (p === "/api/jira/assignable") {
      try {
        return send(res, 200, {
          users: await assignableUsers(),
          epic: JIRA.epic,
        });
      } catch (e) {
        return send(res, 200, { users: [], epic: JIRA.epic, error: e.message });
      }
    }

    /** Kanit dosyalari: panel-data/evidence/ listesi. */
    if (p === "/api/evidence") {
      const dir = path.join(DATA_DIR, "evidence");
      if (!fs.existsSync(dir)) return send(res, 200, { files: [] });
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, at: st.mtime.toISOString() };
        })
        .sort((a, b) => b.at.localeCompare(a.at));
      return send(res, 200, { files });
    }

    /** Tek kanit dosyasini servis eder (galeri onizlemesi icin). */
    if (p.startsWith("/api/evidence/")) {
      const name = path.basename(
        decodeURIComponent(p.slice("/api/evidence/".length)),
      );
      const file = path.join(DATA_DIR, "evidence", name);
      if (
        !file.startsWith(path.join(DATA_DIR, "evidence")) ||
        !fs.existsSync(file)
      ) {
        return send(res, 404, { error: "kanit bulunamadi" });
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": ext === ".png" ? "image/png" : "image/jpeg",
      });
      return res.end(fs.readFileSync(file));
    }

    /**
     * Bug acar. `assigneeAccountId` ve `evidence` (kanit dosya adlari) destekler;
     * ekler olusturmadan SONRA yuklenir. 2026-08-21'e kadar bu uc UI'siz duruyordu
     * ve 16 kart elle python yazilarak acildi.
     */
    if (p === "/api/jira/bug" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const {
        summary,
        description,
        parent,
        labels,
        assigneeAccountId,
        evidence,
      } = await readBody(req);
      if (!summary) return send(res, 400, { error: "summary zorunlu" });
      audit({
        event: "jira-bug",
        summary,
        evidence: (evidence || []).length,
        assignee: assigneeAccountId ?? null,
      });
      const created = await createBug({
        summary,
        description: description ?? "",
        parent,
        labels,
        assigneeAccountId: assigneeAccountId || null,
      });
      const attached = [];
      for (const name of evidence || []) {
        const file = path.join(DATA_DIR, "evidence", path.basename(name));
        if (!fs.existsSync(file)) continue;
        try {
          await attachFile(created.key, file);
          attached.push(path.basename(name));
        } catch (e) {
          broadcast("log", {
            stream: "err",
            line: `[jira] ek yuklenemedi ${name}: ${e.message}`,
          });
        }
      }
      broadcast("log", {
        stream: "out",
        line: `[jira] yeni bug: ${created.key}${attached.length ? ` (+${attached.length} ek)` : ""}`,
      });
      return send(res, 200, {
        ok: true,
        key: created.key,
        url: `${JIRA.host}/browse/${created.key}`,
        attached,
      });
    }

    if (p === "/api/verdicts") {
      if (req.method === "POST") {
        if (!requireAuth(req, res)) return;
        try {
          return send(res, 200, saveVerdict(await readBody(req)));
        } catch (e) {
          /* Gecersiz govde ISTEMCI hatasi: `saveVerdict` "key zorunlu" diye
             atiyordu ve uc 500 donuyordu — sunucu coktu izlenimi veriyor,
             cagiran da sebebi gormuyordu (olculdu 2026-08-27). */
          return send(res, 400, { ok: false, error: e.message });
        }
      }
      return send(res, 200, allVerdicts());
    }

    if (p === "/api/specs") return send(res, 200, listSpecs());

    // kanit gorselleri ve raporlar
    if (p.startsWith("/evidence/")) {
      const f = path.join(EVIDENCE_DIR, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: "yok" });
      res.writeHead(200, {
        "content-type": p.endsWith(".png") ? "image/png" : "image/jpeg",
      });
      return res.end(fs.readFileSync(f));
    }

    if (p === "/report" || p === "/playwright-report") {
      const f = path.join(ROOT, "playwright-report", "index.html");
      if (!fs.existsSync(f))
        return send(res, 404, { error: "Rapor yok, once test kos" });
      return send(
        res,
        200,
        fs.readFileSync(f, "utf8"),
        "text/html; charset=utf-8",
      );
    }

    return send(res, 404, { error: `Bilinmeyen uc: ${p}` });
  } catch (e) {
    // Govde siniri ve bozuk JSON istemci hatasidir; 500 "sunucu bozuk" demek olurdu.
    const status = e.code === "BODY_TOO_LARGE" ? 413 : e instanceof SyntaxError ? 400 : 500;
    return send(res, status, { ok: false, error: String(e.message ?? e), code: e.code ?? (status === 400 ? "BAD_JSON" : null) });
  }
});

if (BASE_URL) {
  const { url } = await startProxy({ baseURL: BASE_URL, port: PROXY_PORT });
  PROXY_URL = url;
}

server.listen(PORT, () => {
  console.log(`\n${PROJECT.title} → http://localhost:${PORT}`);
  if (PROXY_URL) console.log(`  site proxy (iframe) → ${PROXY_URL}`);
  console.log(`  ortam: ${ENV} → ${BASE_URL}`);
  console.log(`  whitelist'li kosum sayisi: ${Object.keys(RUNS).length}`);
  console.log(
    `  siparis tamamlama: ${ordersAllowed() ? "ACIK" : "KAPALI"}`,
  );
  console.log(
    `  yazma uclari token korumali (denetim: panel-data/command-log.jsonl)\n`,
  );
});
