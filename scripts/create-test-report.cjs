#!/usr/bin/env node
/**
 * Homee QA — koşum raporu üreticisi.
 *
 * NadirGold'daki sürüm koşum log'unu regex ile parse ediyordu; burada Playwright'ın
 * JSON reporter çıktısını (test-results/results.json) okuyoruz — kırılgan değil.
 *
 * Kullanım: node scripts/create-test-report.cjs [--out homee-report.html]
 */
const fs = require("fs");
const path = require("path");

const RESULTS = path.join(process.cwd(), "test-results", "results.json");
const outArgIdx = process.argv.indexOf("--out");
const OUT = outArgIdx > -1 ? process.argv[outArgIdx + 1] : "homee-test-report.html";

if (!fs.existsSync(RESULTS)) {
  console.error(`HATA: ${RESULTS} yok. Önce testleri koş: npm test`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(RESULTS, "utf8"));

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

const rows = [];
function walk(suite, filePath) {
  const file = suite.file || filePath;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.[t.results.length - 1] ?? {};
      rows.push({
        file: (file || "").replace(/^tests\//, ""),
        title: spec.title,
        status: last.status ?? "unknown",
        duration: last.duration ?? 0,
        retries: (t.results?.length ?? 1) - 1,
        error: (last.error?.message ?? "")
          .replace(ANSI, "")
          .split("\n")
          .slice(0, 6)
          .join("\n"),
        annotations: (t.annotations ?? []).map(
          (a) => `${a.type}${a.description ? ": " + a.description : ""}`,
        ),
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, file);
}
for (const s of raw.suites ?? []) walk(s, s.file);

const total = rows.length;
const passed = rows.filter((r) => r.status === "passed").length;
const failed = rows.filter((r) => r.status === "failed" || r.status === "timedOut").length;
const skipped = rows.filter((r) => r.status === "skipped").length;
const flaky = rows.filter((r) => r.retries > 0 && r.status === "passed").length;
const durationMs = rows.reduce((a, r) => a + r.duration, 0);
const env = process.env.HOMEE_ENV ?? "test";
const baseURL = process.env[`BASE_URL_${env.toUpperCase()}`] ?? "";
const startedAt = raw.stats?.startTime ? new Date(raw.stats.startTime) : new Date();

const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const byFile = {};
for (const r of rows) (byFile[r.file] ??= []).push(r);

const badge = (s) =>
  s === "passed"
    ? '<span class="b ok">GECTI</span>'
    : s === "skipped"
      ? '<span class="b sk">ATLANDI</span>'
      : `<span class="b no">${s === "timedOut" ? "TIMEOUT" : "BASARISIZ"}</span>`;

const failedRows = rows.filter((r) => r.status !== "passed" && r.status !== "skipped");

const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homee QA Kosum Raporu</title>
<style>
  :root { --bg:#fff; --fg:#1a1a1a; --mut:#6b7280; --line:#e5e7eb; --ok:#0f766e; --no:#b91c1c; --sk:#92400e; --card:#f9fafb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111214; --fg:#e8e8e8; --mut:#9ca3af; --line:#2a2c31; --ok:#34d399; --no:#f87171; --sk:#fbbf24; --card:#191b1f; } }
  * { box-sizing:border-box }
  body { margin:0; padding:32px 20px; background:var(--bg); color:var(--fg);
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1080px; margin:0 auto }
  h1 { font-size:24px; margin:0 0 4px } h2 { font-size:17px; margin:32px 0 10px }
  h3 { font-size:14px; margin:22px 0 6px }
  .sub { color:var(--mut); font-size:13px; margin-bottom:24px }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin:20px 0 }
  .c { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px }
  .c .n { font-size:26px; font-weight:650; line-height:1 } .c .l { color:var(--mut); font-size:12px; margin-top:6px }
  table { width:100%; border-collapse:collapse; font-size:13.5px }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top }
  th { color:var(--mut); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em }
  .b { font-size:11px; font-weight:700; padding:2px 7px; border-radius:5px; white-space:nowrap }
  .ok { color:var(--ok) } .no { color:var(--no) } .sk { color:var(--sk) }
  pre { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px;
        overflow-x:auto; font-size:12px; margin:6px 0 0; white-space:pre-wrap }
  .file { font-family:ui-monospace,SFMono-Regular,monospace; font-size:12.5px; color:var(--mut) }
  .scroll { overflow-x:auto }
</style></head><body><div class="wrap">
<h1>Homee QA Kosum Raporu</h1>
<div class="sub">${startedAt.toLocaleString("tr-TR")} &middot; ortam <b>${esc(env)}</b> &middot; ${esc(baseURL)}</div>

<div class="cards">
  <div class="c"><div class="n">${total}</div><div class="l">Toplam test</div></div>
  <div class="c"><div class="n" style="color:var(--ok)">${passed}</div><div class="l">Gecti</div></div>
  <div class="c"><div class="n" style="color:var(--no)">${failed}</div><div class="l">Basarisiz</div></div>
  <div class="c"><div class="n" style="color:var(--sk)">${skipped}</div><div class="l">Atlandi</div></div>
  <div class="c"><div class="n">${flaky}</div><div class="l">Flaky (retry ile gecti)</div></div>
  <div class="c"><div class="n">${fmtMs(durationMs)}</div><div class="l">Toplam sure</div></div>
</div>

${
  failed
    ? `<h2>Basarisiz testler</h2><div class="scroll"><table>
<tr><th>Spec</th><th>Test</th><th>Hata</th></tr>
${failedRows
  .map(
    (r) => `<tr>
  <td class="file">${esc(r.file)}</td><td>${esc(r.title)}</td><td><pre>${esc(r.error || "-")}</pre></td>
</tr>`,
  )
  .join("")}
</table></div>`
    : "<h2>Basarisiz test yok</h2>"
}

<h2>Spec bazinda detay</h2>
${Object.entries(byFile)
  .map(
    ([file, list]) => `
<h3 class="file">${esc(file)} <span class="b ${list.every((r) => r.status === "passed") ? "ok" : "no"}">${list.filter((r) => r.status === "passed").length}/${list.length}</span></h3>
<div class="scroll"><table>
<tr><th>Durum</th><th>Test</th><th>Sure</th><th>Retry</th></tr>
${list
  .map(
    (r) =>
      `<tr><td>${badge(r.status)}</td><td>${esc(r.title)}${
        r.annotations.length ? `<br><span class="file">${esc(r.annotations.join(" | "))}</span>` : ""
      }</td><td>${fmtMs(r.duration)}</td><td>${r.retries || "-"}</td></tr>`,
  )
  .join("")}
</table></div>`,
  )
  .join("")}

<h2>Notlar</h2>
<ul>
  <li>Kosum <code>workers: 1</code> ile sirali yapilir - paralel yok.</li>
  <li>Uye testleri her test icin ayri UI login yapar (Homee refresh-token'i rotate ettigi icin storageState paylasilamiyor).</li>
  <li>Siparis tamamlama <code>ALLOW_HOMEE_ORDERS=1</code> olmadan kosmaz; bu raporda odeme adimina kadar test edilmistir.</li>
</ul>
</div></body></html>`;

fs.writeFileSync(OUT, html, "utf8");
console.log(`Rapor yazildi: ${OUT}`);
console.log(
  `${passed}/${total} gecti, ${failed} basarisiz, ${skipped} atlandi, ${fmtMs(durationMs)}`,
);
