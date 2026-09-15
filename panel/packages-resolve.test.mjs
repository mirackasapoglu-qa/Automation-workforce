/*
 * `resolvePackageItems` — paketin ETKİN case referansları (iç içe paketler dahil).
 *
 * Panelin "Koşumlar" sekmesi paketi bununla spec listesine çeviriyor; yanlış
 * çözüm ya eksik koşum ya da sonsuz özyineleme demek. Saf fonksiyon: diske
 * dokunmaz, paket listesi parametre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePackageItems } from "./packages.mjs";

const tc = (nodeId, testCaseId) => ({ nodeId, testCaseId });

test("duz paket: case referanslari sirasiyla doner", () => {
  const p = [{ id: "p1", name: "A", items: [tc("n1", "tc1"), tc("n2", "tc2")] }];
  assert.deepEqual(resolvePackageItems(p, "p1"), [tc("n1", "tc1"), tc("n2", "tc2")]);
});

test("ic ice paket duzlestirilir", () => {
  const p = [
    { id: "p1", name: "Ust", items: [tc("n1", "tc1"), { packageId: "p2" }] },
    { id: "p2", name: "Alt", items: [tc("n2", "tc2")] },
  ];
  assert.deepEqual(resolvePackageItems(p, "p1"), [tc("n1", "tc1"), tc("n2", "tc2")]);
});

test("ayni case iki yoldan gelirse TEK sayilir", () => {
  const p = [
    { id: "p1", name: "Ust", items: [tc("n1", "tc1"), { packageId: "p2" }] },
    { id: "p2", name: "Alt", items: [tc("n1", "tc1"), tc("n2", "tc2")] },
  ];
  assert.deepEqual(resolvePackageItems(p, "p1"), [tc("n1", "tc1"), tc("n2", "tc2")]);
});

test("CEVRIM sonsuz ozyinelemeye dusurmez", () => {
  const p = [
    { id: "p1", name: "A", items: [tc("n1", "tc1"), { packageId: "p2" }] },
    { id: "p2", name: "B", items: [tc("n2", "tc2"), { packageId: "p1" }] },
  ];
  assert.deepEqual(resolvePackageItems(p, "p1"), [tc("n1", "tc1"), tc("n2", "tc2")]);
  assert.deepEqual(resolvePackageItems(p, "p2"), [tc("n2", "tc2"), tc("n1", "tc1")]);
});

test("olmayan paket bos doner (hata firlatmaz)", () => {
  assert.deepEqual(resolvePackageItems([], "yok"), []);
  assert.deepEqual(resolvePackageItems([{ id: "p1", items: [{ packageId: "yok" }] }], "p1"), []);
});

test("bozuk item'lar atlanir", () => {
  const p = [{ id: "p1", items: [null, {}, { nodeId: "n1" }, tc("n2", "tc2")] }];
  assert.deepEqual(resolvePackageItems(p, "p1"), [tc("n2", "tc2")]);
});
