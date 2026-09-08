/**
 * Gizli veri maskeleme — üç katman ayrı ayrı ölçülür.
 * Koşum: node --test panel/rag/redact.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { redactText, secretValuesFromEnv, MASK } from "./redact.mjs";

test("ortam degerleri: *PASSWORD/*TOKEN degerleri metinde nerede gecerse gecsin maskelenir", () => {
  const values = secretValuesFromEnv({ GATE_PASSWORD: "password123", TEST_EMAIL: "a@b.c", SHORT_TOKEN: "abc", PANEL_TOKEN: "abcdef0123" });
  assert.ok(values.has("password123"));
  assert.ok(values.has("abcdef0123"));
  assert.ok(!values.has("abc"), "6 karakterden kisa deger maskelenmez (yanlis pozitif)");
  assert.ok(!values.has("a@b.c"), "TEST_EMAIL gizli sayilmaz");
  const r = redactText("Kapı: `GATE_USER` / `GATE_PASSWORD` (`admin` / `password123`). Token abcdef0123 burada.", { values });
  assert.ok(!r.text.includes("password123"));
  assert.ok(!r.text.includes("abcdef0123"));
  assert.ok(r.redactions >= 2);
});

test("bicim kaliplari: sk-ant, figd_, Bearer, PEM", () => {
  const r = redactText([
    "ANTHROPIC anahtari sk-ant-api03-abcdefghijklmnop",
    "figma figd_ABCDEFGHIJKLMNOP",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc",
    "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
  ].join("\n"), { values: new Set() });
  assert.ok(!/sk-ant-api03/.test(r.text));
  assert.ok(!/figd_ABC/.test(r.text));
  assert.ok(!/eyJhbGci/.test(r.text));
  assert.ok(!/MIIE/.test(r.text));
  assert.equal((r.text.match(/\[gizli\]/g) || []).length, 4);
});

test("satir kurali: X_PASSWORD=deger yalniz degeri maskeler, adi birakir", () => {
  const r = redactText("GATE_PASSWORD=super-secret-1\nJIRA_TOKEN: 'tok-abcdefg'\nHOMEE_ENV=test", { values: new Set() });
  assert.match(r.text, /GATE_PASSWORD=\[gizli\]/);
  assert.match(r.text, /JIRA_TOKEN: '\[gizli\]'/);
  assert.match(r.text, /HOMEE_ENV=test/, "gizli olmayan degisken dokunulmaz");
});

test("duzyazi cifti: sifre gecen satirda (kullanici / sifre) maskelenir, gecmeyen satirda parantez korunur", () => {
  const r = redactText("Şifre çifti (admin / gizli-deger). Oran (3 / 4) burada.", { values: new Set() });
  assert.ok(!r.text.includes("gizli-deger"));
  assert.match(r.text, /\(3 \/ 4\)/, "sayisal oran maskelenmez: satir sifre kelimesi tasiyor ama cift kurali 3+ harf ister");
  const r2 = redactText("Fiyat aralığı (100 / 200) ve rota (a / b)", { values: new Set() });
  assert.equal(r2.redactions, 0);
  assert.equal(MASK, "[gizli]");
});
