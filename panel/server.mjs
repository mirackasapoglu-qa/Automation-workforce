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
  VIEWS,
  getCards,
  getCard,
  postComment,
  transition,
  createBug,
  whoami,
  attachFile,
  assignableUsers,
} from "./jira.mjs";
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
import {
  suggestScenarios,
  buildContext,
  hasCredentials,
  hasSdk,
  AUTH_HINT,
  SDK_HINT,
} from "./scenario-suggest.mjs";
import { analyze as analyzePerf } from "./perf-analyze.mjs";
import { preflight } from "./preflight.mjs";
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
]);

function requireAuth(req, res) {
  if (req.headers["x-panel-token"] !== PANEL_TOKEN) {
    send(res, 403, {
      error:
        "Panel token gerekli. Bu uc yazma islemi yapar; sadece panel arayuzunden cagrilabilir.",
    });
    return false;
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { error: `Origin reddedildi: ${origin}` });
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

      // Bu spec'i kullanan Jira kartlari (CARD_SPECS ters haritasi)
      const cards = Object.entries(CARD_SPECS)
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

/**
 * @param headless true ise koşumdan `--headed` cikarilir ve npm script'i olan
 *   kosumlar dogrudan `npx playwright test`e cevrilir.
 *
 * NEDEN: 21 kosumun 17'si `--headed`. Playwright headed modda TEST BASINA bir
 * tarayici penceresi aciyor; 5 testlik bir spec 5 pencere demek. Kullanici
 * "surekli browser aciliyor" derken bunu goruyor. Anahtar panelde, kosum
 * tanimlarini degistirmeye gerek yok.
 */
function startRun(runId, params, headless = false) {
  if (active) return { ok: false, error: `Zaten kosuyor: ${active.id}` };

  let cmd;
  let args;
  let label;

  if (runId === "draft") {
    // Taslak koşumu AYRI config ile: testDir karantinaya bakar ve rapor
    // test-results/draft-results.json'a yazilir — gercek suite'in son
    // sonuclari ve case oran defteri kirlenmez.
    const d = draftFile(params?.name);
    if (!d)
      return {
        ok: false,
        error: "Taslak bulunamadi (ad gecersiz ya da dosya yok)",
      };
    const proj = params?.project === "mobile" ? "mobile" : "chromium";
    ensureDraftBridge();
    cmd = "npx";
    args = [
      "playwright",
      "test",
      "--config",
      "playwright.draft.config.ts",
      d.base,
      `--project=${proj}`,
    ];
    if (params?.headed) args.push("--headed");
    label = `Taslak: ${d.base} (${proj}${params?.headed ? ", headed" : ""})`;
  } else if (runId === "custom") {
    const built = buildCustomArgs(params);
    if (built.errors.length)
      return { ok: false, error: built.errors.join(" · ") };
    cmd = "npx";
    args = built.args;
    label = `Parametreli: ${(params.specs ?? []).join(", ")}${params.grep ? ` -g "${params.grep}"` : ""}${
      params.repeatEach > 1 ? ` ×${params.repeatEach}` : ""
    }${params.headed ? " (headed)" : ""}`;
  } else {
    const run = RUNS[runId];
    if (!run) return { ok: false, error: `Whitelist'te yok: ${runId}` };
    cmd = run.cmd;
    args = run.args;
    label = run.label;

    if (headless) {
      // `npm run test:x` seklindeki kosumlar --headed'i package.json'da tasiyor;
      // args'tan cikarmak yetmez, script'i dogrudan playwright cagrisina ceviriyoruz.
      if (cmd === "npm" && args[0] === "run") {
        const scriptName = args[1];
        const script = PKG_SCRIPTS[scriptName] || "";
        const parts = script.split(/\s+/).filter((x) => x && x !== "--headed");
        if (parts[0] === "playwright") {
          cmd = "npx";
          args = parts;
          label = run.label.replace(/\(headed\)/i, "(headless)");
        }
      } else {
        const filtered = args.filter((a) => a !== "--headed");
        if (filtered.length !== args.length) {
          args = filtered;
          label = run.label.replace(/\(headed\)/i, "(headless)");
        }
      }
    }
  }

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false, // kabuk YOK — argv olarak gecirilir
  });

  audit({
    event: "run",
    id: runId,
    label,
    argv: [cmd, ...args],
    params: params ?? null,
  });

  active = { id: runId, label, child, startedAt: Date.now(), lines: [] };
  broadcast("run-start", {
    id: runId,
    label,
    startedAt: active.startedAt,
    argv: [cmd, ...args].join(" "),
  });

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
    try {
      mergeHistory();
    } catch {
      /* rapor yoksa sessiz gec */
    }
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

function knownIssues() {
  const f = path.join(ROOT, "tests", "known-issues.ts");
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, "utf8");
  const out = [];
  const re =
    /id:\s*"([^"]+)"[\s\S]*?where:\s*"([^"]+)"[\s\S]*?detail:\s*\n?\s*"([^"]+)"/g;
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
      const html = fs
        .readFileSync(path.join(__dirname, "public", "index.html"), "utf8")
        .replace("__PANEL_TOKEN__", PANEL_TOKEN);
      return send(res, 200, html, "text/html; charset=utf-8");
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
          views: Object.entries(VIEWS).map(([id, v]) => ({
            id,
            label: v.label,
          })),
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
        active: active
          ? { id: active.id, label: active.label, startedAt: active.startedAt }
          : null,
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
    /**
     * Senaryo onerisi. Modele cagri yapar, bu yuzden token korumali ve denetim
     * kayitli. Senaryolar `suggestScenarios()` icindeki 3 katmanli kapidan gecer;
     * bu uc kapiyi KENDI basina uygulamiyor — kapi veri yolunda, cagri yolunda degil.
     * Yeni bir uc eklenirse de ayni fonksiyondan gecmek zorunda.
     */
    if (p === "/api/scenarios/suggest" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { request, limit } = await readBody(req);
      if (!request || !String(request).trim()) {
        return send(res, 400, { error: "request zorunlu" });
      }
      const lim = Math.min(Math.max(Number(limit) || 5, 1), 10);
      audit({
        event: "scenario-suggest",
        chars: String(request).length,
        limit: lim,
      });
      try {
        const out = await suggestScenarios({
          request: String(request),
          limit: lim,
        });
        audit({
          event: "scenario-suggest-result",
          accepted: out.audit.accepted,
          dropped: out.audit.droppedNoOracle.length,
          rejected: out.audit.rejectedByContext.length,
        });
        return send(res, 200, out);
      } catch (e) {
        audit({
          event: "scenario-suggest-error",
          code: e.code ?? null,
          message: e.message.slice(0, 200),
        });
        return send(res, e.code === "NO_CREDENTIALS" ? 428 : 502, {
          error: e.message,
          code: e.code ?? null,
        });
      }
    }

    /**
     * Perf olcumleri. `scripts/perf-sweep.mjs` cikitisini okur — veri zaten
     * diskte duruyordu ama gorunecek yer yoktu; iki yapisal bulgu (token x3,
     * menu cache'siz) terminalde python ile okunarak bulundu.
     */
    if (p === "/api/perf") {
      const dir = path.join(DATA_DIR, "perf");
      if (!fs.existsSync(dir))
        return send(res, 200, { routes: [], endpoints: [], measuredAt: null });
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== "_summary.json");
      const routes = [];
      const epMap = new Map();
      let measuredAt = null;
      for (const f of files) {
        let d;
        try {
          d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          continue;
        }
        if (!d.route) continue;
        if (!measuredAt || (d.measuredAt && d.measuredAt > measuredAt))
          measuredAt = d.measuredAt;
        // "Bizim API'miz hata dondu" filtresi: host'u profilin apiHostMatch'i
        // ile eslesenler. Profil vermemisse tum 4xx/5xx sayilir.
        const bad = (d.failed || []).filter(
          (x) => (!API_HOST_RE || API_HOST_RE.test(x.host || "")) && x.status >= 400,
        );
        routes.push({
          route: d.route,
          lcp: d.metrics?.lcpMs ?? null,
          load: d.metrics?.loadMs ?? null,
          ttfb: d.metrics?.ttfbMs ?? null,
          requests: d.requestCount ?? null,
          api: d.apiCount ?? null,
          notFound: !!d.metrics?.notFound,
          duplicates: (d.duplicates || []).length,
          siteErrors: bad.length,
          consoleErrors: (d.consoleErrors || []).length,
        });
        for (const e of d.endpoints || []) {
          const cur = epMap.get(e.endpoint) || {
            endpoint: e.endpoint,
            routes: 0,
            calls: 0,
            maxMs: 0,
            dupRoutes: 0,
          };
          cur.routes += 1;
          cur.calls += e.calls || 0;
          cur.maxMs = Math.max(cur.maxMs, e.maxMs || 0);
          if ((e.calls || 0) > 1) cur.dupRoutes += 1;
          epMap.set(e.endpoint, cur);
        }
      }
      routes.sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0));
      const endpoints = [...epMap.values()].sort((a, b) => b.maxMs - a.maxMs);
      return send(res, 200, {
        measuredAt,
        routes,
        endpoints,
        totals: {
          routes: routes.length,
          requests: routes.reduce((a, r) => a + (r.requests || 0), 0),
          api: routes.reduce((a, r) => a + (r.api || 0), 0),
          endpoints: endpoints.length,
          dupEndpoints: endpoints.filter((e) => e.dupRoutes > 0).length,
        },
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
      const checks = await preflight([gate]);
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

    /** Perf olcumunu modele yorumlatir. Kapi: uydurma rota gosteren bulgu elenir. */
    if (p === "/api/perf/analyze" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      let perf;
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/perf`);
        perf = await r.json();
      } catch (e) {
        return send(res, 500, { error: `perf verisi okunamadi: ${e.message}` });
      }
      audit({ event: "perf-analyze", routes: perf.routes?.length ?? 0 });
      try {
        const out = await analyzePerf(perf);
        audit({
          event: "perf-analyze-result",
          findings: out.findings.length,
          dropped: out.dropped.length,
        });
        return send(res, 200, out);
      } catch (e) {
        audit({
          event: "perf-analyze-error",
          code: e.code ?? null,
          message: e.message.slice(0, 200),
        });
        return send(res, e.code === "NO_CREDENTIALS" ? 428 : 502, {
          error: e.message,
          code: e.code ?? null,
        });
      }
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

    /** Modele ne gonderilecegini onizler — cagri YAPMAZ, token gerekmez. */
    if (p === "/api/scenarios/context") {
      const ctx = buildContext({
        limit: Number(url.searchParams.get("limit")) || 5,
      });
      return send(res, 200, {
        suites: ctx.suites.length,
        existingCases: ctx.existingCases.length,
        oracleSources: ctx.oracleSources,
        ready: ctx.oracleSources.length > 0,
        /*
         * Panel iki AYRI eksigi ONDEN soyler; kullanici tiklayip kriptik hata
         * gormesin:
         *   sdkReady  = @anthropic-ai/sdk kurulu mu (opsiyonel bagimlilik)
         *   authReady = kimlik var mi
         * Ikisi de senaryo onericiyi kapatir, panelin geri kalanini etkilemez.
         */
        sdkReady: await hasSdk(),
        sdkHint: (await hasSdk()) ? null : SDK_HINT,
        authReady: hasCredentials(),
        authHint: hasCredentials() ? null : AUTH_HINT,
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
      const r = startRun("draft", {
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
        return send(res, 200, saveVerdict(await readBody(req)));
      }
      return send(res, 200, allVerdicts());
    }

    if (p === "/api/specs") return send(res, 200, listSpecs());

    // Parametreli kosumun uretecegi komutu ONCE gosterir (calistirmaz)
    if (p === "/api/run/preview" && req.method === "POST") {
      const body = await readBody(req);
      const built = buildCustomArgs(body.params ?? {});
      return send(res, 200, {
        ok: !built.errors.length,
        errors: built.errors,
        command: ["npx", ...built.args].join(" "),
      });
    }

    if (p === "/api/run" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const { id, params, headless } = await readBody(req);
      return send(res, 200, startRun(id, params, Boolean(headless)));
    }

    if (p === "/api/stop" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      audit({ event: "stop", id: active?.id ?? null });
      return send(res, 200, stopRun());
    }

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
          res.write(
            `event: log\ndata: ${JSON.stringify({ stream: "out", line })}\n\n`,
          );
        }
      }
      req.on("close", () => sseClients.delete(res));
      return;
    }

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
    return send(res, 500, { error: String(e.message ?? e) });
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
