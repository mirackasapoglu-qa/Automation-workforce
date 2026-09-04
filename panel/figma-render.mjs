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
import { figmaForRoute, FIGMA_FILE, FIGMA_ROUTES } from "./figma-map.mjs";
import { noteResponse } from "./figma-quota.mjs";
import { isCut } from "./connectors/cuts.mjs";

const CACHE_DIR = path.join(process.cwd(), "panel-data", "figma-cache");

function token() {
  // Bu dosya kimligi resolveCreds yerine DOGRUDAN okuyor (eski tutarsizlik);
  // salteri burada da sormazsak "koparildi" yazan Figma render etmeye devam eder.
  if (isCut("figma")) return null;
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

/**
 * Düğüm ağacını getirir: önce disk önbelleği, yoksa `/v1/files/:key?ids=` (bu uç
 * rate-limit bakımından `/nodes`'tan farklı kovada; `/nodes` tam ağaç için 429 verip
 * günler süren retry-after döndürüyor). Bir kez çekilir, sonra önbellekten okunur.
 */
async function fetchTree(nodeId) {
  // Once tam agac onbellegi (diff kosmussa oradan), sonra sig sorgu onbellegi
  for (const key of [`filetree_${FIGMA_FILE}_${nodeId}`, `shallow_${FIGMA_FILE}_${nodeId}`]) {
    const f = keyPath(key, "json");
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  const f = keyPath(`shallow_${FIGMA_FILE}_${nodeId}`, "json");

  const t = token();
  if (!t) throw new Error("~/.figma-credentials yok");
  // SIG sorgu: frame id/ad/boyut icin yeterli, tam agactan cok daha ucuz
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE}?ids=${encodeURIComponent(nodeId)}&depth=2`;
  const res = await fetch(url, { headers: { "X-Figma-Token": t } });
  noteResponse(url, res, `figma-render ${nodeId}`);
  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    throw new Error(
      `Figma rate limit (429)${ra ? ` — ${Math.round(Number(ra) / 3600)} saat sonra` : ""}. ` +
        `Onbellekte olan rotalar calisiyor.`,
    );
  }
  if (!res.ok) throw new Error(`Figma files ${res.status}`);
  const tree = await res.json();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(tree));
  return tree;
}

/** Ağaçtan hedef frame'i çözer: {id, name, w, h} */
async function resolveFrame(nodeId, frameName) {
  const tree = await fetchTree(nodeId);
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

  // Elle export edilmis PNG varsa API'ye hic gitme (bütce tükendiginde tek yol)
  const manualPng = keyPath(`manual_${map.node}`, "png");
  const manualMeta = keyPath(`manual_${map.node}`, "json");
  if (fs.existsSync(manualPng)) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(manualMeta, "utf8")); } catch {}
    return {
      buf: fs.readFileSync(manualPng),
      frame: { id: "manual", name: `${map.page} (elle export)`, w: meta.w ?? 0, h: meta.h ?? 0 },
      map,
      cached: true,
      manual: true,
    };
  }

  // frameId haritada varsa agac cagrisi YAPMA (429 riski + MCP kotasi ayda 6)
  let frame = map.frameId
    ? { id: map.frameId, name: map.frame ?? map.page, w: map.w ?? 0, h: map.h ?? 0 }
    : null;
  if (!frame) {
    try {
      frame = await resolveFrame(map.node, map.frame);
    } catch (e) {
      return { error: `${map.page}: ${e.message}`, map };
    }
  }
  if (!frame) return { error: `${map.page}: CANVAS altinda FRAME bulunamadi`, map };

  const pngPath = keyPath(`render_${FIGMA_FILE}_${frame.id}`, "png");
  if (fs.existsSync(pngPath)) {
    return { buf: fs.readFileSync(pngPath), frame, map, cached: true };
  }

  const t = token();
  if (!t) return { error: "~/.figma-credentials yok", map };
  const imgUrl = `https://api.figma.com/v1/images/${FIGMA_FILE}` +
    `?ids=${encodeURIComponent(frame.id)}&format=png&scale=1`;
  const res = await fetch(imgUrl, { headers: { "X-Figma-Token": t } });
  noteResponse(imgUrl, res, `figma-render ${frame.id}`);
  if (!res.ok) return { error: `Figma images ${res.status}`, map };
  const url = Object.values((await res.json()).images ?? {})[0];
  if (!url) return { error: "render URL alinamadi", map };
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(pngPath, buf);
  return { buf, frame, map, cached: false };
}

/** Onbellekten calisabilen rotalari listeler (rate limit sirasinda ne mumkun?). */
export function cachedRoutes() {
  const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
  const has = (prefix, id) => files.includes(`${prefix}_${FIGMA_FILE}_${id.replace(":", "_")}.json`) ||
                              files.includes(`${prefix}_${FIGMA_FILE}_${id.replace(":", "_")}.png`);
  return FIGMA_ROUTES.map((r) => {
    const tree = has("filetree", r.node) || has("shallow", r.node) || Boolean(r.frameId);
    let render = false;
    if (r.frameId) {
      render = has("render", r.frameId);
    } else if (tree) {
      try {
        const fr = resolveFrameSync(r.node, r.frame);
        render = fr ? has("render", fr.id) : false;
      } catch {
        render = false;
      }
    }
    return { page: r.page, node: r.node, cards: r.cards, tree, render, ready: tree && render };
  });
}

/** cachedRoutes icin senkron frame cozumu (yalnizca onbellekten). */
function resolveFrameSync(nodeId, frameName) {
  for (const key of [`filetree_${FIGMA_FILE}_${nodeId}`, `shallow_${FIGMA_FILE}_${nodeId}`]) {
    const f = keyPath(key, "json");
    if (!fs.existsSync(f)) continue;
    const tree = JSON.parse(fs.readFileSync(f, "utf8"));
    const canvas = findNode(tree.document, nodeId);
    if (!canvas) continue;
    let target = canvas;
    if (canvas.type === "CANVAS") {
      const frames = (canvas.children ?? []).filter((c) => c.type === "FRAME");
      target =
        (frameName && frames.find((x) => x.name === frameName)) ??
        frames.slice().sort((a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0))[0];
    }
    if (target) {
      const bb = target.absoluteBoundingBox ?? {};
      return { id: target.id, name: target.name, w: Math.round(bb.width ?? 0), h: Math.round(bb.height ?? 0) };
    }
  }
  return null;
}
