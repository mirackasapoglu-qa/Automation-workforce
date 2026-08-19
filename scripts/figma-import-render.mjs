#!/usr/bin/env node
/**
 * Figma'dan ELLE export edilmiş bir PNG'yi panelin önbelleğine alır.
 *
 * Ne zaman gerekir: Figma API bütçesi tükendiğinde (429, retry-after günler)
 * yan yana tasarım görünümünü çalışır tutmak için. Frame'i Figma arayüzünden
 * PNG olarak export et (1x), sonra buraya ver.
 *
 * ⚠️ Sınır: yalnızca GÖRSEL karşılaştırmayı açar. Spec/metin diff'i düğüm
 * ağacına ihtiyaç duyar (font/boyut/renk/metin katmanları) — o API ile gelir.
 *
 * Kullanım:
 *   node scripts/figma-import-render.mjs --route /sepet --png ~/Downloads/my-cart.png
 *   node scripts/figma-import-render.mjs --list
 */
import fs from "node:fs";
import path from "node:path";
import { FIGMA_ROUTES, figmaForRoute } from "../panel/figma-map.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const CACHE = path.join(process.cwd(), "panel-data", "figma-cache");

if (process.argv.includes("--list")) {
  console.log("Elle PNG beslenebilecek rotalar:\n");
  for (const r of FIGMA_ROUTES) {
    const slug = slugFor(r.node);
    const has = fs.existsSync(path.join(CACHE, `manual_${slug}.png`));
    console.log(`  ${r.page.padEnd(28)} node ${r.node.padEnd(12)} ${has ? "✓ elle PNG var" : "—"}`);
  }
  console.log("\nFigma'da frame'i sec → sag panel Export → PNG 1x → indir → bu script'e ver.");
  process.exit(0);
}

function slugFor(node) {
  return node.replace(/[^A-Za-z0-9]/g, "_");
}

const route = arg("--route", null);
const png = arg("--png", null);
if (!route || !png) {
  console.error("Kullanim: --route /sepet --png <dosya.png>   (rotalari gormek icin --list)");
  process.exit(1);
}

const map = figmaForRoute(route);
if (!map) {
  console.error(`Bu rota icin Figma eslesmesi yok: ${route}`);
  process.exit(1);
}
const src = png.replace(/^~/, process.env.HOME ?? "~");
if (!fs.existsSync(src)) {
  console.error(`PNG bulunamadi: ${src}`);
  process.exit(1);
}
const buf = fs.readFileSync(src);
if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  console.error("Dosya PNG degil (imza uyusmuyor).");
  process.exit(1);
}
// PNG basligindan boyut
const w = buf.readUInt32BE(16);
const h = buf.readUInt32BE(20);

fs.mkdirSync(CACHE, { recursive: true });
const dst = path.join(CACHE, `manual_${slugFor(map.node)}.png`);
fs.writeFileSync(dst, buf);
fs.writeFileSync(
  path.join(CACHE, `manual_${slugFor(map.node)}.json`),
  JSON.stringify({ page: map.page, node: map.node, route: map.matched, w, h, importedAt: new Date().toISOString() }, null, 2),
);

console.log(`✓ ${map.page} (${map.matched}) icin tasarim eklendi`);
console.log(`  kaynak : ${src}`);
console.log(`  hedef  : ${path.relative(process.cwd(), dst)}  (${w}x${h}, ${Math.round(buf.length / 1024)} KB)`);
console.log(`  panelde: Site (canli) → ${map.matched} → "Yan yana tasarim"`);
