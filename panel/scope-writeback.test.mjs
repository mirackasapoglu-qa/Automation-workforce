/*
 * ÇİFT YÖN yazma yolu — GERÇEK dosyaya yazarak ölçülür.
 *
 * `scope.mjs` ağacın yolunu `process.cwd()`'den kuruyor (import anında), yani
 * bu testler ayrı bir süreçte, GEÇİCİ bir çalışma dizininde koşar. Repo'daki
 * `panel-data/scope/tree.json`'a dokunulmaz — panelin kendi verisini test
 * kirletmemeli (aynı gerekçe `jira-sorters.test.mjs`'te de var).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCOPE = path.resolve(import.meta.dirname, "scope.mjs");
const BRIDGE = path.resolve(import.meta.dirname, "scope-bridge.mjs");

/** Geçici cwd'de bir ağaçla senaryo koşar, `sonuc` olarak basılanı döner. */
function calistir(tree, kod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-wb-"));
  fs.mkdirSync(path.join(dir, "panel-data", "scope"), { recursive: true });
  fs.writeFileSync(path.join(dir, "panel-data", "scope", "tree.json"), JSON.stringify(tree));
  const script = `
    const { applyRunResultsBySpecs, applyPerfToTree, applyManualRuns, readTree } = await import(${JSON.stringify(SCOPE)});
    const { deriveRoutes } = await import(${JSON.stringify(BRIDGE)});
    const sonuc = await (async () => { ${kod} })();
    console.log("<<<" + JSON.stringify({ sonuc, tree: readTree().tree }) + ">>>");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir, encoding: "utf8", env: { ...process.env, PANEL_PROJECT: "homee" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out.slice(out.indexOf("<<<") + 3, out.lastIndexOf(">>>")));
}

const dugum = (id, extra = {}) => ({
  id, name: id, type: "page", status: "⬜", notes: [], jiraTasks: [], resourceLinks: [],
  statusHistory: [], testCases: [], children: [], ...extra,
});

const AGAC = [dugum("kok", {
  type: "module",
  children: [
    dugum("n1", { runRef: { runId: "test-sepet", specs: ["06-cart.spec.ts"] }, route: "/sepet" }),
    dugum("n2", { runRef: { runId: "test-anasayfa", specs: ["01-homepage.spec.ts"] }, route: "/" }),
    dugum("n3", { route: "/baglantisiz" }),   // runRef YOK: kosum sonucu buraya yazilmamali
  ],
})];

const SONUC = {
  rows: [
    { file: "06-cart.spec.ts", title: "sepete ekle", status: "passed", duration: 4000 },
    { file: "06-cart.spec.ts", title: "sepeti bosalt", status: "failed", duration: 2000, error: "beklenen satir gelmedi" },
  ],
  counts: { passed: 1, failed: 1 },
};

test("kosum sonucu SADECE spec'e runRef ile bagli dugume yazilir", () => {
  const { sonuc, tree } = calistir(AGAC, `
    return applyRunResultsBySpecs({ results: ${JSON.stringify(SONUC)}, durationMs: 6000, code: 1 });
  `);
  assert.equal(sonuc.written, 1);
  assert.deepEqual(sonuc.nodes.map((n) => n.nodeId), ["n1"]);

  const cocuklar = tree[0].children;
  const n1 = cocuklar.find((n) => n.id === "n1");
  assert.equal(n1.testCases.length, 1);
  assert.equal(n1.testCases[0].spec, "06-cart.spec.ts");
  assert.equal(n1.testCases[0].automated, true);
  assert.equal(n1.testCases[0].runs.at(-1).status, "❌");   // bir satir dustu
  assert.match(n1.testCases[0].runs.at(-1).note, /1\/2 geçti/);

  // Bagli olmayan dugumlere HIC dokunulmadi — tahmine dayali eslemenin olmadigi olculuyor.
  assert.equal(cocuklar.find((n) => n.id === "n2").testCases.length, 0);
  assert.equal(cocuklar.find((n) => n.id === "n3").testCases.length, 0);
});

test("dugumun KENDI durumu degistirilmez (R19: karar insanin)", () => {
  const { tree } = calistir(AGAC, `
    return applyRunResultsBySpecs({ results: ${JSON.stringify(SONUC)}, durationMs: 6000, code: 1 });
  `);
  assert.equal(tree[0].children.find((n) => n.id === "n1").status, "⬜");
});

test("skipNodeId verilen dugume ikinci kez yazilmaz", () => {
  const { sonuc } = calistir(AGAC, `
    return applyRunResultsBySpecs({ results: ${JSON.stringify(SONUC)}, durationMs: 6000, code: 1, skipNodeId: "n1" });
  `);
  assert.equal(sonuc.written, 0);
  assert.deepEqual(sonuc.nodes, []);
});

test("sonucta hic satir yoksa agac HIC yazilmaz", () => {
  const { sonuc, tree } = calistir(AGAC, `
    return applyRunResultsBySpecs({ results: { rows: [] }, durationMs: 10, code: 0 });
  `);
  assert.equal(sonuc.written, 0);
  assert.equal(tree[0].children.find((n) => n.id === "n1").testCases.length, 0);
});

test("perf olcumu rota->dugum eslenip node.perf'e yazilir", () => {
  const perf = { measuredAt: "2026-09-14T10:00:00.000Z", routes: [
    { route: "/sepet", lcp: 4200, load: 5100, ttfb: 300, requests: 88, api: 9, siteErrors: 1, consoleErrors: 0 },
    { route: "/yok-boyle-bir-rota", lcp: 100 },
  ] };
  const { sonuc, tree } = calistir(AGAC, `
    return applyPerfToTree(${JSON.stringify(perf)}, (t) => deriveRoutes(t, { baseUrl: "https://site.test" }));
  `);
  assert.equal(sonuc.written, 1);
  const n1 = tree[0].children.find((n) => n.id === "n1");
  assert.equal(n1.perf.lcp, 4200);
  assert.equal(n1.perf.route, "/sepet");
  assert.equal(n1.perf.siteErrors, 1);
});

test("ayni perf olcumu ikinci kez yazilmaz (her sekme acilisinda /api/perf okunuyor)", () => {
  const perf = { measuredAt: "2026-09-14T10:00:00.000Z", routes: [{ route: "/sepet", lcp: 4200 }] };
  const { sonuc } = calistir(AGAC, `
    const p = ${JSON.stringify(perf)};
    const idx = (t) => deriveRoutes(t, { baseUrl: "https://site.test" });
    applyPerfToTree(p, idx);
    return applyPerfToTree(p, idx);
  `);
  assert.equal(sonuc.written, 0);
});

// ---------------- elle kosum kaydi ----------------

const CASELI = [dugum("kok", {
  type: "module",
  children: [dugum("n1", { testCases: [{ id: "tc1", title: "Elle case", steps: [], runs: [] }] })],
})];

test("elle kosum kaydi case'in runs[]'ine yazilir ve 'manual' isaretini tasir", () => {
  const { sonuc, tree } = calistir(CASELI, `
    return applyManualRuns({ entries: [{ nodeId: "n1", testCaseId: "tc1", status: "✅", note: "3 sn" }], label: "Regresyon" });
  `);
  assert.equal(sonuc.written, 1);
  const tc = tree[0].children[0].testCases[0];
  assert.equal(tc.runs.length, 1);
  assert.equal(tc.runs[0].status, "✅");
  assert.equal(tc.runs[0].by, "manual");
  assert.match(tc.runs[0].note, /Elle koşum · Regresyon/);
  assert.match(tc.runs[0].note, /3 sn/);
});

test("dugumun KENDI durumu elle kosumda da degismez (R19)", () => {
  const { tree } = calistir(CASELI, `
    return applyManualRuns({ entries: [{ nodeId: "n1", testCaseId: "tc1", status: "❌" }] });
  `);
  assert.equal(tree[0].children[0].status, "⬜");
});

test("gecersiz satir ATLANIR, gecerliler yazilir (tek bozuk satir kosumu comp etmez)", () => {
  const { sonuc, tree } = calistir(CASELI, `
    return applyManualRuns({ entries: [
      { nodeId: "yok", testCaseId: "tc1", status: "✅" },
      { nodeId: "n1", testCaseId: "yok", status: "✅" },
      { nodeId: "n1", testCaseId: "tc1", status: "gecti" },
      { nodeId: "n1", testCaseId: "tc1", status: "⚠️" },
    ] });
  `);
  assert.equal(sonuc.written, 1);
  assert.equal(sonuc.results.filter((r) => r.error).length, 3);
  assert.equal(tree[0].children[0].testCases[0].runs.length, 1);
});

test("bos giris agaci HIC yazmaz", () => {
  const { sonuc, tree } = calistir(CASELI, `return applyManualRuns({ entries: [] });`);
  assert.equal(sonuc.written, 0);
  assert.equal(tree[0].children[0].testCases[0].runs.length, 0);
});
