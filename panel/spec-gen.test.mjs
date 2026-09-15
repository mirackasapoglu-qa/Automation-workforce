/*
 * Spec üreticinin KAPISI — modelin çıktısı diske yazılmadan önce buradan geçer.
 *
 * Kapı, uydurma/tehlikeli kod kadar "aslında spec değil" durumunu da eler.
 * Diske yazan `writeSpec`/`pickFilename` burada test EDİLMİYOR (repo'nun
 * `tests/` dizinine dosya bırakmamak için); saf olan `gate`, `renderUser` ve
 * `slugify` ölçülüyor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, renderUser, slugify } from "./spec-gen.mjs";

const KOD = `import { test, expect } from "@playwright/test";
test("Sepete urun eklenir", async ({ page }) => { await page.goto("/sepet"); await expect(page).toHaveURL(/sepet/); });`;

test("gecerli spec kapidan gecer", () => {
  const r = gate({ code: KOD }, { titles: ["Sepete urun eklenir"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("bos kod reddedilir", () => {
  assert.equal(gate({ code: "   " }).ok, false);
  assert.equal(gate({}).ok, false);
});

test("Playwright import'u olmayan metin spec sayilmaz", () => {
  const r = gate({ code: 'console.log("merhaba");' });
  assert.equal(r.ok, false);
  assert.match(r.error, /spec dosyası değil/);
});

test("hic test() yoksa reddedilir", () => {
  const r = gate({ code: 'import { test, expect } from "@playwright/test";\nconst x = 1;' });
  assert.equal(r.ok, false);
  assert.match(r.error, /test\(\) yok/);
});

test("TEHLIKELI kaliplar reddedilir", () => {
  const taban = 'import { test, expect } from "@playwright/test";\ntest("x", async () => { %% });';
  for (const [parca, beklenen] of [
    ['require("fs")', /require/],
    ['const { execSync } = child_process', /süreç çağrısı/],
    ['fs.unlink("/tmp/x")', /dosya yazma/],
    ['process.env["TOKEN"]', /env/],
  ]) {
    const r = gate({ code: taban.replace("%%", parca) });
    assert.equal(r.ok, false, `kabul edilmemeliydi: ${parca}`);
    assert.match(r.error, beklenen);
  }
});

test("istenen case'lerin HICBIRI yoksa reddedilir", () => {
  const r = gate({ code: KOD }, { titles: ["Bambaska bir case", "Ikinci baska"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /hiçbirini içermiyor/);
});

test("case'lerin BIR KISMI eksikse gecer ama eksikler raporlanir", () => {
  const r = gate({ code: KOD }, { titles: ["Sepete urun eklenir", "Eksik kalan case"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, ["Eksik kalan case"]);
});

test("slugify turkce harfleri ve bosluklari dosya adina cevirir", () => {
  assert.equal(slugify("Oturma Odası · Ürün Listesi"), "oturma-odasi-urun-listesi");
  assert.equal(slugify(""), "kapsam");
});

test("istem adimlari ve beklenenleri tasir, adres gomulmesini yasaklar", () => {
  const u = renderUser({
    product: "X", baseUrl: "https://x.test",
    node: { name: "Sepet", path: "/sepet" },
    cases: [{ title: "Bos sepet mesaji", steps: [{ action: "Sepeti ac", expected: "Sepetiniz bos gorunur" }] }],
  });
  assert.match(u, /Bos sepet mesaji/);
  assert.match(u, /Sepeti ac/);
  assert.match(u, /beklenen: Sepetiniz bos gorunur/);
  assert.match(u, /Adres KODA GÖMME/);
  assert.match(u, /page\.goto\("\/sepet"\)/);
});

test("code alani yoksa Playwright import'u iceren alan kabul edilir (CLI bicim sapmasi)", () => {
  const r = gate({ file: "x.spec.ts", language: "typescript", content: KOD }, { titles: ["Sepete urun eklenir"] });
  assert.equal(r.ok, true);
});

test("uzun ama Playwright olmayan metin kod SAYILMAZ", () => {
  const r = gate({ notes: "x".repeat(400) });
  assert.equal(r.ok, false);
});
