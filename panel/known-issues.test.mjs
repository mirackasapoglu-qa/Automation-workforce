// known-issues.mjs — server.mjs'ten çıkarılan ayrıştırıcı. Gerçek dosyaya
// dokunmadan test edilsin diye `filePath` enjekte edilebiliyor; kaçışlı
// tırnak durumları (server.mjs'teki HOMEE-001/HOMEE-010 hatalarının kaynağı)
// burada kasıtlı olarak tekrar sınanıyor.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { knownIssues, knownIssuesForNode } from "./known-issues.mjs";

function fixture(src) {
  const f = path.join(os.tmpdir(), `known-issues-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(f, src, "utf8");
  return f;
}

const FIXTURE_SRC = `export const KNOWN_ISSUES = [
  {
    id: "TEST-001",
    where: "/test-route",
    detail: 'İçinde "çift tırnak" geçen mesaj, tek tırnakla yazılmış.',
    nodeId: "n1",
  },
  {
    id: "TEST-002",
    where: "/other-route",
    detail: "Kaçışlı \\"çift tırnak\\" içeren mesaj.",
    nodeId: "n2",
  },
  {
    id: "TEST-003",
    where: "/no-node",
    detail: "nodeId'si olmayan kayıt.",
  },
];
`;

test("knownIssues: kaçışsız tek tırnaklı detail'i doğru okur (eski regex burada HOMEE-001'i kaybediyordu)", () => {
  const f = fixture(FIXTURE_SRC);
  const list = knownIssues(f);
  const r1 = list.find((k) => k.id === "TEST-001");
  assert.equal(r1.detail, 'İçinde "çift tırnak" geçen mesaj, tek tırnakla yazılmış.');
  assert.equal(r1.where, "/test-route");
  assert.equal(r1.nodeId, "n1");
  fs.unlinkSync(f);
});

test("knownIssues: kaçışlı çift tırnaklı detail'i doğru okur (eski regex burada HOMEE-010'u kesiyordu)", () => {
  const f = fixture(FIXTURE_SRC);
  const r2 = knownIssues(f).find((k) => k.id === "TEST-002");
  assert.equal(r2.detail, 'Kaçışlı "çift tırnak" içeren mesaj.');
  assert.equal(r2.nodeId, "n2");
  fs.unlinkSync(f);
});

test("knownIssues: kayıtlar birbirine karışmıyor (3 kayıt, 3 sonuç)", () => {
  const f = fixture(FIXTURE_SRC);
  assert.equal(knownIssues(f).length, 3);
  fs.unlinkSync(f);
});

test("knownIssues: nodeId'si olmayan kayıt null döner, düşürülmez", () => {
  const f = fixture(FIXTURE_SRC);
  const r3 = knownIssues(f).find((k) => k.id === "TEST-003");
  assert.equal(r3.nodeId, null);
  fs.unlinkSync(f);
});

test("knownIssues: dosya yoksa boş dizi döner, patlamaz", () => {
  assert.deepEqual(knownIssues("/kesinlikle/olmayan/bir/dosya.ts"), []);
});

test("knownIssuesForNode: yalnızca eşleşen nodeId'yi döner", () => {
  const f = fixture(FIXTURE_SRC);
  const forN1 = knownIssuesForNode("n1", f);
  assert.equal(forN1.length, 1);
  assert.equal(forN1[0].id, "TEST-001");
  fs.unlinkSync(f);
});

test("knownIssuesForNode: eşleşme yoksa boş dizi", () => {
  const f = fixture(FIXTURE_SRC);
  assert.deepEqual(knownIssuesForNode("hic-yok", f), []);
  fs.unlinkSync(f);
});

test("knownIssuesForNode: nodeId verilmezse boş dizi (dosyayı hiç okumaz)", () => {
  assert.deepEqual(knownIssuesForNode(null), []);
  assert.deepEqual(knownIssuesForNode(undefined), []);
});
