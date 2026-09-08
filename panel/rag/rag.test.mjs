/**
 * RAG v1 — belirteçleme (Türkçe), parçalama, BM25 sıralaması, bayatlık.
 * Koşum: node --test panel/rag/rag.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokenize, normalizeTr, stem } from "./text.mjs";
import { buildIndex, saveIndex, loadIndex, isStale, ensureIndex, chunkMarkdown, chunkCode, chunkScopeTree, graphNeighbors, stats } from "./index.mjs";
import { search, contextFor, renderContextBlock } from "./retrieve.mjs";

test("Turkce I/i: SIPARISLERIM (buyuk noktali) ile siparislerim ayni belirtec", () => {
  assert.equal(normalizeTr("SİPARİŞLERİM"), "siparislerim");
  assert.equal(normalizeTr("sipariş"), "siparis");
  assert.deepEqual(tokenize("SİPARİŞLERİM"), tokenize("siparişlerim"));
  assert.deepEqual(tokenize("Sepetim"), tokenize("SEPETİM"));
});

test("govdeleme + onek: sepet/sepete/sepette/sepetim ortak belirtecte bulusur", () => {
  assert.equal(stem("sepetler"), "sepet");
  assert.equal(stem("ara"), "ara");
  const ortak = (a, b) => tokenize(a).some((t) => tokenize(b).includes(t));
  assert.ok(ortak("sepet", "sepete"));
  assert.ok(ortak("sepet", "sepette"));
  assert.ok(ortak("sepetim", "sepette"));
  assert.ok(!ortak("sepet", "arama"));
  assert.ok(tokenize("addToCart 406 LCP").includes("406"));
  assert.ok(tokenize("addToCart").includes("cart"), "camelCase ayrilir");
  assert.ok(!tokenize("ve bir bu the").length, "stopword'ler duser");
});

test("markdown baslik sinirinda parcalanir, satir numarasi tasir", () => {
  const md = "# Baslik\n\nparagraf bir yeterince uzun bir metin olsun ki kirk karakteri gecsin.\n\n## Alt\n\nikinci parca da yeterince uzun bir metin olsun ki kirk karakteri gecsin.\n";
  const ch = chunkMarkdown("a.md", md);
  assert.equal(ch.length, 2);
  assert.equal(ch[0].title, "Baslik");
  assert.equal(ch[1].title, "Baslik › Alt");
  assert.equal(ch[1].line, 7);
});

test("kod test( sinirinda parcalanir", () => {
  const src = `import x from "y";\n${"// dolgu\n".repeat(80)}test("bir", async () => {\n  await page.goto("/");\n});\n${"// dolgu2\n".repeat(80)}test("iki", async () => {\n  await page.goto("/sepet");\n});\n`;
  const ch = chunkCode("t.spec.ts", src);
  assert.ok(ch.length >= 2);
  assert.ok(ch.some((c) => c.title.includes('test("iki"')));
});

test("kapsam agaci dugum basina parca, nodeId tasir", () => {
  const tree = [{ id: "n1", name: "Kok", type: "module", children: [{ id: "n2", name: "Sepet", type: "page", testCases: [{ title: "adet artir", steps: [{ action: "a", expected: "b" }] }], jiraTasks: [{ taskId: "X-1" }] }] }];
  const ch = chunkScopeTree("tree.json", tree);
  assert.equal(ch.length, 2);
  assert.equal(ch[1].nodeId, "n2");
  assert.match(ch[1].text, /adet artir/);
});

test("graf komsulugu dosya bazinda", () => {
  const g = { nodes: [{ id: "a", source_file: "x.ts" }, { id: "b", source_file: "y.ts" }], links: [{ source: "a", target: "b" }] };
  assert.deepEqual(graphNeighbors(g), { "x.ts": ["y.ts"], "y.ts": ["x.ts"] });
});

// ---- ucdan uca: gecici repo
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rag-"));
fs.mkdirSync(path.join(root, "tests"), { recursive: true });
fs.mkdirSync(path.join(root, "pages"), { recursive: true });
fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Kurallar\n\n## Sepet\n\nSepette adet artırma limiti dolu üründe 406 döner ve toast gösterilir. Bu beklenen davranıştır.\n\n## Arama\n\nArama kutusu placeholder ile bulunur, sonuç kartları lazy yüklenir.\n");
fs.writeFileSync(path.join(root, "tests", "06-cart.spec.ts"), 'import { test } from "@playwright/test";\n\ntest("sepette adet artırılır", async ({ page }) => {\n  await cart.increase();\n  await expect(cart.badge).toHaveText("2");\n});\n');
fs.writeFileSync(path.join(root, "pages", "CartPage.ts"), "export class CartPage {\n  async increase() {\n    await this.page.click('button[aria-label*=\"rtır\"]:visible');\n  }\n}\n");

test("indeks kurulur, sepet sorgusu sepet parcalarini one koyar", () => {
  const idx = buildIndex({ root });
  const s = stats(idx);
  assert.ok(s.chunks >= 4);
  const hits = search(idx, "sepet adet artır 406");
  assert.ok(hits.length >= 2);
  assert.ok(/CLAUDE\.md|06-cart|CartPage/.test(hits[0].file));
  assert.ok(hits.every((h) => h.score > 0));
  const arama = search(idx, "arama kutusu placeholder");
  assert.equal(arama[0].file, "CLAUDE.md");
  assert.match(arama[0].title, /Arama/);
});

test("kaydet/yukle/bayatlik: dosya degisince isStale true, ensureIndex yeniden kurar", async () => {
  const idx = buildIndex({ root });
  saveIndex(idx, root);
  const loaded = loadIndex(root);
  assert.equal(loaded.chunks.length, idx.chunks.length);
  assert.equal(isStale(loaded, root), false);
  await new Promise((r) => setTimeout(r, 15));
  fs.writeFileSync(path.join(root, "docs.md"), "# Yeni\n\nyeni bir dosya eklendi, bayatlik tespit edilmeli, yeterince uzun.\n");
  assert.equal(isStale(loaded, root), true);
  const fresh = ensureIndex({ root, force: true });
  assert.ok(fresh.sources.some((s) => s.file === "docs.md"));
});

test("contextFor bagLam blogu uretir, karakter butcesine uyar", () => {
  const ctx = contextFor({ query: "sepet adet", root, maxChars: 800, k: 3 });
  assert.ok(ctx);
  assert.ok(ctx.chunks.length >= 1);
  assert.ok(ctx.text.length <= 900);
  assert.match(renderContextBlock(ctx), /İlgili repo bağlamı/);
  const bos = contextFor({ query: "zzzz qqqq", root });
  assert.equal(bos.chunks.length, 0);
  assert.equal(renderContextBlock(bos), "");
});
