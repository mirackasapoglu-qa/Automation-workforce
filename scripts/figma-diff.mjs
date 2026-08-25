#!/usr/bin/env node
/**
 * Homee — Figma ↔ canlı site diff'i (prototip)
 *
 * Piksel diff YAPMAZ (tasarım↔kod arasında gürültü üretir: font hinting, gerçek ürün
 * görselleri, dinamik fiyat/stok). Üç ölçüm yapar:
 *
 *   1. METİN: Figma metin katmanları sayfada var mı (eksik/değişmiş kopya)
 *   2. SPEC:  eşleşen metinlerde font ailesi / boyut / kalınlık / renk farkı
 *   3. GÖRSEL: frame render'ı ile canlı ekran görüntüsü yan yana + saydamlık kaydırıcısı
 *
 * Kullanım:
 *   node scripts/figma-diff.mjs --node 140:2705 --route / --out figma-diff-main.html
 *   node scripts/figma-diff.mjs --node 140:2705 --route / --frame "Home"
 *
 * Kimlik: ~/.figma-credentials → FIGMA_TOKEN (repoya yazılmaz)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { loadEnv } from "../env.mjs";
import { noteResponse } from "../panel/figma-quota.mjs";
import { PROJECT } from "../panel/project.mjs";

loadEnv();

// ----------------------------------------------------------------- ayarlar
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const FILE_KEY = arg("--file", "WRyAE2K87JyYZHJlH18OfD"); // Tepe Home UI/UX Design
const NODE_ID = arg("--node", "140:2705"); // Main Page (CANVAS)
const ROUTE = arg("--route", "/");
const FRAME_NAME = arg("--frame", null); // belirtilmezse en geniş FRAME seçilir
const OUT = arg("--out", "figma-diff.html");
const ENV = (process.env.HOMEE_ENV ?? "test").toLowerCase();
const BASE_URL =
  process.env[`BASE_URL_${ENV.toUpperCase()}`] ?? "https://redesign-prod.test.tepehome.com.tr";

function figmaToken() {
  const f = path.join(os.homedir(), ".figma-credentials");
  if (!fs.existsSync(f)) throw new Error("~/.figma-credentials yok (FIGMA_TOKEN)");
  const m = fs.readFileSync(f, "utf8").match(/FIGMA_TOKEN\s*=\s*(\S+)/);
  if (!m) throw new Error("~/.figma-credentials içinde FIGMA_TOKEN yok");
  return m[1];
}
const TOKEN = figmaToken();

/**
 * Figma çağrıları ÖNBELLEKLİ. Tam düğüm ağacı çekmek pahalı ve API agresif
 * rate-limit uyguluyor (429). Panelden tetiklenen diff'ler aynı ağacı tekrar
 * tekrar çekmesin diye disk önbelleği zorunlu. `--refresh` ile atlanır.
 */
const CACHE_DIR = path.join(process.cwd(), "panel-data", "figma-cache");
/**
 * ⚠️ TTL KASITLI OLARAK 1 YIL. Eskiden 7 gundu ve bu bir tuzak: Figma kotasi
 * kapaliyken (REST veri hacmi limiti / MCP View seat'te ayda 6 cagri) bayatlayan
 * onbellek yeniden cekilemiyor ve diff KOMPLE calismaz hale geliyor. Diskteki
 * agaclar tek varligimiz — tasarim degisirse onbellegi elle sil, sureyle degil.
 */
const CACHE_TTL_MS = Number(process.env.FIGMA_CACHE_TTL_MS ?? 365 * 24 * 60 * 60 * 1000);
const REFRESH = process.argv.includes("--refresh");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const cachePath = (key, ext = "json") =>
  path.join(CACHE_DIR, key.replace(/[^A-Za-z0-9_.-]/g, "_") + "." + ext);

function cacheRead(key, ext = "json") {
  const f = cachePath(key, ext);
  if (REFRESH || !fs.existsSync(f)) return null;
  const age = Date.now() - fs.statSync(f).mtimeMs;
  if (age > CACHE_TTL_MS) return null;
  const buf = fs.readFileSync(f);
  console.log(`  [önbellek] ${path.basename(f)} (${Math.round(age / 60000)} dk önce)`);
  return ext === "json" ? JSON.parse(buf.toString("utf8")) : buf;
}

function cacheWrite(key, data, ext = "json") {
  fs.writeFileSync(cachePath(key, ext), ext === "json" ? JSON.stringify(data) : data);
}

async function figma(pathAndQuery, cacheKey) {
  if (cacheKey) {
    const hit = cacheRead(cacheKey);
    if (hit) return hit;
  }
  const res = await fetch(`https://api.figma.com${pathAndQuery}`, {
    headers: { "X-Figma-Token": TOKEN },
  });
  // Kova durumunu not et — panel preflight'i yoklama yapmadan buradan okuyor.
  noteResponse(pathAndQuery, res, `figma-diff ${NODE_ID}`);
  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    throw new Error(
      `Figma rate limit (429). ${retry ? `${retry} sn sonra tekrar dene.` : "Birkaç dakika bekle."} ` +
        `Önbellek: ${CACHE_DIR} — mevcut önbellekle koşmak için --refresh VERME.`,
    );
  }
  if (!res.ok) throw new Error(`Figma ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (cacheKey) cacheWrite(cacheKey, json);
  return json;
}

// ----------------------------------------------------------------- figma tarafı
const rgbToHex = (c) =>
  c
    ? "#" +
      [c.r, c.g, c.b]
        .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : null;

/**
 * Metin katmanlarını ağaçtan toplar. Atası zincirini de tutar: mega menü / drawer
 * gibi ETKİLEŞİM GEREKTİREN bölümleri ayırmak ve dinamik içeriği filtrelemek için.
 */
function collectTexts(node, out = [], depth = 0, ancestors = []) {
  if (!node || depth > 30) return out;
  if (node.type === "TEXT" && node.characters?.trim()) {
    const st = node.style ?? {};
    const fill = (node.fills ?? []).find((f) => f.type === "SOLID" && f.visible !== false);
    out.push({
      name: node.name,
      chars: node.characters.replace(/\s+/g, " ").trim(),
      fontFamily: st.fontFamily ?? null,
      fontSize: st.fontSize ?? null,
      fontWeight: st.fontWeight ?? null,
      lineHeight: st.lineHeightPx ? Math.round(st.lineHeightPx) : null,
      textCase: st.textCase ?? null,
      color: rgbToHex(fill?.color),
      box: node.absoluteBoundingBox ?? null,
      ancestors: ancestors.slice(-6),
    });
  }
  for (const c of node.children ?? [])
    collectTexts(c, out, depth + 1, [...ancestors, node.name ?? ""]);
  return out;
}

/** Etkileşim gerektiren bölümler: kapalı halde ekran görüntüsünde görünmezler. */
const INTERACTIVE = /men[uü]|drawer|dropdown|modal|popup|overlay|accordion|tooltip|hover/i;
/** Dinamik/temsili içerik: ürün adı, fiyat, taksit, badge, örnek metin. */
const DYNAMIC_LAYER = /^(price|installment|title|incoice|invoice|options|hint|badge|label)\b/i;
const DYNAMIC_TEXT = /^₺|^\d+[.,]\d|goes here|lorem|×\s*\d+\s*ay|kumaş seçene/i;

function classify(t) {
  if (t.ancestors.some((a) => INTERACTIVE.test(a))) return "etkilesim";
  if (DYNAMIC_LAYER.test(t.name) || DYNAMIC_TEXT.test(t.chars)) return "dinamik";
  return "statik";
}

/** Frame içindeki en sık kullanılan dolgu renklerini toplar (palet karşılaştırması için). */
function collectFills(node, counts = {}, depth = 0) {
  if (!node || depth > 30) return counts;
  for (const f of node.fills ?? []) {
    if (f.type === "SOLID" && f.visible !== false) {
      const hex = rgbToHex(f.color);
      if (hex) counts[hex] = (counts[hex] ?? 0) + 1;
    }
  }
  for (const c of node.children ?? []) collectFills(c, counts, depth + 1);
  return counts;
}

// ----------------------------------------------------------------- karşılaştırma
const norm = (s) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");

const applyCase = (t, textCase) =>
  textCase === "UPPER" ? t.toLocaleUpperCase("tr") : textCase === "LOWER" ? t.toLocaleLowerCase("tr") : t;

/** rgb(17, 17, 17) → #111111 */
function cssColorToHex(css) {
  const m = (css ?? "").match(/rgba?\(([^)]+)\)/);
  if (!m) return css ?? null;
  const [r, g, b] = m[1].split(",").map((x) => parseInt(x.trim(), 10));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ----------------------------------------------------------------- ana akış
console.log(`Figma dosyası: ${FILE_KEY}  düğüm: ${NODE_ID}`);

/** Ağaçta id ile düğüm arar (files?ids= yanıtı tüm dosya document'ini döner). */
function findNode(node, id, depth = 0) {
  if (!node || depth > 40) return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * ⚠️ FIGMA RATE LIMIT = İSTEK SAYISI, PAYLOAD DEĞİL (2026-08-24'te doğrulandı).
 *
 * Kullandığımız üç uç (`GET /v1/files`, `/v1/files/:key/nodes`, `/v1/images`) hepsi
 * **Tier 1** ve limit koltuk tipine bağlı: View/Collab **6/AY**, Dev/Full **10-20/dk**.
 * 7,2 MB'lık çağrı da 33 KB'lık çağrı da **1 istek** sayılıyor.
 *
 * Bu yüzden eski "sığ sorgu ucuz, iki adımda git" doktrini YANLIŞTI: 1 istek yerine
 * 2 harcıyordu. Doğru strateji istek sayısını düşürmek:
 *  1. `frameId` profilde varsa hiç çözme — doğrudan frame ağacını iste (1 istek)
 *  2. Önbellekte varsa 0 istek
 *  3. Çoklu rota gerekiyorsa `figma-prewarm.mjs` kullan: `ids=f1,…,f10` ile
 *     10 rota 3 istekte hazırlanıyor (rota başına ayrı koşum 20+ istek eder)
 * Önbellek TTL'i 1 yıl; tasarım değişince elle sil (`lastModified`e bak).
 */

/**
 * 0) PROFİL KISAYOLU — sığ sorguyu tamamen atlar.
 * Profildeki rota eşlemesinde `frameId` doluysa canvas→frame çözümü GEREKMİYOR;
 * o çözüm zaten bir kez yapılıp profile yazıldı. Kısayol rota başına 1 istek ve
 * ~2,5 sn ağ gecikmesi kazandırıyor.
 */
const mappedRoute = (PROJECT.figma?.routes ?? []).find(
  (r) => (r.node === NODE_ID || r.frameId === NODE_ID) && r.frameId,
);

let frameDoc = null;
let frameId = null;

if (mappedRoute && !FRAME_NAME) {
  frameId = mappedRoute.frameId;
  console.log(`  profilden: "${mappedRoute.frame}" (${frameId}) — sığ sorgu atlandı`);
} else {
  // Frame adı elle verildiyse ya da profil boşsa canvas'ı çözmek gerekiyor.
  const cachedDeep = cacheRead(`filetree_${FILE_KEY}_${NODE_ID}`);
  const shallow =
    cachedDeep ??
    (await figma(
      `/v1/files/${FILE_KEY}?ids=${encodeURIComponent(NODE_ID)}&depth=2`,
      `shallow_${FILE_KEY}_${NODE_ID}`,
    ));
  const canvasDoc = findNode(shallow.document, NODE_ID);
  if (!canvasDoc) throw new Error(`${NODE_ID} düğümü ağaçta bulunamadı`);

  let target = canvasDoc;
  if (canvasDoc.type === "CANVAS") {
    const frames = (canvasDoc.children ?? []).filter((c) => c.type === "FRAME");
    target =
      (FRAME_NAME && frames.find((f) => f.name === FRAME_NAME)) ??
      frames
        .slice()
        .sort(
          (a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0),
        )[0];
    if (!target) throw new Error("CANVAS altında FRAME bulunamadı");
    console.log(
      `  sayfa "${canvasDoc.name}" → seçilen frame: "${target.name}" (${frames.length} frame arasından)`,
    );
  }
  frameId = target.id;
  // Tam ağaçtan geldiyse metin katmanları elimizde — ek istek gerekmez.
  if ((target.children ?? []).length) frameDoc = target;
}

// Frame ağacı: önbellekte varsa 0 istek, yoksa 1 istek.
if (!frameDoc) {
  const frameTree = await figma(
    `/v1/files/${FILE_KEY}?ids=${encodeURIComponent(frameId)}`,
    `frametree_${FILE_KEY}_${frameId}`,
  );
  frameDoc = findNode(frameTree.document, frameId);
  if (!frameDoc) throw new Error(`frame ${frameId} ağaçta bulunamadı`);
}

/**
 * Rapor başlıklarında kullanılan frame adı. Profil kısayolunda canvas hiç
 * çözülmediği için `target` yok — ad ya ağaçtan ya profilden gelir.
 */
const frameName = frameDoc?.name ?? mappedRoute?.frame ?? "frame";
const frameW = Math.round(frameDoc.absoluteBoundingBox?.width ?? 1440);
const frameH = Math.round(frameDoc.absoluteBoundingBox?.height ?? 0);
console.log(`  frame boyutu: ${frameW} x ${frameH}`);

const figTexts = collectTexts(frameDoc);
const figFills = collectFills(frameDoc);
console.log(`  metin katmanı: ${figTexts.length}, benzersiz dolgu rengi: ${Object.keys(figFills).length}`);

// 2) frame render'ı
let renderBuf = cacheRead(`render_${FILE_KEY}_${frameId}`, "png");
if (!renderBuf) {
  const img = await figma(
    `/v1/images/${FILE_KEY}?ids=${encodeURIComponent(frameId)}&format=png&scale=1`,
    `imgurl_${FILE_KEY}_${frameId}`,
  );
  const renderUrl = Object.values(img.images)[0];
  if (!renderUrl) throw new Error("Figma render URL'i alınamadı");
  renderBuf = Buffer.from(await (await fetch(renderUrl)).arrayBuffer());
  cacheWrite(`render_${FILE_KEY}_${frameId}`, renderBuf, "png");
}
console.log(`  render: ${(renderBuf.length / 1024).toFixed(0)} KB`);

/** Raporu makul boyutta tutmak için macOS `sips` ile JPEG'e çevirip küçültür. */
function shrink(buf, tag) {
  const tmp = path.join(os.tmpdir(), `figma-diff-${tag}-${NODE_ID.replace(":", "-")}`);
  fs.writeFileSync(tmp + ".png", buf);
  try {
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "62", "--resampleWidth", "900", tmp + ".png", "--out", tmp + ".jpg"], { stdio: "ignore" });
    const out = fs.readFileSync(tmp + ".jpg");
    fs.rmSync(tmp + ".png", { force: true });
    fs.rmSync(tmp + ".jpg", { force: true });
    return { b64: out.toString("base64"), mime: "image/jpeg", kb: Math.round(out.length / 1024) };
  } catch {
    fs.rmSync(tmp + ".png", { force: true });
    return { b64: buf.toString("base64"), mime: "image/png", kb: Math.round(buf.length / 1024) };
  }
}

// 3) canlı sayfa
/**
 * ⚠️ OTURUM DURUMU — `--state member` OLMADAN LOGIN GEREKTİREN ROTA ÖLÇÜLEMEZ.
 *
 * Burada eskiden yalnızca kapı cookie'si set ediliyordu. `/hesabim` gibi login
 * arkasındaki bir rotada canlı taraf `/giris`'e yönleniyor ve diff, hesap
 * sayfasının TÜM metinlerini "canlıda yok" diye raporluyordu — 29 uydurma bulgu
 * (ölçüm 2026-08-24). Sessiz yanlış veri, hiç veri olmamasından kötü.
 *
 * ⚠️⚠️ ÜYE OTURUMU DOSYADAN OKUNAMAZ. Kaydedilmiş üye `storageState`i ikinci bir
 * context'te ÇALIŞMAZ: Tepe Home'un auth_token'ı kullanımda döndüğü (rotate)
 * için cache'lenmiş state login'e düşer — repoda ölçülmüş ve CLAUDE.md'de
 * "en sık yapılan hata" olarak geçiyor. Suite de bu yüzden `test-user.json`
 * kullanmıyor: `tests/fixtures.ts → memberPage` KAPI state'inden başlayıp
 * CANLI LOGIN yapıyor. Buradaki akış onun birebir karşılığı; o dosya değişirse
 * burası da güncellenmeli.
 */
const STATE = (arg("--state", "guest") || "guest").toLowerCase();
const viewport = { width: Math.min(Math.max(frameW, 360), 1920), height: 1000 };
const browser = await chromium.launch({ channel: "chrome" });

const gateState = `playwright/.auth/${ENV}-gate.json`;
const context = await browser.newContext({
  viewport,
  baseURL: BASE_URL,
  ...(fs.existsSync(gateState) ? { storageState: gateState } : {}),
});
// Geçici erişim kapısı sadece bir bayrak cookie'si — doğrudan set etmek en güvenilir yol
await context.addCookies([
  {
    name: "temporary_auth_verified",
    value: "true",
    domain: new URL(BASE_URL).hostname,
    path: "/",
  },
]);
const page = await context.newPage();

/**
 * Üye girişi — `tests/fixtures.ts → loginAsMember` ile aynı akış.
 * Doğrulama sadece "login'e yönlenmedi" değil: e-postanın sayfada görünmesi.
 */
if (STATE === "member") {
  const email = process.env.TEST_EMAIL;
  const pass = process.env.TEST_PASSWORD;
  if (!email || !pass) throw new Error("TEST_EMAIL / TEST_PASSWORD .env içinde yok");
  await page.goto(`${BASE_URL}/giris?redirect=%2Fhesabim`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]:visible').first().fill(pass);
  await page
    .getByRole("button", { name: "GİRİŞ YAP", exact: true })
    .first()
    .click({ timeout: 15_000 });
  await page.waitForTimeout(6000);
  const body = (await page.locator("body").innerText()).toLowerCase();
  if (!body.includes(email.toLowerCase()) && page.url().includes("/giris")) {
    throw new Error("üye girişi doğrulanamadı — TEST_EMAIL / TEST_PASSWORD kontrol et");
  }
  console.log(`  oturum: üye (canlı login, ${email})`);
}

await page.goto(BASE_URL + ROUTE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("footer").first().waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);

/**
 * OTURUM/KAPI DOĞRULAMASI — ölçmeden önce doğru sayfada olduğumuzu kanıtla.
 * Yanlış sayfada ölçüm yapıp bulgu üretmek en pahalı hata; burada DURUYORUZ.
 */
{
  const url = page.url();
  const txt = await page.locator("body").innerText().catch(() => "");
  if (/Geçici Erişim/.test(txt)) {
    throw new Error("kapı kapalı — `npm run panel` içindeki kapı yenileme koşumunu çalıştır");
  }
  if (/\/giris|\/kayit-ol/.test(url) && !/\/giris|\/kayit-ol/.test(ROUTE)) {
    throw new Error(
      `canlı taraf login'e yönlendi (${url}). ${ROUTE} üye oturumu istiyor — ` +
        `\`--state member\` ile koş. Oturum varsa süresi dolmuş olabilir.`,
    );
  }
}
// lazy içerik
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);
// çerez/kampanya kapatıcıları
for (const sel of [
  'button:has-text("Kabul")',
  'button:has-text("Tümünü")',
  'button[aria-label="Kapat"]:not([class*="inset-0"])',
]) {
  const b = page.locator(sel).first();
  if (await b.isVisible({ timeout: 1200 }).catch(() => false)) await b.click().catch(() => {});
}
await page.waitForTimeout(600);

/**
 * Mega menü / drawer içerikleri kapalı hâlde DOM'da olmayabiliyor. Katman adına
 * bakarak sınıflandırmak yetmedi (Figma'da bu öğelerin atası "menu" içermiyor),
 * bu yüzden menüyü GERÇEKTEN açıp metinlerini topluyoruz.
 */
async function collectOpenedMenuTexts() {
  const btn = page.locator('button[aria-label="Kategoriler"]:visible').first();
  if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) return [];
  await btn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const texts = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.children.length) continue;
      const t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 60) continue;
      const r = e.getBoundingClientRect();
      if (!(r.width || r.height)) continue;
      const cs = getComputedStyle(e);
      out.push({
        text: t,
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        color: cs.color,
      });
    }
    return out;
  });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(1200);
  return texts;
}
const menuTexts = await collectOpenedMenuTexts();
console.log(`  mega menü açıkken toplanan metin: ${menuTexts.length}`);

const liveBuf = await page.screenshot({ fullPage: true });
console.log(`  canlı ekran görüntüsü: ${(liveBuf.length / 1024).toFixed(0)} KB (viewport ${viewport.width}px)`);

// 4) metin + spec karşılaştırması
const seen = new Set();
const candidates = figTexts.filter((t) => {
  const key = norm(t.chars);
  if (!key || key.length < 2 || key.length > 60 || seen.has(key)) return false;
  seen.add(key);
  return true;
});

const results = [];
for (const t of candidates) {
  const expected = applyCase(t.chars, t.textCase);
  // Aynı metni taşıyan TÜM öğeleri topla; doğru olanı göreli dikey konuma göre seç.
  // (İlk eşleşmeyi almak yanlış bileşeni yakalıyordu: ör. mega menüdeki "SALON"
  //  ile hero üzerindeki "SALON" karışıyordu.)
  const matches = await page.evaluate((needle) => {
    const target = needle.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.children.length) continue;
      const txt = (e.textContent ?? "").replace(/\s+/g, " ").trim();
      if (txt.toLocaleLowerCase("tr") !== target) continue;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      out.push({
        text: txt,
        top: Math.round(r.top + window.scrollY),
        rect: {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        visible: !!(r.width || r.height),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        color: cs.color,
        tag: e.tagName.toLowerCase(),
      });
    }
    return out;
  }, expected);

  const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
  const figRel = t.box && frameH ? (t.box.y - (frameDoc.absoluteBoundingBox?.y ?? 0)) / frameH : null;
  let found = null;
  if (matches.length) {
    const visible = matches.filter((m) => m.visible);
    const pool = visible.length ? visible : matches;
    found =
      figRel == null
        ? pool[0]
        : pool
            .slice()
            .sort(
              (a, b) =>
                Math.abs(a.top / pageH - figRel) - Math.abs(b.top / pageH - figRel),
            )[0];
    found.candidates = matches.length;
    found.posDelta = figRel == null ? null : Math.round((found.top / pageH - figRel) * 1000) / 10;
  }

  // Kapalı hâlde bulunamadıysa mega menüde ara (etkileşim gerektiren içerik)
  let inMenu = null;
  if (!found) {
    const target = norm(expected);
    inMenu = menuTexts.find((m) => norm(m.text) === target) ?? null;
  }

  const diffs = [];
  if (found) {
    if (t.fontSize && Math.abs(found.fontSize - t.fontSize) > 1) {
      diffs.push(`boyut ${t.fontSize}px → ${found.fontSize}px`);
    }
    if (t.fontWeight && Math.abs(Number(found.fontWeight) - t.fontWeight) >= 100) {
      diffs.push(`kalınlık ${t.fontWeight} → ${found.fontWeight}`);
    }
    const liveHex = cssColorToHex(found.color);
    if (t.color && liveHex && t.color !== liveHex) diffs.push(`renk ${t.color} → ${liveHex}`);
    if (t.fontFamily && !found.fontFamily.toLowerCase().includes(t.fontFamily.split(" ")[0].toLowerCase())) {
      diffs.push(`font "${t.fontFamily}" → "${found.fontFamily.split(",")[0]}"`);
    }
  }
  results.push({
    fig: t,
    expected,
    found,
    inMenu,
    diffs,
    kind: inMenu ? "etkilesim" : classify(t),
  });
}


const mismatched = results.filter((r) => r.found && r.diffs.length);
const clean = results.filter((r) => r.found && !r.diffs.length);
// Bulunamayanlar üç kovaya ayrılır: gerçek aday / etkileşim gerektiren / dinamik içerik
const notFound = results.filter((r) => !r.found);
const missing = notFound.filter((r) => r.kind === "statik");
const needsInteraction = notFound.filter((r) => r.kind === "etkilesim");
const dynamicSkipped = notFound.filter((r) => r.kind === "dinamik");

console.log(
  `\nSONUÇ: ${candidates.length} metin → ${clean.length} birebir, ${mismatched.length} spec farkı,\n` +
    `  ${missing.length} GERÇEK ADAY (statik metin sayfada yok)\n` +
    `  ${needsInteraction.length} etkileşim gerektiriyor (menü/drawer kapalıyken görünmez)\n` +
    `  ${dynamicSkipped.length} dinamik/temsili içerik (fiyat, ürün adı, örnek metin) — gürültü`,
);

// ---------------------------------------------------------------- ANNOTATE
/**
 * Farkları KIRMIZI KUTU + NUMARA ile işaretli snapshot üretir (Jira'ya eklenebilir).
 *  - canlı sayfa: spec farkı olan öğelerin üstüne kutu (DOM rect'leri)
 *  - tasarım render'ı: canlıda BULUNAMAYAN metinlerin yerine kutu (Figma koordinatları)
 */
const frameX = frameDoc.absoluteBoundingBox?.x ?? 0;
const frameY = frameDoc.absoluteBoundingBox?.y ?? 0;

const liveBoxes = mismatched
  .map((r, i) => ({ n: i + 1, ...(r.found?.rect ?? {}), label: r.diffs.join(" · ").slice(0, 60) }))
  .filter((b) => b.w);

const designBoxes = missing
  .map((r, i) => {
    const b = r.fig.box;
    if (!b) return null;
    return {
      n: i + 1,
      x: Math.round(b.x - frameX),
      y: Math.round(b.y - frameY),
      w: Math.round(b.width),
      h: Math.round(b.height),
      label: r.expected.slice(0, 40),
    };
  })
  .filter(Boolean);

const BOX_CSS = `
  .hd-box{position:absolute;border:2px solid #e11d48;box-shadow:0 0 0 2px rgba(225,29,72,.25);
          border-radius:2px;pointer-events:none;z-index:2147483000}
  .hd-num{position:absolute;top:-11px;left:-2px;background:#e11d48;color:#fff;font:700 11px/1.5
          -apple-system,sans-serif;padding:0 5px;border-radius:3px;white-space:nowrap}`;

async function annotateLive() {
  if (!liveBoxes.length) return liveBuf;
  await page.evaluate(
    ({ boxes, css }) => {
      const st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      for (const b of boxes) {
        const d = document.createElement("div");
        d.className = "hd-box";
        d.style.left = b.x - 2 + "px";
        d.style.top = b.y - 2 + "px";
        d.style.width = b.w + 4 + "px";
        d.style.height = b.h + 4 + "px";
        d.innerHTML = `<span class="hd-num">${b.n}</span>`;
        document.body.appendChild(d);
      }
    },
    { boxes: liveBoxes, css: BOX_CSS },
  );
  await page.waitForTimeout(400);
  return page.screenshot({ fullPage: true });
}

/** Tasarım PNG'sini kutularla birlikte yeni bir sayfada render edip snapshot alır. */
async function annotateDesign() {
  if (!designBoxes.length) return renderBuf;
  const p2 = await context.newPage();
  await p2.setViewportSize({ width: Math.min(frameW, 1920), height: 900 });
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff}
    #wrap{position:relative;width:${frameW}px}
    #wrap img{width:${frameW}px;display:block}
    ${BOX_CSS}</style>
    <div id="wrap"><img src="data:image/png;base64,${renderBuf.toString("base64")}">
    ${designBoxes
      .map(
        (b) =>
          `<div class="hd-box" style="left:${b.x - 2}px;top:${b.y - 2}px;width:${b.w + 4}px;height:${
            b.h + 4
          }px"><span class="hd-num">${b.n}</span></div>`,
      )
      .join("")}</div>`;
  await p2.setContent(html, { waitUntil: "load" });
  await p2.waitForTimeout(600);
  const shot = await p2.locator("#wrap").screenshot();
  await p2.close();
  return shot;
}

const liveAnnotated = await annotateLive();
const designAnnotated = await annotateDesign();
console.log(
  `  işaretleme: canlıda ${liveBoxes.length} kutu (spec farkı), tasarımda ${designBoxes.length} kutu (eksik metin)`,
);

// annotate edilmiş PNG'leri diske de yaz (Jira'ya eklenebilir kanıt)
const annDir = path.dirname(path.join(process.cwd(), OUT));
const slugBase = path.basename(OUT).replace(/\.html$/, "");
fs.writeFileSync(path.join(annDir, `${slugBase}-canli-isaretli.png`), liveAnnotated);
fs.writeFileSync(path.join(annDir, `${slugBase}-tasarim-isaretli.png`), designAnnotated);
console.log(`  işaretli snapshot'lar: ${slugBase}-canli-isaretli.png / -tasarim-isaretli.png`);

const design = shrink(designAnnotated, "design");
const live = shrink(liveAnnotated, "live");
console.log(`  görseller küçültüldü: tasarım ${design.kb} KB, canlı ${live.kb} KB`);

await browser.close();


// 5) rapor
const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Figma diff — ${esc(frameName)} ↔ ${esc(ROUTE)}</title>
<style>
  :root { --fg:#18181b; --mut:#6b7280; --line:#e4e4e7; --card:#fafafa; --ok:#0f766e; --no:#b91c1c; --warn:#a16207 }
  @media (prefers-color-scheme:dark){:root{--fg:#ededed;--mut:#a1a1aa;--line:#27272a;--card:#17181b;--ok:#34d399;--no:#f87171;--warn:#fbbf24}}
  *{box-sizing:border-box} body{margin:0;padding:28px 22px;color:var(--fg);background:#fff;
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  @media (prefers-color-scheme:dark){body{background:#0f1012}}
  .wrap{max-width:1240px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 10px;padding-bottom:5px;border-bottom:2px solid var(--fg)}
  .sub{color:var(--mut);font-size:13px;margin-bottom:18px}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:16px 0}
  .c{border:1px solid var(--line);border-radius:9px;padding:11px;background:var(--card)}
  .c .n{font-size:22px;font-weight:670;line-height:1} .c .l{font-size:11px;color:var(--mut);margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0 14px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:var(--card);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
  .sw{display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid var(--line);vertical-align:-1px;margin-right:4px}
  .no{color:var(--no)} .ok{color:var(--ok)} .warn{color:var(--warn)}
  .side{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  .side figure{margin:0} .side img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  figcaption{font-size:11.5px;color:var(--mut);margin-bottom:6px}
  .overlay{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:10px}
  .overlay img{width:100%;display:block} .overlay img.top{position:absolute;inset:0;opacity:.5}
  input[type=range]{width:280px}
  .scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<h1>Figma diff — ${esc(frameName)} ↔ <span class="mono">${esc(ROUTE)}</span></h1>
<div class="sub">${new Date().toLocaleString("tr-TR")} · dosya <b>Tepe Home UI/UX Design</b> ·
frame ${frameW}×${frameH} · canlı ${esc(BASE_URL + ROUTE)} (viewport ${viewport.width}px)</div>

<div class="cards">
  <div class="c"><div class="n">${candidates.length}</div><div class="l">karşılaştırılan metin</div></div>
  <div class="c"><div class="n ok">${clean.length}</div><div class="l">birebir eşleşen</div></div>
  <div class="c"><div class="n warn">${mismatched.length}</div><div class="l">spec farkı</div></div>
  <div class="c"><div class="n no">${missing.length}</div><div class="l">sayfada yok</div></div>
</div>

<h2>1. Spec farkları (metin eşleşti, stil farklı)</h2>
${
  mismatched.length
    ? `<div class="scroll"><table><tr><th style="width:34px">#</th><th style="width:26%">Metin</th><th>Fark</th><th style="width:20%">Figma katmanı</th></tr>
${mismatched
  .map(
    (r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.expected.slice(0, 50))}</td>
  <td class="mono no">${r.diffs.map(esc).join("<br>")}</td>
  <td class="mono">${esc(r.fig.name.slice(0, 30))}</td></tr>`,
  )
  .join("")}
</table></div>`
    : "<p>Spec farkı yok.</p>"
}

<h2>2. Figma'da olup sayfada bulunamayan metinler</h2>
<p class="sub">Not: dinamik içerik (ürün adı, fiyat), görsele gömülü metin ve varyant/durum
ekranlarındaki metinler burada normal olarak görünür — hepsi hata değildir.</p>
${
  missing.length
    ? `<div class="scroll"><table><tr><th style="width:34px">#</th><th style="width:44%">Beklenen metin</th><th style="width:22%">Figma katmanı</th><th>Stil</th></tr>
${missing
  .map(
    (r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.expected.slice(0, 60))}</td><td class="mono">${esc(r.fig.name.slice(0, 30))}</td>
  <td class="mono">${r.fig.fontSize ?? "?"}px/${r.fig.fontWeight ?? "?"} ${
    r.fig.color ? `<span class="sw" style="background:${r.fig.color}"></span>${r.fig.color}` : ""
  }</td></tr>`,
  )
  .join("")}
</table></div>`
    : "<p>Tüm metinler sayfada bulundu.</p>"
}

<h2>2b. Mega menüde bulunanlar (kapalı hâlde görünmez, hata değil)</h2>
${
  needsInteraction.length
    ? `<div class="scroll"><table><tr><th style="width:44%">Metin</th><th>Menüdeki stil</th></tr>
${needsInteraction
  .map(
    (r) => `<tr><td>${esc(r.expected.slice(0, 60))}</td><td class="mono">${
      r.inMenu ? `${r.inMenu.fontSize}px/${r.inMenu.fontWeight}` : "-"
    }</td></tr>`,
  )
  .join("")}
</table></div>`
    : "<p>Menüye özgü metin bulunmadı.</p>"
}

<h2>3. Birebir eşleşenler</h2>
<div class="scroll"><table><tr><th style="width:40%">Metin</th><th>Stil (Figma = canlı)</th></tr>
${clean
  .map(
    (r) => `<tr><td>${esc(r.expected.slice(0, 55))}</td><td class="mono">${r.fig.fontSize ?? "?"}px/${
      r.fig.fontWeight ?? "?"
    } ${r.fig.color ? `<span class="sw" style="background:${r.fig.color}"></span>${r.fig.color}` : ""}</td></tr>`,
  )
  .join("")}
</table></div>

<h2>4. Tasarımın renk paleti</h2>
<div class="scroll"><table><tr><th style="width:120px">Renk</th><th>Frame içinde kullanım</th></tr>
${Object.entries(figFills)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([hex, n]) => `<tr><td class="mono"><span class="sw" style="background:${hex}"></span>${hex}</td><td>${n}×</td></tr>`)
  .join("")}
</table></div>

<h2>5. Görsel karşılaştırma</h2>
<div class="side">
  <figure><figcaption>Figma — ${esc(frameName)} · <b style="color:#e11d48">kırmızı kutular: canlıda bulunamayan metinler</b> (numaralar 2. tablo)</figcaption>
    <img src="data:${design.mime};base64,${design.b64}" alt="Figma tasarımı"></figure>
  <figure><figcaption>Canlı — ${esc(ROUTE)} · <b style="color:#e11d48">kırmızı kutular: spec farkı olan öğeler</b> (numaralar 1. tablo)</figcaption>
    <img src="data:${live.mime};base64,${live.b64}" alt="Canlı sayfa"></figure>
</div>

<h2>6. Üst üste bindirme</h2>
<p><label>Saydamlık <input type="range" min="0" max="100" value="50" oninput="document.getElementById('ov').style.opacity=this.value/100"></label></p>
<div class="overlay">
  <img src="data:${live.mime};base64,${live.b64}" alt="Canlı">
  <img id="ov" class="top" src="data:${design.mime};base64,${design.b64}" alt="Tasarım">
</div>
<p class="sub">Üst üste bindirme kaba bir hizalama verir — frame yüksekliği ile sayfa yüksekliği
farklı olduğu için tam çakışma beklenmez; bölüm sıralaması ve genel ritim için kullanılır.</p>
</div></body></html>`;

fs.writeFileSync(path.join(process.cwd(), OUT), html, "utf8");
console.log(`Rapor: ${OUT}`);

// Panel için makine-okunur özet (--json ile dosyaya, yoksa stdout'a tek satır)
const summary = {
  file: FILE_KEY,
  node: NODE_ID,
  frame: frameName,
  route: ROUTE,
  frameSize: { w: frameW, h: frameH },
  liveHeight: null,
  counts: {
    compared: candidates.length,
    clean: clean.length,
    mismatched: mismatched.length,
    missing: missing.length,
    needsInteraction: needsInteraction.length,
    dynamicSkipped: dynamicSkipped.length,
  },
  mismatches: mismatched.map((r) => ({ text: r.expected.slice(0, 60), diffs: r.diffs, layer: r.fig.name })),
  missingTexts: missing.map((r) => ({ text: r.expected.slice(0, 60), layer: r.fig.name })),
  report: OUT,
  generatedAt: new Date().toISOString(),
};
const jsonOut = arg("--json", null);
if (jsonOut) {
  fs.writeFileSync(path.join(process.cwd(), jsonOut), JSON.stringify(summary, null, 2), "utf8");
  console.log(`JSON: ${jsonOut}`);
}
console.log("SUMMARY " + JSON.stringify(summary.counts));
