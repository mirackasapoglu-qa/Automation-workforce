/**
 * Ağ erişilebilirliği ölçümü — AĞA ÇIKMADAN test edilir (global fetch stub'lanır).
 *
 * Koşum: node --test panel/auth/claude-net.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reachability, summarize, HOSTS } from "./claude-net.mjs";

const HOST = [{ label: "token değişimi", url: "https://ornek.invalid/v1/oauth/token" }];
const asil = globalThis.fetch;
const stub = (fn) => { globalThis.fetch = fn; };
const geriAl = () => { globalThis.fetch = asil; };

test("adresler CLI'nin gittigi yerler", () => {
  const urls = HOSTS.map((h) => h.url);
  assert.ok(urls.includes("https://platform.claude.com/v1/oauth/token"), "token değişimi adresi");
  assert.ok(urls.some((u) => u.includes("claude.com/cai/oauth/authorize")), "giriş sayfası adresi");
});

test("HERHANGI bir HTTP yaniti 'ulasildi' demektir (405 de dahil)", async () => {
  stub(async () => ({ status: 405 }));
  try {
    const r = await reachability({ hosts: HOST });
    assert.equal(r.ok, true);
    assert.equal(r.checks[0].status, 405);
    assert.match(summarize(r), /çıkışı var/);
    assert.match(summarize(r), /HTTP 405/);
  } finally { geriAl(); }
});

test("baglanti hatasi: ulasilamadi + sebep ozetle bildirilir", async () => {
  stub(async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
  try {
    const r = await reachability({ hosts: HOST });
    assert.equal(r.ok, false);
    assert.equal(r.checks[0].error, "ENOTFOUND");
    assert.match(summarize(r), /ULAŞILAMADI/);
    assert.match(summarize(r), /çıkış sorunlu/);
  } finally { geriAl(); }
});

test("zaman asimi ayri bir sebep olarak yazilir", async () => {
  stub(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); });
  try {
    const r = await reachability({ hosts: HOST, timeoutMs: 1234 });
    assert.equal(r.ok, false);
    assert.match(r.checks[0].error, /1234 ms içinde yanıt yok/);
  } finally { geriAl(); }
});

test("kimlik ve govde GONDERMEZ: yalniz GET, yonlendirme izlenmez", async () => {
  let gorulen = null;
  stub(async (url, opts) => { gorulen = { url, opts }; return { status: 200 }; });
  try {
    await reachability({ hosts: HOST });
    assert.equal(gorulen.opts.method, "GET");
    assert.equal(gorulen.opts.redirect, "manual");
    assert.equal(gorulen.opts.body, undefined, "gövde yok");
    assert.equal(gorulen.opts.headers, undefined, "başlık (dolayısıyla kimlik) yok");
  } finally { geriAl(); }
});
