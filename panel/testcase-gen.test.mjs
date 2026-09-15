// testcase-gen.mjs prompt geliştirmesi — perf/statusHistory/knownIssues artık
// prompta giriyor (önceden "bak" deniyordu ama veri hiç verilmiyordu) ve
// negative türünün "sayıyı sınırlama" talimatıyla çelişen sabit tavan
// düzeltildi. `renderUser` saf fonksiyon: ctx elle kurulup test ediliyor,
// dosya sistemine dokunmuyor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, renderUser } from "./testcase-gen.mjs";

const baseCtx = (extra = {}) => ({
  yol: "Homee › Sepet",
  ad: "Sepet",
  tur: "page",
  altBaslıklar: [],
  canliUrl: null,
  figma: [],
  confluence: [],
  mevcutCaseler: [],
  kartlar: [],
  otomatikSpec: [],
  perf: null,
  gecmisDurumlar: [],
  bilinenHatalar: [],
  ...extra,
});

test("renderUser: 'perf' türü İSTENMİYORSA ölçüm bloğu görünmez (data varsa bile)", () => {
  const ctx = baseCtx({ perf: { route: "/sepet", lcp: 4200, ttfb: 900, at: "2026-09-16T00:00:00.000Z" } });
  const out = renderUser(ctx, ["happy"], 4);
  assert.ok(!out.includes("Ölçülmüş performans"));
});

test("renderUser: 'perf' istenip veri VARSA gerçek sayılarla ölçüm bloğu girer", () => {
  const ctx = baseCtx({ perf: { route: "/sepet", lcp: 4200, ttfb: 900, at: "2026-09-16T00:00:00.000Z", consoleErrors: 2 } });
  const out = renderUser(ctx, ["perf"], 4);
  assert.ok(out.includes("Ölçülmüş performans"));
  assert.ok(out.includes("4200"));
  assert.ok(out.includes("900"));
  assert.ok(out.includes("2 konsol hatası"));
  assert.ok(out.includes("UYDURMA"));
});

test("renderUser: 'perf' istenip veri YOKSA ölçüm bloğu görünmez (uydurmaya alan açmıyor)", () => {
  const out = renderUser(baseCtx(), ["perf"], 4);
  assert.ok(!out.includes("Ölçülmüş performans"));
});

test("renderUser: 'regression' istenip statusHistory VARSA gerçek geçişler girer", () => {
  const ctx = baseCtx({ gecmisDurumlar: [{ from: "✅", to: "❌", at: "2026-09-01T00:00:00.000Z" }] });
  const out = renderUser(ctx, ["regression"], 4);
  assert.ok(out.includes("gerçek durum geçmişi"));
  assert.ok(out.includes("✅ → ❌"));
});

test("renderUser: 'regression' İSTENMİYORSA statusHistory olsa bile girmez", () => {
  const ctx = baseCtx({ gecmisDurumlar: [{ from: "✅", to: "❌", at: "2026-09-01T00:00:00.000Z" }] });
  const out = renderUser(ctx, ["happy"], 4);
  assert.ok(!out.includes("gerçek durum geçmişi"));
});

test("renderUser: 'regression' istenip bilinen hata VARSA tekrar keşfetme uyarısıyla girer", () => {
  const ctx = baseCtx({ bilinenHatalar: [{ id: "HOMEE-099", where: "/sepet", detail: "Adet artırma 406 veriyor." }] });
  const out = renderUser(ctx, ["regression"], 4);
  assert.ok(out.includes("HOMEE-099"));
  assert.ok(out.includes("Adet artırma 406 veriyor."));
  assert.ok(out.includes("keşif"));
});

test("renderUser: limit satırı 'negative' türünü açıkça istisna tutuyor (eski çelişki düzeldi)", () => {
  const out = renderUser(baseCtx(), ["happy", "negative"], 3);
  assert.ok(out.includes('İSTİSNA: "negative"'));
  assert.ok(out.includes("en fazla 3 case"));
});

test("buildContext: node.perf yoksa null, varsa aynen geçer", () => {
  const tree = [{ id: "n1", name: "Sepet", type: "page", children: [] }];
  const withoutPerf = buildContext(tree, tree[0]);
  assert.equal(withoutPerf.perf, null);

  const nodeWithPerf = { ...tree[0], perf: { route: "/sepet", lcp: 1200 } };
  const withPerf = buildContext(tree, nodeWithPerf);
  assert.deepEqual(withPerf.perf, { route: "/sepet", lcp: 1200 });
});

test("buildContext: statusHistory'nin yalnızca son 5 geçişini alır", () => {
  const gecmis = Array.from({ length: 8 }, (_, i) => ({ from: `s${i}`, to: `s${i + 1}`, at: String(i) }));
  const node = { id: "n1", name: "Sepet", type: "page", children: [], statusHistory: gecmis };
  const ctx = buildContext([node], node);
  assert.equal(ctx.gecmisDurumlar.length, 5);
  assert.equal(ctx.gecmisDurumlar[0].from, "s3");
  assert.equal(ctx.gecmisDurumlar[4].to, "s8");
});

test("buildContext: eşleşmeyen bir nodeId için bilinenHatalar boş dizi döner (gerçek dosyaya karşı)", () => {
  const node = { id: "kesinlikle-hic-eslesmeyecek-bir-test-id-xyz", name: "Sepet", type: "page", children: [] };
  const ctx = buildContext([node], node);
  assert.deepEqual(ctx.bilinenHatalar, []);
});
