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

// -------------------------------------------------- derin teşhis (diagnose)

test("diagnose: IPv6 ZAMAN ASIMI kara delik sayilir, ANLIK hata sayilmaz", async () => {
  const { diagnose } = await import("./claude-net.mjs");
  const dns = await import("node:dns/promises");
  const net = await import("node:net");
  const asilLookup = dns.default.lookup, asilR4 = dns.default.resolve4, asilR6 = dns.default.resolve6;
  const asilConnect = net.default.connect;
  dns.default.lookup = async () => [{ address: "1.2.3.4", family: 4 }];
  dns.default.resolve4 = async () => ["1.2.3.4"];
  dns.default.resolve6 = async () => ["2600::1"];
  // IPv4 baglanir, IPv6 zaman asimina duser.
  net.default.connect = ({ host }) => {
    const ev = {};
    const s = { once: (k, f) => { ev[k] = f; return s; }, destroy: () => {} };
    setImmediate(() => (host === "1.2.3.4" ? ev.connect?.() : ev.timeout?.()));
    return s;
  };
  try {
    const d = await diagnose({ host: "ornek.invalid", timeoutMs: 50 });
    assert.equal(d.ipv4, true);
    assert.equal(d.ipv6, false);
    assert.equal(d.ipv6KaraDelik, true, "zaman aşımı = kara delik");
    assert.match(d.ozet, /IPv6 KARA DELİK/);
    assert.match(d.ozet, /bun düşmez/);
  } finally {
    dns.default.lookup = asilLookup; dns.default.resolve4 = asilR4; dns.default.resolve6 = asilR6;
    net.default.connect = asilConnect;
  }
});

test("diagnose: vekil degiskeni bildirilir, parola MASKELENIR", async () => {
  const { diagnose } = await import("./claude-net.mjs");
  const dns = await import("node:dns/promises");
  const asilLookup = dns.default.lookup, asilR4 = dns.default.resolve4, asilR6 = dns.default.resolve6;
  dns.default.lookup = async () => [{ address: "1.2.3.4", family: 4 }];
  dns.default.resolve4 = async () => [];
  dns.default.resolve6 = async () => [];
  process.env.HTTPS_PROXY = "http://kullanici:gizliparola@vekil.local:3128";
  try {
    const d = await diagnose({ host: "ornek.invalid", timeoutMs: 50 });
    assert.equal(d.proxy[0].name, "HTTPS_PROXY");
    assert.ok(!d.proxy[0].value.includes("gizliparola"), "parola sızmaz");
    assert.match(d.proxy[0].value, /\/\/\*\*\*@vekil\.local/);
    assert.match(d.ozet, /vekil değişkeni tanımlı/);
  } finally {
    delete process.env.HTTPS_PROXY;
    dns.default.lookup = asilLookup; dns.default.resolve4 = asilR4; dns.default.resolve6 = asilR6;
  }
});

test("diagnose: IPv6 ANINDA hata veriyorsa suclanmaz (yanlis teshis duzeltmesi)", async () => {
  // Olculdu: gelistirici Docker'i da ayni profili veriyor (IPv4 bagli, IPv6
  // ENETUNREACH) ve orada CLI sorunsuz calisiyor — bu profil suclu DEGIL.
  const { diagnose } = await import("./claude-net.mjs");
  const dns = await import("node:dns/promises");
  const net = await import("node:net");
  const [aL, a4, a6, aC] = [dns.default.lookup, dns.default.resolve4, dns.default.resolve6, net.default.connect];
  dns.default.lookup = async () => [{ address: "1.2.3.4", family: 4 }];
  dns.default.resolve4 = async () => ["1.2.3.4"];
  dns.default.resolve6 = async () => ["2600::1"];
  net.default.connect = ({ host }) => {
    const ev = {};
    const s = { once: (k, f) => { ev[k] = f; return s; }, destroy: () => {} };
    setImmediate(() => (host === "1.2.3.4" ? ev.connect?.() : ev.error?.(Object.assign(new Error("x"), { code: "ENETUNREACH" }))));
    return s;
  };
  try {
    const d = await diagnose({ host: "ornek.invalid", timeoutMs: 50 });
    assert.equal(d.ipv6KaraDelik, false);
    assert.deepEqual(d.sebepler, [], "anlık hata sebep listesine GİRMEZ");
    assert.match(d.ozet, /NORMAL, istemci IPv4'e düşer/);
  } finally {
    dns.default.lookup = aL; dns.default.resolve4 = a4; dns.default.resolve6 = a6; net.default.connect = aC;
  }
});
