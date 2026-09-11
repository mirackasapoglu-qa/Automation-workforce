/**
 * Tarama kapısı — hedef denetimi ve hız sınırı, ağ ve tarayıcı olmadan.
 * Koşum: node --test panel/crawl-guard.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateTarget, createRateLimiter, isPrivateAddress, clientKey } from "./crawl-guard.mjs";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const privateDns = async () => [{ address: "10.0.0.5", family: 4 }];

test("sema: yalnizca http/https", async () => {
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x.com", "data:text/html,hi", "gopher://x"]) {
    const r = await validateTarget(bad, { lookup: publicDns });
    assert.equal(r.ok, false, bad);
  }
  assert.equal((await validateTarget("https://example.com/a?b=1", { lookup: publicDns })).ok, true);
});

test("bos, bozuk, cok uzun, kimlikli adres reddedilir", async () => {
  assert.equal((await validateTarget("", {})).ok, false);
  assert.equal((await validateTarget("siten.com", {})).ok, false, "semasiz");
  assert.equal((await validateTarget("https://" + "a".repeat(2100) + ".com", {})).ok, false);
  assert.equal((await validateTarget("https://user:pass@example.com", { lookup: publicDns })).ok, false);
});

test("ic/yerel IP literalleri reddedilir", async () => {
  const bad = [
    "http://127.0.0.1:4646/api/meta", "http://0.0.0.0/", "http://10.1.2.3/", "http://172.16.0.1/",
    "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/", "http://[::1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/",
  ];
  for (const u of bad) assert.equal((await validateTarget(u, {})).ok, false, u);
  assert.equal((await validateTarget("http://172.32.0.1/", {})).ok, true, "172.32 ozel degil");
  assert.equal((await validateTarget("http://8.8.8.8/", {})).ok, true);
});

test("ic ag alan adlari ve DNS'i ic IP'ye cozulen adlar reddedilir", async () => {
  for (const u of ["http://localhost/", "http://localhost:3000/", "http://panel.local/", "http://db.internal/", "http://intranet/", "http://svc.lan/"]) {
    assert.equal((await validateTarget(u, { lookup: publicDns })).ok, false, u);
  }
  const r = await validateTarget("https://gizli-ic.example.com/", { lookup: privateDns });
  assert.equal(r.ok, false, "DNS rebinding");
  assert.match(r.error, /iç ağ/i);
  const r2 = await validateTarget("https://yok.example.invalid/", { lookup: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal(r2.ok, false);
});

test("projenin kendi host'u ve allowPrivate ic adresi serbest birakir", async () => {
  assert.equal((await validateTarget("http://localhost:3000/x", { projectBaseUrl: "http://localhost:3000" })).ok, true);
  assert.equal((await validateTarget("http://localhost:3001/x", { projectBaseUrl: "http://localhost:3000" })).ok, false, "farkli port = farkli host");
  assert.equal((await validateTarget("http://192.168.1.20/", { allowPrivate: true })).ok, true);
  assert.equal((await validateTarget("file:///x", { allowPrivate: true })).ok, false, "allowPrivate semayi acmaz");
});

test("isPrivateAddress: IP olmayan girdi guvenli tarafta", () => {
  assert.equal(isPrivateAddress("not-an-ip"), true);
  assert.equal(isPrivateAddress("1.1.1.1"), false);
});

test("hiz siniri: pencere icinde limit, sonra serbest", () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.take("a").ok, true);
  assert.equal(rl.take("a").ok, true);
  assert.equal(rl.take("a").ok, true);
  const dolu = rl.take("a");
  assert.equal(dolu.ok, false);
  assert.equal(dolu.retryAfterSec, 1);
  assert.equal(rl.take("b").ok, true, "baska istemci etkilenmez");
  t = 1001;
  assert.equal(rl.take("a").ok, true, "pencere gecince acilir");
});

test("clientKey: XFF ilk adres, yoksa soket", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }), "1.2.3.4");
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "::1" } }), "::1");
  assert.equal(clientKey({ headers: {} }), "unknown");
});
