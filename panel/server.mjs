#!/usr/bin/env node
/**
 * Homee QA Paneli — http://localhost:4646  (PANEL_PORT ile degisir)
 *
 * NadirGold panelinden tasinan mimari: whitelist'li kosum tetikleme + SSE canli log
 * + verdict/kanit kaydi + rapor gorunumu + JIRA katmani.
 *
 * Jira: machinarium.atlassian.net / MAC projesi / MAC-7035 "Tepe - Redesign" epic'i.
 * Kimlik ~/.jira-credentials'tan okunur (repoya yazilmaz). Yazma uclari
 * (/api/jira/comment, /api/jira/transition, /api/jira/bug) SADECE kullanici
 * panelden tetikleyince calisir; otomatik yazma YOK.
 *
 * Guvenlik notu: sadece panel/runs.json icindeki komutlar calisir. Istekten gelen
 * serbest komut ASLA exec edilmez.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  JIRA,
  VIEWS,
  getCards,
  getCard,
  postComment,
  transition,
  createBug,
  whoami,
} from "./jira.mjs";
import { startProxy } from "./proxy.mjs";
import { matchRoute, runsForCard } from "./route-map.mjs";
import { figmaForRoute } from "./figma-map.mjs";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PANEL_PORT || 4646);
const ENV = (process.env.HOMEE_ENV || "test").toLowerCase();
const BASE_URL = process.env[`BASE_URL_${ENV.toUpperCase()}`] || "";

const DATA_DIR = path.join(ROOT, "panel-data");
const VERDICT_DIR = path.join(DATA_DIR, "verdicts");
const EVIDENCE_DIR = path.join(DATA_DIR, "evidence");
for (const d of [DATA_DIR, VERDICT_DIR, EVIDENCE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const RUNS = JSON.parse(fs.readFileSync(path.join(__dirname, "runs.json"), "utf8")).runs;
const PROXY_PORT = Number(process.env.PANEL_PROXY_PORT || PORT + 1);
let PROXY_URL = "";

// ---------------- tasarim diff ----------------
const FIGMA_OUT_DIR = path.join(DATA_DIR, "figma");
fs.mkdirSync(FIGMA_OUT_DIR, { recursive: true });
let activeDiff = null; // { slug, child, startedAt }

function startDiff({ path: routePath }) {
  if (activeDiff) return { ok: false, error: `Diff zaten kosuyor: ${activeDiff.slug}` };
  const map = figmaForRoute(routePath ?? "/");
  if (!map) return { ok: false, error: `Bu rota icin Figma eslesmesi yok: ${routePath}` };

  const slug = (map.matched === "/" ? "anasayfa" : map.matched.replace(/[^a-zA-Z0-9]+/g, "-")).replace(/^-|-$/g, "");
  const htmlOut = path.join("panel-data", "figma", `${slug}.html`);
  const jsonOut = path.join("panel-data", "figma", `${slug}.json`);

  const args = [
    "scripts/figma-diff.mjs",
    "--file", map.file,
    "--node", map.node,
    "--route", map.matched,
    "--out", htmlOut,
    "--json", jsonOut,
  ];
  if (map.frame) args.push("--frame", map.frame);

  const child = spawn("node", args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });
  activeDiff = { slug, child, startedAt: Date.now(), map };
  broadcast("diff-start", { slug, route: map.matched, page: map.page, cards: map.cards });

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
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------------- kosum ----------------
let active = null; // { id, child, startedAt, lines: [] }

function startRun(runId) {
  if (active) return { ok: false, error: `Zaten kosuyor: ${active.id}` };
  const run = RUNS[runId];
  if (!run) return { ok: false, error: `Whitelist'te yok: ${runId}` };

  const child = spawn(run.cmd, run.args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  active = { id: runId, label: run.label, child, startedAt: Date.now(), lines: [] };
  broadcast("run-start", { id: runId, label: run.label, startedAt: active.startedAt });

  const push = (chunk, stream) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      active.lines.push(line);
      if (active.lines.length > 4000) active.lines.shift();
      broadcast("log", { stream, line });
    }
  };
  child.stdout.on("data", (c) => push(c, "out"));
  child.stderr.on("data", (c) => push(c, "err"));

  child.on("close", (code) => {
    const summary = active.lines.slice(-40).join("\n");
    broadcast("run-end", {
      id: runId,
      code,
      durationMs: Date.now() - active.startedAt,
      summary,
    });
    active = null;
  });

  return { ok: true, id: runId };
}

function stopRun() {
  if (!active) return { ok: false, error: "Kosan bir sey yok" };
  active.child.kill("SIGTERM");
  return { ok: true };
}

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

// ---------------- son kosum sonuclari ----------------
function lastResults() {
  const f = path.join(ROOT, "test-results", "results.json");
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, "utf8"));
  const rows = [];
  const walk = (suite, file) => {
    const fp = suite.file || file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1] ?? {};
        rows.push({
          file: (fp || "").replace(/^tests\//, ""),
          title: spec.title,
          status: last.status ?? "unknown",
          expected: t.expectedStatus,
          duration: last.duration ?? 0,
          error: (last.error?.message ?? "").split("\n").slice(0, 4).join("\n"),
        });
      }
    }
    for (const c of suite.suites ?? []) walk(c, fp);
  };
  for (const s of raw.suites ?? []) walk(s, s.file);
  return {
    startedAt: raw.stats?.startTime ?? null,
    rows,
    counts: {
      total: rows.length,
      passed: rows.filter((r) => r.status === "passed").length,
      failed: rows.filter((r) => r.status === "failed" || r.status === "timedOut").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
    },
  };
}

function knownIssues() {
  const f = path.join(ROOT, "tests", "known-issues.ts");
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, "utf8");
  const out = [];
  const re = /id:\s*"([^"]+)"[\s\S]*?where:\s*"([^"]+)"[\s\S]*?detail:\s*\n?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ id: m[1], where: m[2], detail: m[3] });
  return out;
}

// ---------------- HTTP ----------------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      return send(
        res,
        200,
        fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"),
        "text/html; charset=utf-8",
      );
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
          views: Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label })),
        },
        ordersAllowed: process.env.ALLOW_HOMEE_ORDERS === "1",
        runs: Object.entries(RUNS).map(([id, r]) => ({ id, label: r.label, group: r.group ?? "" })),
        active: active ? { id: active.id, label: active.label, startedAt: active.startedAt } : null,
        knownIssues: knownIssues(),
      });
    }

    if (p === "/api/results") return send(res, 200, lastResults() ?? { rows: [], counts: {} });

    // ---------------- Site (iframe) ----------------
    if (p === "/api/figma/match") {
      const m = figmaForRoute(url.searchParams.get("path") ?? "/");
      return send(res, 200, m ?? { matched: url.searchParams.get("path"), node: null });
    }

    if (p === "/api/figma/diff" && req.method === "POST") {
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
          const j = JSON.parse(fs.readFileSync(path.join(FIGMA_OUT_DIR, f), "utf8"));
          return { slug: f.replace(/\.json$/, ""), ...j, reportUrl: `/figma/${f.replace(/\.json$/, "")}.html` };
        }),
      );
    }

    if (p.startsWith("/figma/")) {
      const f = path.join(FIGMA_OUT_DIR, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: "rapor yok" });
      return send(res, 200, fs.readFileSync(f, "utf8"), "text/html; charset=utf-8");
    }

    if (p === "/api/site/match") {
      const rule = matchRoute(url.searchParams.get("path") ?? "/");
      return send(res, 200, rule ?? { matched: url.searchParams.get("path"), runId: null });
    }

    // ---------------- Jira: OKUMA ----------------
    if (p === "/api/jira/whoami") return send(res, 200, await whoami());

    if (p === "/api/jira/cards") {
      const view = url.searchParams.get("view") ?? "test";
      return send(res, 200, await getCards(view));
    }

    if (p.startsWith("/api/jira/card/")) {
      const key = p.split("/").pop();
      const card = await getCard(key);
      // Karti dogrulayan whitelist kosumlari — panelden tek tikla tetiklenir
      card.runs = runsForCard(key).map((r) => ({
        ...r,
        label: RUNS[r.runId]?.label ?? r.runId,
      }));
      return send(res, 200, card);
    }

    // ---------------- Jira: YAZMA (yalnizca panelden tetiklenir) ----------------
    if (p === "/api/jira/comment" && req.method === "POST") {
      const { key, text } = await readBody(req);
      if (!key || !text) return send(res, 400, { error: "key ve text zorunlu" });
      await postComment(key, text);
      broadcast("log", { stream: "out", line: `[jira] ${key} kartina yorum yazildi` });
      return send(res, 200, { ok: true, key });
    }

    if (p === "/api/jira/transition" && req.method === "POST") {
      const { key, transitionId, comment } = await readBody(req);
      if (!key || !transitionId) return send(res, 400, { error: "key ve transitionId zorunlu" });
      await transition(key, transitionId, comment);
      broadcast("log", { stream: "out", line: `[jira] ${key} statusu degistirildi (${transitionId})` });
      return send(res, 200, { ok: true, key });
    }

    if (p === "/api/jira/bug" && req.method === "POST") {
      const { summary, description, parent, labels } = await readBody(req);
      if (!summary) return send(res, 400, { error: "summary zorunlu" });
      const created = await createBug({ summary, description: description ?? "", parent, labels });
      broadcast("log", { stream: "out", line: `[jira] yeni bug: ${created.key}` });
      return send(res, 200, { ok: true, key: created.key, url: `${JIRA.host}/browse/${created.key}` });
    }

    if (p === "/api/verdicts") {
      if (req.method === "POST") return send(res, 200, saveVerdict(await readBody(req)));
      return send(res, 200, allVerdicts());
    }

    if (p === "/api/run" && req.method === "POST") {
      const { id } = await readBody(req);
      return send(res, 200, startRun(id));
    }

    if (p === "/api/stop" && req.method === "POST") return send(res, 200, stopRun());

    if (p === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": bagli\n\n");
      sseClients.add(res);
      if (active) {
        res.write(
          `event: run-start\ndata: ${JSON.stringify({ id: active.id, label: active.label, startedAt: active.startedAt })}\n\n`,
        );
        for (const line of active.lines.slice(-200)) {
          res.write(`event: log\ndata: ${JSON.stringify({ stream: "out", line })}\n\n`);
        }
      }
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // kanit gorselleri ve raporlar
    if (p.startsWith("/evidence/")) {
      const f = path.join(EVIDENCE_DIR, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: "yok" });
      res.writeHead(200, { "content-type": p.endsWith(".png") ? "image/png" : "image/jpeg" });
      return res.end(fs.readFileSync(f));
    }

    if (p === "/report" || p === "/playwright-report") {
      const f = path.join(ROOT, "playwright-report", "index.html");
      if (!fs.existsSync(f)) return send(res, 404, { error: "Rapor yok, once test kos" });
      return send(res, 200, fs.readFileSync(f, "utf8"), "text/html; charset=utf-8");
    }

    return send(res, 404, { error: `Bilinmeyen uc: ${p}` });
  } catch (e) {
    return send(res, 500, { error: String(e.message ?? e) });
  }
});

if (BASE_URL) {
  const { url } = await startProxy({ baseURL: BASE_URL, port: PROXY_PORT });
  PROXY_URL = url;
}

server.listen(PORT, () => {
  console.log(`\nHomee QA Paneli → http://localhost:${PORT}`);
  if (PROXY_URL) console.log(`  site proxy (iframe) → ${PROXY_URL}`);
  console.log(`  ortam: ${ENV} → ${BASE_URL}`);
  console.log(`  whitelist'li kosum sayisi: ${Object.keys(RUNS).length}`);
  console.log(`  siparis tamamlama: ${process.env.ALLOW_HOMEE_ORDERS === "1" ? "ACIK" : "KAPALI"}\n`);
});
