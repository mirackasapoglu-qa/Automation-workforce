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
 * Kullanım: node scripts/figma-prewarm.mjs [--only "My Cart,Checkout"] [--delay 6]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIGMA_ROUTES, FIGMA_FILE } from "../panel/figma-map.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const ONLY = (arg("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DELAY = Number(arg("--delay", 6)) * 1000;
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

let fetched = 0;
let skipped = 0;

try {
for (const route of FIGMA_ROUTES) {
  if (ONLY.length && !ONLY.includes(route.page)) continue;
  console.log(`\n▸ ${route.page}  (node ${route.node}, kart ${route.cards.join(", ")})`);

  // 1) sığ ağaç
  let tree;
  const shallowKey = `shallow_${FIGMA_FILE}_${route.node}`;
  const deepKey = `filetree_${FIGMA_FILE}_${route.node}`;
  if (fs.existsSync(kp(deepKey, "json"))) {
    tree = JSON.parse(fs.readFileSync(kp(deepKey, "json"), "utf8"));
    console.log("   sığ ağaç: (tam ağaç önbellekte)");
    skipped++;
  } else if (fs.existsSync(kp(shallowKey, "json"))) {
    tree = JSON.parse(fs.readFileSync(kp(shallowKey, "json"), "utf8"));
    console.log("   sığ ağaç: önbellekten");
    skipped++;
  } else {
    const res = await api(
      `https://api.figma.com/v1/files/${FIGMA_FILE}?ids=${encodeURIComponent(route.node)}&depth=2`,
    );
    tree = await res.json();
    fs.writeFileSync(kp(shallowKey, "json"), JSON.stringify(tree));
    console.log(`   sığ ağaç: çekildi (${Math.round(JSON.stringify(tree).length / 1024)} KB)`);
    fetched++;
    await sleep(DELAY);
  }

  // frame'i çöz
  const canvas = findNode(tree.document, route.node);
  if (!canvas) {
    console.log("   ⚠️ düğüm ağaçta yok, atlanıyor");
    continue;
  }
  let frame = canvas;
  if (canvas.type === "CANVAS") {
    const frames = (canvas.children ?? []).filter((c) => c.type === "FRAME");
    frame =
      (route.frame && frames.find((f) => f.name === route.frame)) ??
      frames.slice().sort((a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0))[0];
  }
  if (!frame) {
    console.log("   ⚠️ FRAME bulunamadı, atlanıyor");
    continue;
  }
  const bb = frame.absoluteBoundingBox ?? {};
  console.log(`   frame: "${frame.name}" ${Math.round(bb.width)}x${Math.round(bb.height)} (${frame.id})`);

  // 2) frame ağacı (metin katmanları — diff için)
  const frameKey = `frametree_${FIGMA_FILE}_${frame.id}`;
  if (fs.existsSync(kp(frameKey, "json"))) {
    console.log("   frame ağacı: önbellekten");
    skipped++;
  } else {
    const res = await api(
      `https://api.figma.com/v1/files/${FIGMA_FILE}?ids=${encodeURIComponent(frame.id)}`,
    );
    const ft = await res.json();
    fs.writeFileSync(kp(frameKey, "json"), JSON.stringify(ft));
    console.log(`   frame ağacı: çekildi (${Math.round(JSON.stringify(ft).length / 1024)} KB)`);
    fetched++;
    await sleep(DELAY);
  }

  // 3) render
  const renderKey = `render_${FIGMA_FILE}_${frame.id}`;
  if (fs.existsSync(kp(renderKey, "png"))) {
    console.log("   render: önbellekten");
    skipped++;
  } else {
    const res = await api(
      `https://api.figma.com/v1/images/${FIGMA_FILE}?ids=${encodeURIComponent(frame.id)}&format=png&scale=1`,
    );
    const url = Object.values((await res.json()).images ?? {})[0];
    if (!url) {
      console.log("   ⚠️ render URL'i yok");
      continue;
    }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(kp(renderKey, "png"), buf);
    console.log(`   render: çekildi (${Math.round(buf.length / 1024)} KB)`);
    fetched++;
    await sleep(DELAY);
  }
}

console.log(`\nBitti — ${fetched} çağrı yapıldı, ${skipped} adım önbellekten karşılandı.`);
} catch (e) {
  if (e instanceof RateLimited) {
    console.log(`\n⏸  DURDURULDU: ${e.message}`);
    console.log(`   ${fetched} çağrı yapılmıştı, ${skipped} adım önbellekten geldi.`);
    console.log("   Bütçe açıldığında aynı komutu tekrar çalıştır — tamamlananları atlar.");
    process.exit(2);
  }
  throw e;
}
