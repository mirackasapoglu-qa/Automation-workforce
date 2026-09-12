// filterToJql: genel (sağlayıcıdan bağımsız) Sorter filtresinin Jira tarafı.
// Gerçek bir Jira örneğine karşı DENENMEDİ (bu depoda kimlik yok) — burada
// yalnızca ÜRETİLEN JQL METNİNİN beklenen şekilde olduğu doğrulanıyor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterToJql } from "./jira.mjs";

test("bos filtre: yalniz proje + varsayilan siralama", () => {
  assert.equal(filterToJql({}), "project = MAC ORDER BY status, key");
});

test("keys.in: Flowscope'a Bagli sorter'inin karsiligi", () => {
  assert.equal(
    filterToJql({ keys: { in: ["MAC-1", "MAC-2"] } }),
    'project = MAC AND key in ("MAC-1", "MAC-2") ORDER BY status, key',
  );
});

test("keys.notIn: Flowscope'a Bagli Degil sorter'inin karsiligi", () => {
  assert.equal(
    filterToJql({ keys: { notIn: ["MAC-1"] } }),
    'project = MAC AND key not in ("MAC-1") ORDER BY status, key',
  );
});

test("statusCategory: genel kategori Jira'nin kategori adlarina cevrilir", () => {
  assert.equal(
    filterToJql({ statusCategory: ["todo", "inprogress"] }),
    'project = MAC AND statusCategory in ("To Do", "In Progress") ORDER BY status, key',
  );
});

test("assignee tirnak icinde tek basina bir AND kosulu", () => {
  assert.equal(
    filterToJql({ assignee: "ali@example.com" }),
    'project = MAC AND assignee = "ali@example.com" ORDER BY status, key',
  );
});

test("hepsi birden: sira her zaman ayni (keys, statusCategory, assignee)", () => {
  assert.equal(
    filterToJql({ keys: { in: ["MAC-1"] }, statusCategory: ["done"], assignee: "x" }),
    'project = MAC AND key in ("MAC-1") AND statusCategory in ("Done") AND assignee = "x" ORDER BY status, key',
  );
});

test("anahtar/atanan metnindeki cift tirnak kacisi kirmadan temizlenir", () => {
  assert.equal(
    filterToJql({ keys: { in: ['MAC-"1"'] } }),
    'project = MAC AND key in ("MAC-1") ORDER BY status, key',
  );
});

test("bos statusCategory/keys dizileri hicbir AND kosulu eklemez", () => {
  assert.equal(
    filterToJql({ statusCategory: [], keys: { in: [], notIn: [] } }),
    "project = MAC ORDER BY status, key",
  );
});
