#!/usr/bin/env node
/**
 * Tasarım ↔ canlı metin/spec diff'i — Figma API'sine HİÇ ÇAĞRI YAPMADAN.
 *
 * NEDEN VAR: Figma'nın iki ayrı kotası var (REST veri hacmi, MCP View seat'te
 * ayda 6 çağrı) ve ikisi de tükenebiliyor. Ama `panel-data/figma-cache/` içindeki
 * düğüm ağaçları font/punto/ağırlık/metin katmanlarını zaten taşıyor. Bu script
 * onları okur; kota kapalıyken de çalışır.
 *
 * ÜÇ DERS İÇERİDE GÖMÜLÜ (2026-08-20/21'de acı çekilerek öğrenildi):
 *
 *  1. TÜRKÇE NORMALİZASYON. `"İ".toLowerCase()` → "i̇" (i + birleşik nokta) verir;
 *     naif karşılaştırma "SİPARİŞLERİM"i eşleştiremez. Tek koşumda 12 yanlış
 *     pozitif üretti. Çözüm: NFD + birleşik işaretleri at, SONRA küçült.
 *
 *  2. DURUM EŞİTLEME. Boş sepet ile ürünlü tasarım frame'ini karşılaştırmak
 *     14 uydurma "eksik" üretir. Frame'in gerektirdiği durum `--state` ile
 *     bildirilir; uymuyorsa script UYARIR.
 *
 *  3. DİNAMİK İÇERİK. Tasarımda örnek veri var (ürün adları, fiyatlar, mağaza
 *     adları). Bunlar canlıda hiç eşleşmez ve gerçek bulguyu gürültüde boğar.
 *     Fiyat/uzun sayı içerenler ve `--ignore` kalıpları ayıklanır.
 *
 * Kullanım:
 *   node scripts/figma-offline-diff.mjs --list
 *   node scripts/figma-offline-diff.mjs --frame 530:2927 --route /
 *   node scripts/figma-offline-diff.mjs --frame 1473:2 --live panel-data/perf/x.txt
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../panel/project.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const CACHE = path.join(process.cwd(), "panel-data", "figma-cache");

/**
 * frameId → okunabilir sayfa etiketi. `frametree_*` biçiminde CANVAS adı yok;
 * profildeki rota eşlemesi daha da faydalısını veriyor (sayfa + rota).
 */
const ROUTE_OF = Object.fromEntries(
  (PROJECT.figma?.routes ?? [])
    .filter((r) => r.frameId)
    .map((r) => [r.frameId, r.page]),
);

// ─────────────────────────────────── önbellek

function loadTrees() {
  if (!fs.existsSync(CACHE)) return [];
  /**
   * İKİ ÖNBELLEK BİÇİMİ VAR, ikisini de oku:
   *  - `filetree_*`  → `?ids=<canvas>` ile çekilmiş sayfa ağacı (eski, pahalı yol)
   *  - `frametree_*` → `figma-prewarm.mjs`in toplu çektiği tek frame ağacı (güncel yol)
   * Yalnız `filetree_` okumak 24 Ağustos'ta "önbellekte 0 frame" dedirtti: prewarm
   * 10 frame'i çekmişti ama hepsi diğer biçimdeydi.
   */
  return fs.readdirSync(CACHE)
    .filter((f) => /^(file|frame)tree_/.test(f) && f.endsWith(".json"))
    .map((f) => ({ file: f, doc: JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8")).document }));
}

function findNode(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

/**
 * Önbellekte metin katmanı olan EKRAN frame'leri.
 * Yalnızca ekran seviyesi listelenir — her derinlikteki frame'i saymak 1308
 * kayit veriyor ve ise yaramiyor.
 *
 * İKİ BİÇİM: `filetree_*` kökü DOCUMENT'tir, ekran frame'leri CANVAS'in doğrudan
 * çocuğudur. `frametree_*` kökü FRAME'in KENDİSİDİR (prewarm tek frame yazıyor) —
 * onu da ekran say, yoksa toplu çekilmiş 10 frame listede hiç görünmüyor.
 */
export function listFrames() {
  const out = [];
  const textCount = (n) => {
    let t = 0;
    const c = (x) => { if (x.type === "TEXT") t++; (x.children ?? []).forEach(c); };
    c(n);
    return t;
  };
  const push = (n, canvasName) => {
    if (n.type !== "FRAME" || !(n.children ?? []).length) return;
    const t = textCount(n);
    if (!t) return;
    const bb = n.absoluteBoundingBox ?? {};
    out.push({ id: n.id, name: n.name, canvas: canvasName, texts: t,
               w: Math.round(bb.width ?? 0), h: Math.round(bb.height ?? 0) });
  };
  for (const { doc } of loadTrees()) {
    if (doc?.type === "FRAME") { push(doc, ROUTE_OF[doc.id] ?? "(frame onbellegi)"); continue; }
    for (const canvas of doc?.children ?? []) {
      if (canvas.type !== "CANVAS") continue;
      for (const n of canvas.children ?? []) push(n, canvas.name);
    }
  }
  const seen = new Set();
  return out.filter((f) => (seen.has(f.id) ? false : seen.add(f.id)));
}

/** Frame'in metin katmanları: benzersiz, font/punto/ağırlık ile. */
export function designTexts(frameId) {
  for (const { doc } of loadTrees()) {
    const n = findNode(doc, frameId);
    if (!n) continue;
    const out = [];
    const walk = (x) => {
      if (x.type === "TEXT") {
        const ch = (x.characters ?? "").trim();
        const st = x.style ?? {};
        if (ch) out.push({ t: ch, f: st.fontFamily, s: st.fontSize, w: st.fontWeight });
      }
      (x.children ?? []).forEach(walk);
    };
    walk(n);
    const seen = new Set();
    return { frame: n.name, texts: out.filter((x) => (seen.has(x.t) ? false : seen.add(x.t))) };
  }
  return null;
}

// ─────────────────────────────────── normalizasyon (DERS 1)

export function norm(s) {
  return s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")           // birleşik işaretleri AT — 'İ' tuzağı burada çözülür
    .toLowerCase()
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────── dinamik içerik (DERS 3)

const DYNAMIC = /(₺|\$|€|\d{2,}|\d+[.,]\d)/;
export function isDynamic(t, extra = []) {
  if (DYNAMIC.test(t)) return true;          // fiyat, uzun sayı, ölçü
  if (t.length < 3) return true;             // tek harf/simge
  return extra.some((rx) => rx.test(t));
}

// ─────────────────────────────────── diff

export function diff(frameId, liveText, { ignore = [], limit = 40 } = {}) {
  const d = designTexts(frameId);
  if (!d) throw new Error(`Frame önbellekte yok: ${frameId} — 'node scripts/figma-offline-diff.mjs --list' ile bak`);
  const live = norm(liveText);
  const stat = d.texts.filter((t) => !isDynamic(t.t, ignore));
  const missing = stat.filter((t) => norm(t.t) && !live.includes(norm(t.t)));
  return {
    frame: d.frame,
    total: d.texts.length,
    static: stat.length,
    matched: stat.length - missing.length,
    missing: missing.slice(0, limit),
    dynamicSkipped: d.texts.length - stat.length,
  };
}

// ─────────────────────────────────── canlı yakalama

export async function captureLive(route, state) {
  const { chromium } = await import("@playwright/test");
  const envSrc = fs.readFileSync(".env", "utf8");
  const env = (envSrc.match(/HOMEE_ENV\s*=\s*(\S+)/) ?? [])[1];
  const base = (envSrc.match(new RegExp(`BASE_URL_${env.toUpperCase()}\\s*=\\s*(\\S+)`)) ?? [])[1];
  const st = `playwright/.auth/${env}-${state === "member" ? "user" : "gate"}.json`;
  if (!fs.existsSync(st)) throw new Error(`oturum dosyası yok: ${st}`);
  const b = await chromium.launch({ channel: "chrome" });
  const p = await (await b.newContext({ storageState: st, viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(base + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.waitForTimeout(4000);
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 130)); }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(2000);
  const txt = await p.evaluate(() => document.body.innerText);
  const gate = /Geçici Erişim/.test(txt);
  await b.close();
  if (gate) throw new Error("kapı kapalı — herhangi bir spec koşup oturumu yenile");
  return txt;
}

// ─────────────────────────────────── CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--list")) {
    const frames = listFrames();
    console.log(`önbellekte metin katmanı olan ${frames.length} frame:\n`);
    let canvas = null;
    for (const f of frames.sort((a, b) => (a.canvas || "").localeCompare(b.canvas || ""))) {
      if (f.canvas !== canvas) { canvas = f.canvas; console.log(`  ── ${canvas}`); }
      console.log(`     ${f.id.padEnd(12)} ${String(f.name).slice(0, 34).padEnd(36)} ${f.w}x${f.h}  ${f.texts} TEXT`);
    }
    process.exit(0);
  }

  const frameId = arg("--frame");
  if (!frameId) {
    console.error("--frame <id> zorunlu. Frame listesi: --list");
    process.exit(1);
  }
  const state = arg("--state", "guest");
  const ignore = (arg("--ignore", "") || "").split(",").filter(Boolean).map((x) => new RegExp(x, "i"));

  let liveText;
  const liveFile = arg("--live");
  const route = arg("--route");
  if (liveFile) liveText = fs.readFileSync(liveFile, "utf8");
  else if (route) {
    console.log(`canlı yakalanıyor: ${route} (durum: ${state})`);
    liveText = await captureLive(route, state);
  } else {
    console.error("--route <yol> ya da --live <dosya> gerekli");
    process.exit(1);
  }

  const r = diff(frameId, liveText, { ignore });
  console.log(`\n── ${r.frame}  (${frameId})`);
  console.log(`   ${r.total} tasarım metni · ${r.dynamicSkipped} dinamik ayıklandı · ${r.static} statik · ${r.matched} eşleşti · ${r.missing.length} EKSİK\n`);
  if (!r.missing.length) console.log("   eksik yok.");
  for (const t of r.missing) {
    console.log(`   ✗ ${JSON.stringify(t.t.slice(0, 62))}  [${t.f} ${t.s}px w${t.w}]`);
  }
  console.log(`
   ⚠ DURUM EŞİTLEME (ders 2): bu frame ürünlü/dolu bir durumu gösteriyorsa canlı
     tarafı da aynı duruma getir. Boş sepet ↔ ürünlü tasarım karşılaştırması
     uydurma "eksik" üretir. Gerekirse --state member kullan.`);
}
