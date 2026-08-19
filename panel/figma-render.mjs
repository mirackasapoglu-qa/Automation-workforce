/**
 * Rota için Figma frame render'ını (PNG) verir — panelde yan yana görünüm için.
 *
 * Önbellek öncelikli: ağaç `panel-data/figma-cache/filetree_*.json` içinde varsa
 * Figma'ya HİÇ çağrı yapılmaz. Yoksa sadece `/v1/images` çağrılır (bu uç rate-limit
 * kovasında rahat); tam ağaç çağrısı buradan YAPILMAZ çünkü 429 riski var.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { figmaForRoute, FIGMA_FILE } from "./figma-map.mjs";

const CACHE_DIR = path.join(process.cwd(), "panel-data", "figma-cache");

function token() {
  const f = path.join(os.homedir(), ".figma-credentials");
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, "utf8").match(/FIGMA_TOKEN\s*=\s*(\S+)/)?.[1] ?? null;
}

const keyPath = (k, ext) => path.join(CACHE_DIR, k.replace(/[^A-Za-z0-9_.-]/g, "_") + "." + ext);

function findNode(node, id, depth = 0) {
  if (!node || depth > 40) return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Cache'teki ağaçtan hedef frame'i çözer: {id, name, w, h} */
function resolveFrame(nodeId, frameName) {
  const f = keyPath(`filetree_${FIGMA_FILE}_${nodeId}`, "json");
  if (!fs.existsSync(f)) return null;
  const tree = JSON.parse(fs.readFileSync(f, "utf8"));
  const canvas = findNode(tree.document, nodeId);
  if (!canvas) return null;
  let target = canvas;
  if (canvas.type === "CANVAS") {
    const frames = (canvas.children ?? []).filter((c) => c.type === "FRAME");
    target =
      (frameName && frames.find((x) => x.name === frameName)) ??
      frames
        .slice()
        .sort((a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0))[0];
  }
  if (!target) return null;
  const bb = target.absoluteBoundingBox ?? {};
  return {
    id: target.id,
    name: target.name,
    w: Math.round(bb.width ?? 0),
    h: Math.round(bb.height ?? 0),
  };
}

/** Rota için render PNG'sini döner: { buf, frame, cached } — yoksa null. */
export async function renderForRoute(routePath) {
  const map = figmaForRoute(routePath ?? "/");
  if (!map) return { error: `Bu rota icin Figma eslesmesi yok: ${routePath}` };

  const frame = resolveFrame(map.node, map.frame);
  if (!frame) {
    return {
      error:
        `Bu frame'in agaci onbellekte yok (${map.page}). Once bir kez diff kos: ` +
        `node scripts/figma-diff.mjs --node ${map.node} --route ${map.matched}`,
      map,
    };
  }

  const pngPath = keyPath(`render_${FIGMA_FILE}_${frame.id}`, "png");
  if (fs.existsSync(pngPath)) {
    return { buf: fs.readFileSync(pngPath), frame, map, cached: true };
  }

  const t = token();
  if (!t) return { error: "~/.figma-credentials yok", map };
  const res = await fetch(
    `https://api.figma.com/v1/images/${FIGMA_FILE}?ids=${encodeURIComponent(frame.id)}&format=png&scale=1`,
    { headers: { "X-Figma-Token": t } },
  );
  if (!res.ok) return { error: `Figma images ${res.status}`, map };
  const url = Object.values((await res.json()).images ?? {})[0];
  if (!url) return { error: "render URL alinamadi", map };
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(pngPath, buf);
  return { buf, frame, map, cached: false };
}
