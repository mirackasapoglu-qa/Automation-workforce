#!/usr/bin/env node
/**
 * Figma önbelleğini hazırlar — panelin tüm rotalarda çevrimdışı çalışması için.
 *
 * ⚠️ NEDEN GEREKLİ: Figma maliyet tabanlı rate limit uyguluyor. Tam sayfa ağacı
 * çekmek pahalı (Main Page = 7,2 MB / 17 frame) ve bütçe bitince retry-after
 * GÜNLER sürüyor. Bu script maliyeti en aza indirecek sırayı izler:
 *   1) `?ids=<canvas>&depth=2`  → sığ, sadece frame kimlikleri
 *   2) `?ids=<frameId>`         → yalnızca hedef frame'in ağacı (metin katmanları)
 *   3) `/v1/images?ids=<frameId>` → PNG render
 * Zaten önbellekte olanı atlar, çağrılar arasında bekler, 429 görünce DURUR.
 *
 * Kullanım: node scripts/figma-prewarm.mjs [--only "My Cart,Checkout"] [--delay 6] [--renders-only]
 *
 * `panel/figma-map.mjs` içinde frameId dolu olan rotalar için 1) adımı hiç
 * çalışmaz; `--renders-only` ile 2) da atlanır → tek `/v1/images` çağrısı.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIGMA_ROUTES, FIGMA_FILE } from "../panel/figma-map.mjs";
import { noteResponse } from "../panel/figma-quota.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const ONLY = (arg("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
/**
 * Çağrılar arası bekleme. VARSAYILAN 0: Dev/Full koltukta Tier-1 limiti 10-20/dk
 * ve prewarm toplamda 3 istek yapıyor — beklemenin koruduğu bir şey yok, sadece
 * 12 sn boşa gidiyordu. View/Collab koltukta (6/ay) `--delay 6` ile yavaşlat.
 */
const DELAY = Number(arg("--delay", 0)) * 1000;
const RENDERS_ONLY = process.argv.includes("--renders-only");
const CACHE = path.join(process.cwd(), "panel-data", "figma-cache");
fs.mkdirSync(CACHE, { recursive: true });

const TOKEN = fs
  .readFileSync(path.join(os.homedir(), ".figma-credentials"), "utf8")
  .match(/FIGMA_TOKEN\s*=\s*(\S+)/)?.[1];
if (!TOKEN) throw new Error("~/.figma-credentials içinde FIGMA_TOKEN yok");

const kp = (k, ext) => path.join(CACHE, k.replace(/[^A-Za-z0-9_.-]/g, "_") + "." + ext);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

async function api(url) {
  const res = await fetch(url, { headers: { "X-Figma-Token": TOKEN } });
  noteResponse(url, res, "figma-prewarm");
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 0);
    throw new RateLimited(
      `429 — bütçe tükendi${ra ? `, ${Math.round(ra / 3600)} saat sonra tekrar dene` : ""}`,
    );
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res;
}

const findNode = (n, id, d = 0) =>
  !n || d > 40 ? null : n.id === id ? n : (n.children ?? []).reduce((a, c) => a ?? findNode(c, id, d + 1), null);

try {
let calls = 0;
let skipped = 0;

/**
 * MALIYET NOTU (2026-08-19'da bütçe bu yüzden yandı):
 * Figma limiti istek SAYISINA değil dönen düğüm HACMİNE bakıyor. Rota rota
 * `?ids=<canvas>` çekmek en pahalı yol — bir sayfanın TÜM frame'lerini getirir
 * (Main Page = 7,2 MB / 17 frame, oysa tek frame gerekiyordu).
 *
 * Bu script 3 çağrıda bitirir:
 *   1) files?depth=2            → tüm dosya sığ (~70 KB), frame kimlikleri
 *   2) files?ids=f1,f2,…        → yalnızca gereken frame'lerin ağacı (toplu)
 *   3) images?ids=f1,f2,…       → tüm render'lar tek istekte
 * `ids` virgülle çoklu id kabul ediyor; tek tek çağırmak gereksiz.
 */
const routes = FIGMA_ROUTES.filter((r) => !ONLY.length || ONLY.includes(r.page));

// ---- 0) haritada frameId olan rotalar: hicbir cagri gerekmez
const mapped = routes.filter((r) => r.frameId);
const unmapped = routes.filter((r) => !r.frameId);
const targets = mapped.map((r) => ({ ...r, frameName: r.frame ?? r.page, w: r.w ?? 0, h: r.h ?? 0 }));
for (const t of targets) console.log(`0) ${t.page.padEnd(26)} → haritadan "${t.frameName}" (${t.frameId})`);

// ---- 1) sığ ağaç: yalnizca frameId'si BILINMEYEN rota varsa
const shallowKey = `shallowfile_${FIGMA_FILE}_depth2`;
let fileTree = null;
if (!unmapped.length) {
  console.log("1) sığ dosya ağacı: gerekmiyor (tüm rotaların frameId'si haritada)");
  skipped++;
} else if (fs.existsSync(kp(shallowKey, "json"))) {
  fileTree = JSON.parse(fs.readFileSync(kp(shallowKey, "json"), "utf8"));
  console.log("1) sığ dosya ağacı: önbellekten");
  skipped++;
} else {
  const res = await api(`https://api.figma.com/v1/files/${FIGMA_FILE}?depth=2`);
  fileTree = await res.json();
  fs.writeFileSync(kp(shallowKey, "json"), JSON.stringify(fileTree));
  calls++;
  console.log(`1) sığ dosya ağacı: çekildi (${Math.round(JSON.stringify(fileTree).length / 1024)} KB, 1 çağrı)`);
  if (DELAY) await sleep(DELAY);
}

// ---- frameId'si bilinmeyenleri sığ ağaçtan çöz (ağ çağrısı YOK)
for (const r of unmapped) {
  if (!fileTree) break;
  const canvas = findNode(fileTree.document, r.node);
  if (!canvas) {
    console.log(`   ⚠️  ${r.page}: düğüm ${r.node} sığ ağaçta yok, atlanıyor`);
    continue;
  }
  let frame = canvas;
  if (canvas.type === "CANVAS") {
    const frames = (canvas.children ?? []).filter((c) => c.type === "FRAME");
    frame =
      (r.frame && frames.find((f) => f.name === r.frame)) ??
      frames.slice().sort((a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0))[0];
  }
  if (!frame) {
    console.log(`   ⚠️  ${r.page}: FRAME bulunamadı`);
    continue;
  }
  const bb = frame.absoluteBoundingBox ?? {};
  targets.push({ ...r, frameId: frame.id, frameName: frame.name, w: Math.round(bb.width ?? 0), h: Math.round(bb.height ?? 0) });
  console.log(`   ${r.page.padEnd(26)} → "${frame.name}" ${Math.round(bb.width)}x${Math.round(bb.height)} (${frame.id})`);
}

// ---- 2) frame ağaçları: eksik olanları TEK çağrıda
// --renders-only: panel yalnizca PNG istiyorsa agac cagrisini tamamen atla
const needTree = RENDERS_ONLY ? [] : targets.filter((t) => !fs.existsSync(kp(`frametree_${FIGMA_FILE}_${t.frameId}`, "json")));
if (!needTree.length) {
  console.log(RENDERS_ONLY ? "2) frame ağaçları: atlandı (--renders-only)" : "2) frame ağaçları: hepsi önbellekte");
  skipped++;
} else {
  const ids = needTree.map((t) => t.frameId).join(",");
  const res = await api(`https://api.figma.com/v1/files/${FIGMA_FILE}?ids=${encodeURIComponent(ids)}`);
  const tree = await res.json();
  calls++;
  for (const t of needTree) {
    const sub = findNode(tree.document, t.frameId);
    if (sub) fs.writeFileSync(kp(`frametree_${FIGMA_FILE}_${t.frameId}`, "json"), JSON.stringify({ document: sub }));
  }
  console.log(`2) frame ağaçları: ${needTree.length} frame tek çağrıda çekildi (${Math.round(JSON.stringify(tree).length / 1024)} KB)`);
  if (DELAY) await sleep(DELAY);
}

// ---- 3) render'lar: eksik olanları TEK çağrıda
const needRender = targets.filter((t) => !fs.existsSync(kp(`render_${FIGMA_FILE}_${t.frameId}`, "png")));
if (!needRender.length) {
  console.log("3) render'lar: hepsi önbellekte");
  skipped++;
} else {
  const ids = needRender.map((t) => t.frameId).join(",");
  const res = await api(`https://api.figma.com/v1/images/${FIGMA_FILE}?ids=${encodeURIComponent(ids)}&format=png&scale=1`);
  const images = (await res.json()).images ?? {};
  calls++;
  for (const [id, url] of Object.entries(images)) {
    if (!url) continue;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(kp(`render_${FIGMA_FILE}_${id}`, "png"), buf);
    console.log(`   render ${id}: ${Math.round(buf.length / 1024)} KB`);
  }
  console.log(`3) render'lar: ${needRender.length} frame tek çağrıda`);
}

console.log(`\nBitti — ${targets.length} rota hazır, Figma'ya ${calls} çağrı yapıldı.`);
} catch (e) {
  if (e instanceof RateLimited) {
    console.log(`\n⏸  DURDURULDU: ${e.message}`);
    console.log("   Bütçe açıldığında aynı komutu tekrar çalıştır — tamamlananları atlar.");
    process.exit(2);
  }
  throw e;
}
