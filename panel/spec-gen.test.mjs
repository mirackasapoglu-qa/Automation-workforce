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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MOD = path.resolve(import.meta.dirname, "spec-gen.mjs");

/*
 * Diske yazan yollar (`storeSpec` / `restoreGenerated` / `pickFilename`) GEÇİCİ
 * bir cwd'de, AYRI SÜREÇTE koşar: modül yol sabitlerini yüklenirken
 * `process.cwd()`den alıyor ve repo'nun kendi `tests/` dizinine dosya bırakmak
 * istemiyoruz. Aynı desen `product-credentials.test.mjs`te de var.
 */
function calistir(kod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specgen-"));
  const script = `
    const g = await import(${JSON.stringify(MOD)});
    const sonuc = await (async () => { ${kod} })();
    console.log("<<<" + JSON.stringify(sonuc) + ">>>");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
  const parsed = JSON.parse(out.slice(out.indexOf("<<<") + 3, out.lastIndexOf(">>>")));
  const oku = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), "utf8") : null);
  const liste = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readdirSync(path.join(dir, rel)).sort() : null);
  const disk = {
    tests: liste("tests"), store: liste(path.join("panel-data", "generated")),
    testsIcerik: oku(path.join("tests", "gen-x.spec.ts")),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...parsed, __disk: disk };
}

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

test("kimlik VARSA istem parolayi VERMEZ, process.env okumasini soyler", () => {
  const u = renderUser({
    product: "X", baseUrl: "https://x.test", node: { name: "Giris", path: "/giris" },
    cases: [{ title: "Login akisi", steps: [{ action: "Giris yap", expected: "Hesabim gorunur" }] }],
    credentials: { username: "qa@x.test", loginUrl: "/giris", hasPassword: true },
  });
  assert.match(u, /process\.env\.QA_USERNAME/);
  assert.match(u, /process\.env\.QA_PASSWORD/);
  assert.match(u, /PAROLAYI KODA YAZMA/);
  assert.match(u, /qa@x\.test/);          // kullanici adi verilir
  assert.match(u, /test\.skip/);          // kimlik yoksa atla
});

test("kimlik YOKSA istem 'uydurma, atla' der", () => {
  const u = renderUser({
    product: "X", baseUrl: "https://x.test", node: { name: "Giris" },
    cases: [{ title: "Login akisi", steps: [] }],
  });
  assert.match(u, /GİRİŞ BİLGİSİ YOK/);
  assert.match(u, /UYDURMA/);
});

test("kapida PAROLA SIZINTISI yakalanir", () => {
  const sizan = KOD.replace('await page.goto("/sepet");', 'await page.fill("#pass", "s3cret!");');
  const r = gate({ code: sizan }, { titles: ["Sepete urun eklenir"], secret: "s3cret!" });
  assert.equal(r.ok, false);
  assert.match(r.error, /parola düz metin/);
  // Ayni kod, parola verilmemisse (kayit yok) gecer — yanlis pozitif yok.
  assert.equal(gate({ code: sizan }, { titles: ["Sepete urun eklenir"] }).ok, true);
});

test("storeSpec İKİ yere birden yazar — volume kopyasi olmadan deploy ucururdu", () => {
  const r = calistir(`return g.storeSpec("gen-x.spec.ts", "kod");`);
  assert.deepEqual(r.__disk.tests, ["gen-x.spec.ts"]);
  assert.deepEqual(r.__disk.store, ["gen-x.spec.ts"]);
  assert.equal(r.__disk.testsIcerik, "kod");
  assert.equal(r.file, "gen-x.spec.ts");
});

test("restoreGenerated deploy sonrasi eksikleri geri koyar", () => {
  // Deploy taklidi: depo dolu, `tests/` silinmis.
  const r = calistir(`
    g.storeSpec("gen-x.spec.ts", "kod");
    (await import("node:fs")).rmSync("tests", { recursive: true, force: true });
    return g.restoreGenerated();
  `);
  assert.deepEqual(r.restored, ["gen-x.spec.ts"]);
  assert.deepEqual(r.__disk.tests, ["gen-x.spec.ts"]);
  assert.equal(r.__disk.testsIcerik, "kod");
});

test("restoreGenerated ELLE DUZENLENMIS dosyayi EZMEZ", () => {
  const r = calistir(`
    g.storeSpec("gen-x.spec.ts", "kod");
    const fs = (await import("node:fs")).default;
    fs.writeFileSync("tests/gen-x.spec.ts", "elle duzeltilmis");
    return g.restoreGenerated();
  `);
  assert.deepEqual(r.restored, []);
  assert.equal(r.skipped, 1);
  assert.equal(r.__disk.testsIcerik, "elle duzeltilmis");
});

test("depo yoksa sessizce bos doner (hic uretim yapilmamis panel)", () => {
  const r = calistir(`return g.restoreGenerated();`);
  assert.deepEqual(r.restored, []);
  assert.equal(r.skipped, 0);
});

test("gen- olmayan dosya geri yuklenmez (depo dizini yalniz uretime ait)", () => {
  const r = calistir(`
    const fs = (await import("node:fs")).default;
    fs.mkdirSync("panel-data/generated", { recursive: true });
    fs.writeFileSync("panel-data/generated/not.md", "x");
    fs.writeFileSync("panel-data/generated/gen-y.spec.ts", "y");
    return g.restoreGenerated();
  `);
  assert.deepEqual(r.restored, ["gen-y.spec.ts"]);
  assert.deepEqual(r.__disk.tests, ["gen-y.spec.ts"]);
});

test("pickFilename cakismayi DEPODA da arar (tests/ deploy'da bos gelebilir)", () => {
  const r = calistir(`
    g.storeSpec("gen-a.spec.ts", "kod");
    (await import("node:fs")).rmSync("tests", { recursive: true, force: true });
    return { ad: g.pickFilename("a") };
  `);
  assert.equal(r.ad, "gen-a-2.spec.ts", "depodaki dosyanin adi yeniden verilmemeli");
});

test("depo yokken diskteki uretilmis spec SAHIPLENILIR (ilk deploy'da ucmasin)", () => {
  const r = calistir(`
    const fs = (await import("node:fs")).default;
    fs.mkdirSync("tests", { recursive: true });
    fs.writeFileSync("tests/gen-eski.spec.ts", "depo oncesi uretildi");
    fs.writeFileSync("tests/01-elle.spec.ts", "elle yazildi");
    return g.restoreGenerated();
  `);
  assert.deepEqual(r.adopted, ["gen-eski.spec.ts"]);
  assert.deepEqual(r.__disk.store, ["gen-eski.spec.ts"], "elle yazilan test sahiplenilmemeli");
});

test("specExists dosyayi gorur, yol kacisini reddeder", () => {
  const r = calistir(`
    g.storeSpec("gen-var.spec.ts", "kod");
    return {
      var: g.specExists("gen-var.spec.ts"),
      yok: g.specExists("gen-yok.spec.ts"),
      bos: g.specExists(""),
      kacis: g.specExists("../package.json"),
    };
  `);
  assert.equal(r.var, true);
  assert.equal(r.yok, false, "dosyasi kaybolmus spec 'otomatik' sayilmamali");
  assert.equal(r.bos, false);
  assert.equal(r.kacis, false);
});

test("deadSpecs: dugum seviyesindeki olu referans da yakalanir", () => {
  // Canli durum (2026-09-16): case'in kendi spec'i YOK, bag yalniz dugumde
  // (runRef.specs) ve o dosya deploy'da ucmus. Temizlenmezse yeniden uretilen
  // dosya hic denenmeden kosum "Bilinmeyen spec" demeye devam eder.
  const r = calistir(`
    g.storeSpec("gen-var.spec.ts", "kod");
    return {
      karisik: g.deadSpecs(["gen-var.spec.ts", "gen-ucmus.spec.ts", null, undefined]),
      hepsiVar: g.deadSpecs(["gen-var.spec.ts"]),
      bos: g.deadSpecs(null),
    };
  `);
  assert.deepEqual(r.karisik, ["gen-ucmus.spec.ts"]);
  assert.deepEqual(r.hepsiVar, []);
  assert.deepEqual(r.bos, []);
});
