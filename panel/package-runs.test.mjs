/**
 * Paket koşum defteri — mapResultsToCases + kalıcılık.
 *   node --test panel/package-runs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-runs-"));
process.chdir(dir);
const { recordPackageRun, listPackageRuns, getPackageRun, mapResultsToCases, countCases } = await import("./package-runs.mjs");

const rows = [
  { file: "gen-a.spec.ts", title: "Anasayfa acilir", status: "passed", duration: 1200 },
  { file: "gen-a.spec.ts", title: "Arama calisir", status: "failed", duration: 900, error: "\x1b[2mTimeoutError:\x1b[22m locator\nsecond line" },
  { file: "gen-b.spec.ts", title: "Baska", status: "skipped", duration: 0 },
];

test("baslik birebir eslesirse o satir, yoksa spec ozeti", () => {
  const cases = [
    { nodeId: "n1", nodeName: "Ana", testCaseId: "tc1", title: "Anasayfa acilir", spec: "gen-a.spec.ts" },
    { nodeId: "n1", nodeName: "Ana", testCaseId: "tc2", title: "Arama calisir", spec: "gen-a.spec.ts" },
    { nodeId: "n1", nodeName: "Ana", testCaseId: "tc3", title: "Otomatik: gen-a.spec.ts", spec: "gen-a.spec.ts" },
  ];
  const out = mapResultsToCases(cases, rows);
  assert.equal(out[0].status, "✅");
  assert.equal(out[1].status, "❌");
  assert.equal(out[1].error, "TimeoutError: locator", "ANSI kodlari atilir, ilk satir kalir");
  assert.equal(out[1].error.includes("second line"), false, "hata ilk satira kirpilir");
  // ozet: spec'te dusen var → ❌
  assert.equal(out[2].status, "❌");
  assert.match(out[2].note, /1\/2 geçti/);
});

test("dugum spec'i uzerinden eslesme + spec'siz case atlanir + satirsiz spec kosum dustuyse uyari", () => {
  const cases = [
    { nodeId: "n2", nodeName: "B", testCaseId: "tc4", title: "Baska", spec: null, nodeSpecs: ["gen-b.spec.ts"] },
    { nodeId: "n3", nodeName: "C", testCaseId: "tc5", title: "Elle", spec: null, nodeSpecs: [] },
    { nodeId: "n4", nodeName: "D", testCaseId: "tc6", title: "Yok", spec: "gen-z.spec.ts" },
    { nodeId: "n9", testCaseId: "tcX", missing: true },
  ];
  const out = mapResultsToCases(cases, rows, { code: 1, errors: ["global-setup patladi"] });
  assert.equal(out[0].status, "⏭️");            // skipped
  assert.equal(out[1].status, "⏭️");
  assert.match(out[1].error, /elle/);
  assert.equal(out[2].status, "⚠️");
  assert.match(out[2].error, /global-setup/);
  assert.equal(out[3].status, "⚠️");
  assert.match(out[3].error, /kayıp/);
});

test("defter kalici: iki kosum ust uste yazilir, eskisi durur, filtre ve satirsiz liste calisir", () => {
  const a = recordPackageRun({ packageId: "p1", packageName: "Regresyon", mode: "auto", cases: mapResultsToCases(
    [{ nodeId: "n1", nodeName: "Ana", testCaseId: "tc1", title: "Anasayfa acilir", spec: "gen-a.spec.ts" }], rows) });
  const b = recordPackageRun({ packageId: "p2", packageName: "Duman", mode: "manual", cases: [
    { nodeId: "n1", nodeName: "Ana", testCaseId: "tc1", title: "Elle", status: "❌", note: "buton yok" },
  ] });
  assert.ok(a.id !== b.id);
  assert.deepEqual(a.counts, { total: 1, passed: 1, failed: 0, skipped: 0, warn: 0 });
  assert.equal(b.counts.failed, 1);

  const hepsi = listPackageRuns();
  assert.equal(hepsi.length, 2);
  assert.equal(hepsi[0].id, b.id, "yeniden eskiye");
  assert.equal(listPackageRuns({ packageId: "p1" }).length, 1);
  const kisa = listPackageRuns({ withCases: false })[0];
  assert.equal(kisa.cases, undefined);
  assert.equal(kisa.caseCount, 1);
  assert.equal(getPackageRun(a.id).cases[0].title, "Anasayfa acilir");
  assert.ok(fs.existsSync(path.join(dir, "panel-data", "package-runs.json")));
});

test("countCases sayimi", () => {
  assert.deepEqual(countCases([{ status: "✅" }, { status: "❌" }, { status: "⏭️" }, { status: "⚠️" }, {}]),
    { total: 5, passed: 1, failed: 1, skipped: 1, warn: 2 });
});
