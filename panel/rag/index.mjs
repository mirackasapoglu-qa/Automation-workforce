/**
 * RAG v1 — repo bağlam indeksi (BM25, tek JSON dosyası, sıfır bağımlılık).
 *
 * NEDEN BU KADAR: model "repoyu bilsin" diye üç seçenek vardı — (a) her
 * isteme tüm CLAUDE.md'yi gömmek (~20k token, her çağrıda), (b) embedding +
 * vektör DB (ikinci sağlayıcı, ikinci anahtar, yeni servis), (c) sözcük
 * tabanlı indeks. Corpus ~300 KB (spec + POM + ölçülmüş kurallar + kapsam
 * ağacı); (c) milisaniyede arar, tek dosyada durur, anahtar istemez. Embedding
 * ancak ÖLÇÜM (gate'ten geçme oranı, uydurma seçici sayısı) açığı gösterirse
 * gelir — o karar bu dosyanın değil, karşılaştırma tablosunun.
 *
 * NE İNDEKSLENİR (kök = process.cwd()):
 *   tests/*.ts · pages/*.ts · global-setup.ts · playwright.config.ts
 *   *.md (kök) · docs/*.md · panel/runs.json (koşum ipuçları)
 *   panel-data/scope/tree.json (kapsam ağacı düğümleri)
 *   graphify-out/graph.json (VARSA — yalnızca dosya komşuluğu; metin değil)
 *
 * PARÇALAMA: markdown başlık sınırlarında, kod `test(`/method sınırlarında,
 * ≤ ~1600 karakter. Her parça dosya:satır taşır — istemde kaynak gösterilir,
 * model "nereden biliyorsun" sorusuna cevap verebilir.
 *
 * BAYATLIK: indeks kaynak mtime'larını saklar; `ensureIndex()` her çağrıda
 * ucuz bir stat turu yapar, değişen varsa yeniden kurar (~100 ms). Sunucuda
 * volume'daki eski indeks yeni imajla sessizce çelişmez.
 */
import fs from "node:fs";
import path from "node:path";
import { tokenize, termFreq } from "./text.mjs";
import { redactText, secretValuesFromEnv } from "./redact.mjs";

/** v2: parçalar maskeleniyor (gizli veri); v1 indeks bayat sayılır ve yeniden kurulur. */
export const VERSION = 2;
const MAX_CHUNK = 1600;

export const indexFile = (root = process.cwd()) => path.join(root, "panel-data", "rag", "index.json");

const rel = (root, abs) => path.relative(root, abs).split(path.sep).join("/");
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const listDir = (dir, re) => {
  try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)); }
  catch { return []; }
};

/** Corpus dosyaları (var olanlar). */
export function corpusFiles(root = process.cwd()) {
  const out = [];
  const add = (abs, kind) => { if (exists(abs)) out.push({ abs, file: rel(root, abs), kind }); };
  for (const f of listDir(path.join(root, "tests"), /\.ts$/)) add(f, "code");
  for (const f of listDir(path.join(root, "pages"), /\.ts$/)) add(f, "code");
  add(path.join(root, "global-setup.ts"), "code");
  add(path.join(root, "playwright.config.ts"), "code");
  for (const f of listDir(root, /^[^.].*\.md$/i)) add(f, "md");
  for (const f of listDir(path.join(root, "docs"), /\.md$/i)) add(f, "md");
  add(path.join(root, "panel", "runs.json"), "runs");
  add(path.join(root, "panel-data", "scope", "tree.json"), "scope");
  add(path.join(root, "graphify-out", "graph.json"), "graph");
  return out;
}

// ---------------------------------------------------------------- parçalayıcılar

export function chunkMarkdown(file, text) {
  const lines = text.split("\n");
  const chunks = [];
  const trail = [];
  let buf = [];
  let bufStart = 1;
  let bufLen = 0;
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body.length >= 40) chunks.push({ file, line: bufStart, title: trail.join(" › ") || path.basename(file), text: body.slice(0, MAX_CHUNK) });
    buf = []; bufLen = 0;
  };
  lines.forEach((ln, i) => {
    const h = /^(#{1,3})\s+(.+)/.exec(ln);
    if (h) {
      flush();
      const level = h[1].length;
      trail.length = Math.max(0, level - 1);
      trail[level - 1] = h[2].trim();
      bufStart = i + 2;
      return;
    }
    if (buf.length === 0) {
      if (ln.trim() === "") return; // bos satirla baslama: satir numarasi icerigi gostersin
      bufStart = i + 1;
    }
    if (bufLen + ln.length > MAX_CHUNK && ln.trim() === "") { flush(); return; }
    if (bufLen + ln.length > MAX_CHUNK * 1.5) { flush(); bufStart = i + 1; }
    buf.push(ln); bufLen += ln.length + 1;
  });
  flush();
  return chunks;
}

const CODE_BOUNDARY = /^\s{0,2}(test\(|test\.describe|describe\(|export\s|class\s|function\s|async\s|const\s|readonly\s|private\s|public\s|protected\s|get\s|static\s)|^\s{2}(async\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$/;

export function chunkCode(file, text) {
  const lines = text.split("\n");
  const chunks = [];
  let buf = [];
  let bufStart = 1;
  let bufLen = 0;
  const flush = () => {
    const body = buf.join("\n").replace(/\s+$/, "");
    if (body.trim().length >= 40) {
      const first = buf.find((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l)) ?? buf[0] ?? "";
      chunks.push({ file, line: bufStart, title: `${path.basename(file)} · ${first.trim().slice(0, 90)}`, text: body.slice(0, MAX_CHUNK) });
    }
    buf = []; bufLen = 0;
  };
  lines.forEach((ln, i) => {
    if (buf.length && bufLen > MAX_CHUNK * 0.6 && CODE_BOUNDARY.test(ln)) { flush(); bufStart = i + 1; }
    else if (bufLen > MAX_CHUNK * 1.4) { flush(); bufStart = i + 1; }
    if (buf.length === 0) bufStart = i + 1;
    buf.push(ln); bufLen += ln.length + 1;
  });
  flush();
  return chunks;
}

export function chunkRuns(file, json) {
  const runs = json?.runs ?? {};
  return Object.entries(runs).map(([id, r]) => ({
    file, line: 1, title: `koşum ${id}`,
    text: [`Koşum: ${id} — ${r.label ?? ""}`, r.tip ?? "", `komut: ${[r.cmd, ...(r.args ?? [])].join(" ")}`].filter(Boolean).join("\n"),
  }));
}

export function chunkScopeTree(file, json) {
  const tree = Array.isArray(json) ? json : json?.tree ?? [];
  const out = [];
  const walk = (nodes, trail) => {
    for (const n of nodes ?? []) {
      const yol = [...trail, n.name];
      const lines = [`Kapsam düğümü: ${yol.join(" › ")}`, `Tür: ${n.type ?? "?"} · Durum: ${n.status ?? "⬜"} · id ${n.id}`];
      const links = (n.resourceLinks ?? []).map((r) => `${r.type ?? "link"}: ${r.url ?? r.title ?? ""}`).filter(Boolean);
      if (links.length) lines.push(`Kaynaklar: ${links.join(" · ")}`);
      const jira = (n.jiraTasks ?? []).map((t) => t.taskId).filter(Boolean);
      if (jira.length) lines.push(`Bağlı kartlar: ${jira.join(", ")}`);
      if (n.runRef?.specs?.length) lines.push(`Otomatik spec: ${n.runRef.specs.join(", ")}`);
      const notes = (n.notes ?? []).map((x) => (typeof x === "string" ? x : x.text ?? "")).filter(Boolean);
      if (notes.length) lines.push(`Notlar: ${notes.join(" | ").slice(0, 500)}`);
      const cases = (n.testCases ?? []).slice(0, 12).map((tc) => {
        const steps = (tc.steps ?? []).slice(0, 4).map((s) => `${s.action} → ${s.expected}`).join("; ");
        return `- ${tc.title}${tc.status ? ` [${tc.status}]` : ""}${steps ? `: ${steps}` : ""}`;
      });
      if (cases.length) lines.push(`Test case'leri:\n${cases.join("\n")}`);
      out.push({ file, line: 1, title: `kapsam · ${yol.join(" › ")}`, text: lines.join("\n").slice(0, MAX_CHUNK), nodeId: n.id });
      walk(n.children, yol);
    }
  };
  walk(tree, []);
  return out;
}

/** graphify grafından dosya komşuluğu: {file: [file, ...]} (en çok 12). */
export function graphNeighbors(graph) {
  const nodeFile = new Map();
  for (const n of graph?.nodes ?? []) if (n.id && n.source_file) nodeFile.set(n.id, String(n.source_file).replace(/\\/g, "/"));
  const nb = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    if (!nb.has(a)) nb.set(a, new Map());
    const m = nb.get(a); m.set(b, (m.get(b) || 0) + 1);
  };
  for (const e of graph?.links ?? graph?.edges ?? []) {
    const fa = nodeFile.get(e.source), fb = nodeFile.get(e.target);
    link(fa, fb); link(fb, fa);
  }
  const out = {};
  for (const [f, m] of nb) out[f] = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);
  return out;
}

// ---------------------------------------------------------------- kurulum

/** Corpus'u okur, parçalar, BM25 tablolarını kurar. Diske YAZMAZ. */
export function buildIndex({ root = process.cwd() } = {}) {
  const sources = [];
  const chunks = [];
  let graph = null;
  for (const src of corpusFiles(root)) {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(src.abs).mtimeMs; } catch { continue; }
    let produced = [];
    try {
      const raw = fs.readFileSync(src.abs, "utf8");
      if (src.kind === "md") produced = chunkMarkdown(src.file, raw);
      else if (src.kind === "code") produced = chunkCode(src.file, raw);
      else if (src.kind === "runs") produced = chunkRuns(src.file, JSON.parse(raw));
      else if (src.kind === "scope") produced = chunkScopeTree(src.file, JSON.parse(raw));
      else if (src.kind === "graph") { graph = graphNeighbors(JSON.parse(raw)); produced = []; }
    } catch { produced = []; }
    sources.push({ file: src.file, kind: src.kind, mtimeMs, chunks: produced.length });
    chunks.push(...produced);
  }

  /*
   * MASKELEME — indekse yazılmadan ÖNCE. Ortamdaki gizli değerler (kapı
   * şifresi gibi) + bilinen token kalıpları + `X_PASSWORD=...` satırları.
   * Ölçüldü 2026-09-08: CLAUDE.md'deki kapı şifresi indekse girip
   * `/api/rag/search`ten dönüyordu. Sorgu zamanında değil kurulumda
   * maskeleniyor ki diskteki dosya da temiz olsun.
   */
  const secrets = secretValuesFromEnv();
  let redactions = 0;
  for (const c of chunks) {
    const t = redactText(c.text, { values: secrets });
    const h = redactText(c.title, { values: secrets });
    c.text = t.text;
    c.title = h.text;
    redactions += t.redactions + h.redactions;
  }

  const postings = Object.create(null);
  const lens = new Array(chunks.length);
  let total = 0;
  chunks.forEach((c, i) => {
    c.id = `c${i}`;
    const toks = tokenize(`${c.title}\n${c.text}`);
    lens[i] = toks.length;
    total += toks.length;
    for (const [t, tf] of Object.entries(termFreq(toks))) {
      (postings[t] ??= []).push([i, tf]);
    }
  });

  return {
    version: VERSION,
    builtAt: new Date().toISOString(),
    root: path.basename(root),
    sources,
    chunks,
    lens,
    avgLen: chunks.length ? total / chunks.length : 0,
    postings,
    graph,
    redactions,
  };
}

export function saveIndex(index, root = process.cwd()) {
  const f = indexFile(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, f);
  return f;
}

let cache = { mtimeMs: 0, index: null, checkedAt: 0 };

export function loadIndex(root = process.cwd()) {
  const f = indexFile(root);
  let st;
  try { st = fs.statSync(f); } catch { return null; }
  if (cache.index && cache.mtimeMs === st.mtimeMs) return cache.index;
  try {
    const index = JSON.parse(fs.readFileSync(f, "utf8"));
    if (index?.version !== VERSION) return null;
    cache = { mtimeMs: st.mtimeMs, index, checkedAt: Date.now() };
    return index;
  } catch { return null; }
}

/** Kaynaklardan biri değişti/eklendi/silindi mi. */
export function isStale(index, root = process.cwd()) {
  if (!index) return true;
  const now = corpusFiles(root);
  if (now.length !== index.sources.length) return true;
  const known = new Map(index.sources.map((s) => [s.file, s.mtimeMs]));
  for (const f of now) {
    const m = known.get(f.file);
    if (m == null) return true;
    let cur = 0;
    try { cur = fs.statSync(f.abs).mtimeMs; } catch { return true; }
    if (Math.abs(cur - m) > 1) return true;
  }
  return false;
}

/**
 * Güncel indeksi verir; yoksa/bayatsa kurup yazar. Stat turu 10 sn'de bir
 * (her istemde 40 stat gereksiz). Kurulum hatası çağıranı düşürmez: null.
 */
export function ensureIndex({ root = process.cwd(), force = false } = {}) {
  let index = loadIndex(root);
  const recentlyChecked = Date.now() - cache.checkedAt < 10_000;
  if (!force && index && recentlyChecked) return index;
  if (!force && index && !isStale(index, root)) { cache.checkedAt = Date.now(); return index; }
  try {
    index = buildIndex({ root });
    saveIndex(index, root);
    const st = fs.statSync(indexFile(root));
    cache = { mtimeMs: st.mtimeMs, index, checkedAt: Date.now() };
    return index;
  } catch {
    return index ?? null;
  }
}

/** Özet (uçlar ve CLI için). */
export function stats(index) {
  if (!index) return null;
  return {
    builtAt: index.builtAt,
    chunks: index.chunks.length,
    terms: Object.keys(index.postings).length,
    sources: index.sources.length,
    byKind: index.sources.reduce((a, s) => { a[s.kind] = (a[s.kind] || 0) + s.chunks; return a; }, {}),
    graph: index.graph ? Object.keys(index.graph).length : 0,
    redactions: index.redactions ?? 0,
  };
}
