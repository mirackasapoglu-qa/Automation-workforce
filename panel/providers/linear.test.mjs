// Linear sağlayıcısının saf çeviri fonksiyonları — gerçek bir Linear hesabına
// karşı DENENMEDİ (bu depoda kimlik yok). Alan adları resmi Linear geliştirici
// dokümanından doğrulandı (linear.app/developers/filtering, 2026-09-12); burada
// yalnızca bu ÇEVİRİ MANTIĞININ kendi içinde tutarlı olduğu doğrulanıyor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toStatusCategory, filterToLinearFilter } from "./linear.mjs";

test("toStatusCategory: Linear'in 6 durumu genel 3 kategoriye iner", () => {
  assert.equal(toStatusCategory("triage"), "new");
  assert.equal(toStatusCategory("backlog"), "new");
  assert.equal(toStatusCategory("unstarted"), "new");
  assert.equal(toStatusCategory("started"), "indeterminate");
  assert.equal(toStatusCategory("completed"), "done");
  assert.equal(toStatusCategory("cancelled"), "done");
});

test("toStatusCategory: bilinmeyen deger bos string doner, patlamaz", () => {
  assert.equal(toStatusCategory("something-new-linear-added"), "");
});

test("filterToLinearFilter: bos filtre bos nesne", () => {
  assert.deepEqual(filterToLinearFilter({}), {});
});

test("filterToLinearFilter: keys.in -> identifier.in (Jira'nin key in (...) karsiligi)", () => {
  assert.deepEqual(filterToLinearFilter({ keys: { in: ["ENG-1", "ENG-2"] } }), {
    identifier: { in: ["ENG-1", "ENG-2"] },
  });
});

test("filterToLinearFilter: keys.notIn -> identifier.nin", () => {
  assert.deepEqual(filterToLinearFilter({ keys: { notIn: ["ENG-1"] } }), {
    identifier: { nin: ["ENG-1"] },
  });
});

test("filterToLinearFilter: statusCategory 'todo' Linear'in UC turune birden genisler", () => {
  assert.deepEqual(filterToLinearFilter({ statusCategory: ["todo"] }), {
    state: { type: { in: ["triage", "backlog", "unstarted"] } },
  });
});

test("filterToLinearFilter: statusCategory 'done' hem completed hem cancelled'i kapsar", () => {
  assert.deepEqual(filterToLinearFilter({ statusCategory: ["done"] }), {
    state: { type: { in: ["completed", "cancelled"] } },
  });
});

test("filterToLinearFilter: assignee -> email eq", () => {
  assert.deepEqual(filterToLinearFilter({ assignee: "ali@example.com" }), {
    assignee: { email: { eq: "ali@example.com" } },
  });
});

test("filterToLinearFilter: hepsi birden ayni nesnede birlesir", () => {
  assert.deepEqual(
    filterToLinearFilter({ keys: { in: ["ENG-1"] }, statusCategory: ["inprogress"], assignee: "x@y.z" }),
    {
      identifier: { in: ["ENG-1"] },
      state: { type: { in: ["started"] } },
      assignee: { email: { eq: "x@y.z" } },
    },
  );
});
