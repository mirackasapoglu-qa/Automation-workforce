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
  // Gorunur suzgeci HER locator'a eklenir: ikiz/coklu eslesme strict mode ile
  // patiyordu (olculdu canli /giris: "GİRİŞ YAP" 2 eslesme).
  assert.equal(lines[1], "  await page.getByRole('link', { name: 'Docs' }).filter({ visible: true }).first().click();");
  assert.match(lines[4], /expect\(page\.getByText\('No results found'\)\.filter\(\{ visible: true \}\)\.first\(\)\)\.toContainText\('No results'\)/);
  // escapeRe '/' karakterini KACIRMAZ (RegExp kurucusunda gerekmez)
  assert.equal(lines[5], "  await expect(page).toHaveURL(new RegExp('/docs'));");
  // Kutular force ile: sr-only checkbox Playwright'in aktiflik kontrolunde
  // 20 sn bekleyip dusuyordu (olculdu canli /giris).
  assert.equal(lines[6], "  await page.getByTestId('agree').filter({ visible: true }).first().check({ force: true });");
  // tek tirnak kacti, satir sonu/tab bosluga dondu — dosya gecerli JS kalir
  assert.equal(lines[7], "  await page.locator('input[name=\\'q\\']').filter({ visible: true }).first().fill('it\\'s multi line');");
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

test("PAROLA ne koda ne case adimina duser — ortamdan okunur", () => {
  const adimlar = [{ action: "fill", loc: { kind: "css", value: "#login-password" }, secret: true }];
  const kod = toCodeLines(adimlar).join("\n");
  assert.match(kod, /process\.env\.QA_PASSWORD/);
  assert.match(kod, /test\.skip\(!process\.env\.QA_PASSWORD/, "kimlik yoksa atla, yanlis parolayla deneme");
  assert.equal(/fill\('/.test(kod), false, "duz metin parola yazilmamali");
  assert.match(toCaseSteps(adimlar)[0].action, /kayıtlı parolayı yaz/);
});

test("gorunur suzgeci iddiaya da uygulanir", () => {
  const kod = toCodeLines([{ action: "assert", loc: { kind: "role", role: "button", name: "GİRİŞ YAP" } }])[0];
  assert.match(kod, /\.filter\(\{ visible: true \}\)\.first\(\)/);
  assert.match(kod, /toBeVisible/);
});

test("ESKI kayitta maskelenmis deger de parola sayilir", () => {
  // Agacta duran eski kayit: site parolayi kendi maskelemis (olculdu canlida).
  const kod = toCodeLines([{ action: "fill", loc: { kind: "css", value: "#login-password" }, value: "•••••••••" }]).join("\n");
  assert.match(kod, /process\.env\.QA_PASSWORD/);
  assert.equal(kod.includes("•"), false, "maskelenmis dize koda yazilmamali");
});
