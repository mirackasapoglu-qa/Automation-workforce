// saveSorter'ın doğrulama dalları — yalnızca throw ile biten yollar (hiçbiri
// panel-data/jira-sorters.json'a dokunmuyor, doğrulama diske yazmadan ÖNCE
// çalışıyor). Gerçek dosyaya yazan başarı yolu burada BİLEREK test edilmiyor
// (paylaşılan/gerçek veri dosyasını kirletmemek için).
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveSorter } from "./jira-sorters.mjs";

test("isim bos olamaz", () => {
  assert.throws(() => saveSorter({ label: "  ", mode: "raw", jql: "project = X" }), /İsim boş olamaz/);
});

test("mode belirtilmezse 'raw' varsayilir ve JQL zorunlu olur", () => {
  assert.throws(() => saveSorter({ label: "Test", jql: "" }), /JQL boş olamaz/);
});

test("mode:raw ile bos JQL reddedilir", () => {
  assert.throws(() => saveSorter({ label: "Test", mode: "raw", jql: "   " }), /JQL boş olamaz/);
});

test("mode:filter ile filtre eksikse reddedilir", () => {
  assert.throws(() => saveSorter({ label: "Test", mode: "filter" }), /filtre boş olamaz/);
});

test("mode:filter ile filtre dizi olamaz (nesne olmali)", () => {
  assert.throws(() => saveSorter({ label: "Test", mode: "filter", filter: ["yanlis"] }), /filtre boş olamaz/);
});

test("olmayan bir id ile guncelleme denemesi acik hatayla reddedilir", () => {
  assert.throws(() => saveSorter({ id: "cs-yok-boyle-bir-id", label: "Test", mode: "raw", jql: "project = X" }), /Sorter bulunamadı/);
});
