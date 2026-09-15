/*
 * Aktif ürün çözümü — ağacın kökleri ürün, biri aktif.
 *
 * `listProducts` / `activeSubtree` SAF (ağacı parametre alır, diske dokunmaz),
 * o yüzden doğrudan test edilir. Seçimin kalıcılığı (`readActiveId`/
 * `writeActiveId`) gerçek dosyaya yazdığı için BURADA test EDİLMİYOR —
 * panel-data'yı kirletmemek için (aynı gerekçe jira-sorters.test.mjs'te de var).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listProducts, activeSubtree } from "./active-product.mjs";

const link = (url) => ({ url, type: "link", createdAt: "2026-09-15T00:00:00.000Z" });
const n = (id, name, extra = {}) => ({ id, name, type: "page", resourceLinks: [], children: [], ...extra });

const AGAC = [
  n("k1", "Promptfoo", {
    type: "module",
    children: [
      n("a", "Docs", { resourceLinks: [link("https://www.promptfoo.dev/docs")] }),
      n("b", "Blog", { resourceLinks: [link("https://www.promptfoo.dev/blog")] }),
      n("c", "Dis link", { resourceLinks: [link("https://github.com/x")] }),
    ],
  }),
  n("k2", "Tepe Home", {
    type: "module",
    children: [
      n("d", "Sepet", { resourceLinks: [link("https://site.test/sepet")] }),
      n("e", "Tasarim", { resourceLinks: [link("https://www.figma.com/design/ABC")] }),
    ],
  }),
];

test("her kok bir urun; adres EN COK GECEN origin'den", () => {
  const p = listProducts(AGAC, { profileBaseUrl: "https://site.test" });
  assert.equal(p.length, 2);
  assert.equal(p[0].name, "Promptfoo");
  assert.equal(p[0].baseUrl, "https://www.promptfoo.dev");   // github azinlikta kaldi
  assert.equal(p[1].baseUrl, "https://site.test");
});

test("figma/jira/confluence linkleri urunun adresi SAYILMAZ", () => {
  const p = listProducts([AGAC[1]], { profileBaseUrl: null });
  assert.equal(p[0].baseUrl, "https://site.test");           // figma elendi
});

test("profilin sitesiyle eslesen kok isProfile ile isaretlenir (www farki onemsiz)", () => {
  const p = listProducts(AGAC, { profileBaseUrl: "https://www.site.test" });
  assert.equal(p[0].isProfile, false);
  assert.equal(p[1].isProfile, true);
});

test("hic site linki yoksa profilin adresine duser (tohumlanmis agac)", () => {
  const tohum = [n("k", "Homee", { type: "module", children: [n("x", "Anasayfa", { route: "/" })] })];
  const p = listProducts(tohum, { profileBaseUrl: "https://site.test" });
  assert.equal(p[0].baseUrl, "https://site.test");
  assert.equal(p[0].links, 0);
  assert.equal(p[0].isProfile, true);
});

test("dugum sayisi kokun KENDISI dahil alt agacin tamami", () => {
  const p = listProducts(AGAC, {});
  assert.equal(p[0].nodes, 4);   // kok + 3 cocuk
  assert.equal(p[1].nodes, 3);
});

test("activeSubtree yalniz secili kokun agacini verir", () => {
  const alt = activeSubtree(AGAC, { nodeId: "k2" });
  assert.equal(alt.length, 1);
  assert.equal(alt[0].name, "Tepe Home");
});

test("secili kok agactan silinmisse TUM agac doner (panel bos kalmasin)", () => {
  const alt = activeSubtree(AGAC, { nodeId: "yok" });
  assert.equal(alt.length, 2);
});

test("bos agac urun uretmez", () => {
  assert.deepEqual(listProducts([], {}), []);
  assert.deepEqual(activeSubtree([], null), []);
});
