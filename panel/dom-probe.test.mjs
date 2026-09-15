/*
 * Keşif çıktısının İSTEME giren hâli — saf fonksiyon, tarayıcı açmaz.
 * (Gerçek sayfa keşfi canlı siteye karşı ölçüldü: /giris 5,6 sn, readonly
 * bayrağı ve `ornek@mail.com` placeholder'ı doğru çıktı.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProbe, pathsInSteps } from "./dom-probe.mjs";

const D = {
  url: "https://ornek.test/giris",
  title: "Giriş Yap - Örnek",
  basliklar: [{ etiket: "h1", metin: "Giriş Yap" }],
  dugmeler: [{ ad: "GİRİŞ YAP" }, { ad: "SMS İLE GİRİŞ YAP" }],
  baglar: [{ metin: "KAYIT OL", href: "/kayit" }],
  alanlar: [
    { tip: "email", id: "login-email", ad: "login-email", placeholder: "ornek@mail.com", aria: "", readonly: true },
    { tip: "checkbox", id: "login-remember-me", ad: "", placeholder: "", aria: "", readonly: false },
  ],
};

test("kesif bloğu seçicinin türetilebileceği HER ŞEYİ taşır", () => {
  const m = renderProbe(D);
  assert.match(m, /Giriş Yap - Örnek/);
  assert.match(m, /h1:"Giriş Yap"/);
  assert.match(m, /"GİRİŞ YAP"/);
  assert.match(m, /"KAYIT OL"→\/kayit/);
  assert.match(m, /#login-email/);
  assert.match(m, /placeholder="ornek@mail\.com"/);
});

test("READONLY isareti isteme girer — fill oradan dusuyordu", () => {
  assert.match(renderProbe(D), /READONLY \(fill'den önce click şart\)/);
});

test("kesif yoksa blok BOS — ozellik kapanmaz, uretim tahminle devam eder", () => {
  assert.equal(renderProbe(null), "");
  assert.equal(renderProbe(undefined), "");
});

test("uzun sayfa istemi sisirmez (kirpilir)", () => {
  const buyuk = { ...D, baglar: Array.from({ length: 400 }, (_, i) => ({ metin: `bag-${i}`, href: `/yol-${i}` })) };
  const m = renderProbe(buyuk, { limit: 500 });
  assert.ok(m.length <= 520, `blok ${m.length} karakter`);
  assert.match(m, /kısaltıldı/);
});

test("pathsInSteps: adimlardaki site ici rotalari bulur, gurultuyu eler", () => {
  const c = [{ title: "Kayıtlı kullanıcı giriş yapar", steps: [
    { action: "/giris adresine git", expected: "Giriş formu görünür" },
    { action: "E-postayı yaz", expected: "hesabım alanına döner" },
  ] }];
  assert.deepEqual(pathsInSteps(c), ["/giris"]);
  // dosya uzantisi, e-posta icindeki egik cizgi ve tekrarlar elenir
  assert.deepEqual(pathsInSteps([{ title: "x", steps: [{ action: "logo.png, /sepet, /sepet", expected: "a@b.co/xx" }] }]), ["/sepet"]);
  assert.deepEqual(pathsInSteps([]), []);
  assert.deepEqual(pathsInSteps(null), []);
});

test("pathsInSteps: limit asilmaz (kesif basina ~5 sn)", () => {
  // NOT: tek harflik yollar (/a) bilerek eslesmiyor — gurultu.
  const c = [{ title: "t", steps: [{ action: "/giris /sepet /hesabim /favoriler", expected: "" }] }];
  assert.deepEqual(pathsInSteps(c, { limit: 2 }), ["/giris", "/sepet"]);
});
