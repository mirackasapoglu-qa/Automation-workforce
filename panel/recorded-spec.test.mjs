/**
 * Kayıt adımları → case adımları + Playwright spec'i.
 *   node --test panel/recorded-spec.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCaseSteps, toCodeLines, renderSpec, q, assertCount, describeLocator } from "./recorded-spec.mjs";

const steps = [
  { action: "goto", value: "/docs/intro/" },
  { action: "click", loc: { kind: "role", role: "link", name: "Docs" } },
  { action: "fill", loc: { kind: "role", role: "searchbox", name: "ara" }, value: "sdjfds" },
  { action: "press", loc: { kind: "role", role: "searchbox", name: "ara" }, key: "Enter" },
  { action: "assert", loc: { kind: "text", value: "No results found" }, value: "No results" },
  { action: "assertUrl", value: "/docs" },
  { action: "check", loc: { kind: "testid", value: "agree" } },
];

test("iddialar onceki adimin beklenenine yazilir, eylemler ayri adim", () => {
  const out = toCaseSteps(steps);
  assert.equal(out.length, 5);
  assert.match(out[0].action, /\/docs\/intro\/ adresine git/);
  assert.match(out[1].action, /'Docs' bağlantısı tıkla/);
  assert.match(out[2].action, /'ara' arama alanı alanına 'sdjfds' yaz/);
  assert.match(out[3].action, /Enter tuşuna bas/);
  assert.match(out[3].expected, /No results/);
  assert.match(out[3].expected, /Adres \/docs içerir/);
  assert.equal(out[4].expected, "");
  // en basta iddia varsa kendi adimi olur
  assert.equal(toCaseSteps([{ action: "assert", loc: { kind: "text", value: "X" } }])[0].action, "Sayfayı doğrula");
});

test("kod satirlari: locator turleri, iddia, tek tirnak kacisi ve satir sonu temizligi", () => {
  const lines = toCodeLines([
    ...steps,
    { action: "fill", loc: { kind: "css", value: "input[name='q']" }, value: "it's\nmulti\tline" },
  ]);
  assert.equal(lines[0], "  await page.goto('/docs/intro/');");
  assert.equal(lines[1], "  await page.getByRole('link', { name: 'Docs' }).click();");
  assert.match(lines[4], /expect\(page\.getByText\('No results found'\)\)\.toContainText\('No results'\)/);
  // escapeRe '/' karakterini KACIRMAZ (RegExp kurucusunda gerekmez)
  assert.equal(lines[5], "  await expect(page).toHaveURL(new RegExp('/docs'));");
  assert.equal(lines[6], "  await page.getByTestId('agree').check();");
  // tek tirnak kacti, satir sonu/tab bosluga dondu — dosya gecerli JS kalir
  assert.equal(lines[7], "  await page.locator('input[name=\\'q\\']').fill('it\\'s multi line');");
  assert.equal(q("ab"), "'ab'", "kontrol karakteri atilir");
});

test("spec: baslik case basligiyla ayni; iddiasiz kayitta toHaveURL eklenir", () => {
  const kod = renderSpec({ title: 'Docs "arama" akisi', steps, product: "Promptfoo", node: { name: "Intro", nodeId: "n5" }, path: "/docs/intro/" });
  assert.match(kod, /import \{ test, expect \} from "@playwright\/test";/);
  assert.match(kod, /test\("Docs \\"arama\\" akisi", async \(\{ page \}\)/);
  assert.match(kod, /ürün : Promptfoo/);
  assert.equal(assertCount(steps), 2);
  assert.equal((kod.match(/await expect\(/g) || []).length, 2);

  const iddiasiz = renderSpec({ title: "gez", steps: steps.slice(0, 2), path: "/docs/intro/" });
  assert.match(iddiasiz, /Iddia kaydedilmedi/);
  assert.match(iddiasiz, /toHaveURL\(new RegExp\('\/docs\/intro\/'\)\)/);
});

test("describeLocator rol adlari", () => {
  assert.equal(describeLocator({ kind: "role", role: "button", name: "Gönder" }), "'Gönder' düğmesi");
  assert.equal(describeLocator({ kind: "placeholder", value: "e-posta" }), "'e-posta' alanı");
  assert.equal(describeLocator(null), "sayfa");
});
