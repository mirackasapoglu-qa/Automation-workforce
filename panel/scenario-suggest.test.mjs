/**
 * Kapı testleri — API'ye çağrı YAPMAZ, uydurma model çıktılarını kapıdan geçirir.
 * Koşum: node --test panel/scenario-suggest.test.mjs
 *
 * Bu testlerin varlık sebebi: istem modeli ikna eder, kapıyı kod tutar.
 * Kapı bir gün delinirse burası kırmızıya döner.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gate, filterOutput, validate, assertClean, buildContext } from "./scenario-suggest.mjs";

const CTX = {
  slug: "test",
  limit: 3,
  suites: [
    { suiteId: "01-homepage", title: "01", layer: "guest" },
    { suiteId: "20-login", title: "20", layer: "member" },
  ],
  existingCases: ["anasayfa yüklenir"],
  oracleSources: [{ ref: "HOMEE-001", kind: "known-issue" }, { ref: "MAC-7037", kind: "jira" }],
};

const good = (over = {}) => ({
  suiteId: "01-homepage",
  caseId: "gecerli-senaryo",
  title: "geçerli senaryo",
  oracleRef: "HOMEE-001",
  tags: ["regression"],
  steps: ["adım 1"],
  rationale: "gerekçe",
  ...over,
});

test("gecerli senaryo kabul edilir", () => {
  const r = gate([good()], CTX);
  assert.equal(r.scenarios.length, 1);
  assert.equal(r.audit.accepted, 1);
});

test("bos oracleRef katman 2'de elenir", () => {
  const r = gate([good({ oracleRef: "" }), good({ caseId: "b", oracleRef: "   " })], CTX);
  assert.equal(r.scenarios.length, 0);
  assert.equal(r.audit.droppedNoOracle.length, 2);
});

test("kacamakli oracleRef elenir", () => {
  for (const ref of ["N/A", "yok", "TBD", "-", "bilinmiyor", "?"]) {
    const r = gate([good({ oracleRef: ref })], CTX);
    assert.equal(r.scenarios.length, 0, `kacamak gecti: ${ref}`);
  }
});

test("UYDURMA oracleRef katman 3'te reddedilir", () => {
  const r = gate([good({ oracleRef: "REQ-9999" }), good({ caseId: "b", oracleRef: "MAC-0000" })], CTX);
  assert.equal(r.scenarios.length, 0);
  assert.equal(r.audit.rejectedByContext.length, 2);
  assert.match(r.audit.rejectedByContext[0].reasons.join(), /bilinen kaynak degil/);
});

test("oracleRef alt bolum eki kabul edilir (KAYNAK#bolum)", () => {
  const r = gate([good({ oracleRef: "MAC-7037#kabul-kriteri-2" })], CTX);
  assert.equal(r.scenarios.length, 1);
});

test("baglamda olmayan suiteId reddedilir", () => {
  const r = gate([good({ suiteId: "99-uydurma" })], CTX);
  assert.equal(r.scenarios.length, 0);
  assert.match(r.audit.rejectedByContext[0].reasons.join(), /suiteId baglamda yok/);
});

test("kebab-case olmayan caseId reddedilir", () => {
  for (const id of ["CamelCase", "boslukli id", "alt_cizgi", "-bas", "son-"]) {
    const r = gate([good({ caseId: id })], CTX);
    assert.equal(r.scenarios.length, 0, `kebab ihlali gecti: ${id}`);
  }
});

test("tekrar eden caseId reddedilir", () => {
  const r = gate([good(), good()], CTX);
  assert.equal(r.scenarios.length, 1);
  assert.equal(r.audit.rejectedByContext.length, 1);
});

test("var olan senaryonun tekrari reddedilir", () => {
  const r = gate([good({ title: "Anasayfa Yüklenir" })], CTX);
  assert.equal(r.scenarios.length, 0);
  assert.match(r.audit.rejectedByContext[0].reasons.join(), /var olan senaryo tekrari/);
});

test("bos steps reddedilir", () => {
  const r = gate([good({ steps: [] })], CTX);
  assert.equal(r.scenarios.length, 0);
});

test("limit asilirsa kirpilir", () => {
  const many = [1, 2, 3, 4, 5].map((i) => good({ caseId: `senaryo-${i}` }));
  const r = gate(many, CTX);
  assert.equal(r.scenarios.length, 3);
  assert.equal(r.audit.trimmedByLimit, 2);
});

test("katman 4 dogrudan cagrilirsa PATLAR (kapi deligi tespiti)", () => {
  assert.throws(() => assertClean([good({ oracleRef: "UYDURMA-1" })], CTX), /KAPI IHLALI/);
  assert.throws(() => assertClean([good({ oracleRef: "" })], CTX), /KAPI IHLALI/);
});

test("null/undefined girdi cokmeye yol acmaz", () => {
  for (const bad of [null, undefined, []]) {
    const r = gate(bad, CTX);
    assert.equal(r.scenarios.length, 0);
  }
});

test("gercek repo baglami dayanak kaynagi iceriyor", () => {
  const ctx = buildContext({ limit: 5 });
  assert.ok(ctx.suites.length > 0, "paket bulunamadi");
  assert.ok(ctx.oracleSources.length > 0, "dayanak kaynagi bulunamadi");
  assert.ok(ctx.oracleSources.some((o) => /^HOMEE-\d+$/.test(o.ref)), "HOMEE kaydi yok");
  assert.ok(ctx.oracleSources.some((o) => /^MAC-\d+$/.test(o.ref)), "Jira karti yok");
});
