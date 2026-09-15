/*
 * Tek domain modunda HTML yeniden yazımı (`rewriteAbsolutePaths`).
 *
 * Bu fonksiyon, sitenin mutlak yollarını (`/assets/x.js`) panelin kökünden
 * proxy öneğine taşıyor. Yanlış taşıma iki yönde de zarar verir: taşınmayan yol
 * panelin köküne düşer (404), iki kez taşınan yol siteye ulaşmaz — ikisi de
 * burada ölçülüyor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteAbsolutePaths } from "./proxy.mjs";

const P = "/__site";

test("onek yoksa HTML aynen doner", () => {
  const html = `<img src="/a.png">`;
  assert.equal(rewriteAbsolutePaths(html, ""), html);
});

test("src/href/action/poster mutlak yollari onege tasinir", () => {
  const html = `<script src="/_next/x.js"></script><a href="/sepet">S</a>`
    + `<form action="/ara"><video poster="/p.jpg"></video>`;
  const out = rewriteAbsolutePaths(html, P);
  assert.match(out, /src="\/__site\/_next\/x\.js"/);
  assert.match(out, /href="\/__site\/sepet"/);
  assert.match(out, /action="\/__site\/ara"/);
  assert.match(out, /poster="\/__site\/p\.jpg"/);
});

test("goreli ve tam adresler ELLENMEZ", () => {
  const html = `<img src="urun.png"><a href="https://baska.test/x">d</a><img src="data:image/png;base64,AA">`;
  const out = rewriteAbsolutePaths(html, P);
  assert.equal(out, html);
});

test("protokol-goreli (//host/...) adres ELLENMEZ", () => {
  const html = `<script src="//cdn.test/x.js"></script>`;
  assert.equal(rewriteAbsolutePaths(html, P), html);
});

test("zaten tasinmis yol IKINCI kez tasinmaz", () => {
  const bir = rewriteAbsolutePaths(`<img src="/a.png">`, P);
  assert.equal(rewriteAbsolutePaths(bir, P), bir);
});

test("srcset'teki her aday ayri ayri tasinir", () => {
  const out = rewriteAbsolutePaths(`<img srcset="/a.png 1x, /b.png 2x">`, P);
  assert.match(out, /srcset="\/__site\/a\.png 1x,\s*\/__site\/b\.png 2x"/);
});

test("CSS url(/...) tasinir, tirnakli hali dahil", () => {
  const out = rewriteAbsolutePaths(`<style>a{background:url(/f.woff)}b{background:url("/g.png")}</style>`, P);
  assert.match(out, /url\(\/__site\/f\.woff\)/);
  assert.match(out, /url\("\/__site\/g\.png"\)/);
});

test("tek tirnakli oznitelik de tasinir", () => {
  const out = rewriteAbsolutePaths(`<img src='/a.png'>`, P);
  assert.match(out, /src='\/__site\/a\.png'/);
});
