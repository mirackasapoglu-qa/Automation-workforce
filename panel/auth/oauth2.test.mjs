/**
 * OAuth2 çekirdeği — izin adresi (PKCE), callback → depo, yenileme (tek uçuş), durum.
 * AĞA ÇIKMAZ: fetch sahte. Koşum: node --test panel/auth/oauth2.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oauth2-"));
process.env.HOME = path.join(tmp, "home"); fs.mkdirSync(process.env.HOME);
process.chdir(tmp);
const DATA_DIR = path.join(tmp, "panel-data");
process.env.ACME_CLIENT_ID = "cid";
process.env.ACME_CLIENT_SECRET = "csec";

const oauth2 = await import("./oauth2.mjs");
const store = await import("./credential-store.mjs");

const CFG = {
  label: "Acme", authorizeUrl: "https://acme.test/oauth/authorize", tokenUrl: "https://acme.test/oauth/token",
  scope: "read write", var: "ACME_TOKEN", tokenType: "Bearer", pkce: true,
};
const realFetch = globalThis.fetch;
let calls = [];
function mockToken(bodies) {
  calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, params: Object.fromEntries(new URLSearchParams(init.body)) });
    const b = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify(b.body ?? b), { status: b.status ?? 200, headers: { "content-type": "application/json" } });
  };
}
test.after(() => { globalThis.fetch = realFetch; });

test("authorizeUrl: client id, redirect, scope, state, PKCE S256", () => {
  const u = new URL(oauth2.authorizeUrl({ dataDir: DATA_DIR, svc: "acme", cfg: CFG, origin: "https://panel.example" }));
  assert.equal(u.origin + u.pathname, "https://acme.test/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("redirect_uri"), "https://panel.example/api/oauth/callback");
  assert.equal(u.searchParams.get("scope"), "read write");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.ok(u.searchParams.get("state")?.length === 32);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("code_challenge"));
  assert.equal(oauth2.pendingCount(), 1);
});

test("client kaydi yoksa authorizeUrl firlatir", () => {
  assert.throws(() => oauth2.authorizeUrl({ dataDir: DATA_DIR, svc: "nope", cfg: CFG, origin: "https://p" }), /kayıtlı değil/);
});

test("callback: state dogrular, code'u token'a cevirir (code_verifier ile), depoya yazar", async () => {
  const u = new URL(oauth2.authorizeUrl({ dataDir: DATA_DIR, svc: "acme", cfg: CFG, origin: "https://panel.example" }));
  const state = u.searchParams.get("state");
  mockToken([{ access_token: "AT1", refresh_token: "RT1", expires_in: 3600, scope: "read write" }]);
  const r = await oauth2.handleCallback({ dataDir: DATA_DIR, query: new URLSearchParams({ code: "C1", state }), origin: "https://panel.example", cfgFor: () => CFG });
  assert.equal(r.svc, "acme");
  assert.equal(calls[0].params.grant_type, "authorization_code");
  assert.equal(calls[0].params.code, "C1");
  assert.equal(calls[0].params.redirect_uri, "https://panel.example/api/oauth/callback");
  assert.ok(calls[0].params.code_verifier, "PKCE verifier gonderildi");
  const rec = store.stored("acme");
  assert.equal(rec.kind, "oauth2");
  assert.equal(rec.vars.ACME_TOKEN, "AT1");
  assert.equal(rec.refreshToken, "RT1");
  assert.ok(rec.expiresAt);
  assert.equal(store.resolve("acme", ["ACME_TOKEN"]).source, "oauth");
  // state tek kullanimlik
  await assert.rejects(oauth2.handleCallback({ dataDir: DATA_DIR, query: new URLSearchParams({ code: "C2", state }), origin: "https://panel.example", cfgFor: () => CFG }), /state/);
});

test("callback: saglayici reddi ve bilinmeyen state", async () => {
  const u = new URL(oauth2.authorizeUrl({ dataDir: DATA_DIR, svc: "acme", cfg: CFG, origin: "https://p" }));
  const state = u.searchParams.get("state");
  await assert.rejects(oauth2.handleCallback({ dataDir: DATA_DIR, query: new URLSearchParams({ error: "access_denied", state }), origin: "https://p", cfgFor: () => CFG }), /reddetti/);
  await assert.rejects(oauth2.handleCallback({ dataDir: DATA_DIR, query: new URLSearchParams({ code: "x", state: "yok" }), origin: "https://p", cfgFor: () => CFG }), /state/);
});

test("ensureFresh: suresi uzaksa dokunmaz; dolmak uzereyse yeniler; eszamanli cagrilar TEK istek", async () => {
  store.save("acme", { kind: "oauth2", vars: { ACME_TOKEN: "AT1" }, refreshToken: "RT1", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  mockToken([{ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 }]);
  let r = await oauth2.ensureFresh({ dataDir: DATA_DIR, svc: "acme", cfg: CFG });
  assert.equal(r.refreshed, false);
  assert.equal(calls.length, 0);

  store.save("acme", { kind: "oauth2", vars: { ACME_TOKEN: "AT1" }, refreshToken: "RT1", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => oauth2.ensureFresh({ dataDir: DATA_DIR, svc: "acme", cfg: CFG })));
  assert.equal(calls.length, 1, "tek ucus");
  assert.equal(calls[0].params.grant_type, "refresh_token");
  assert.equal(calls[0].params.refresh_token, "RT1");
  assert.ok(a.refreshed && b.refreshed && c.refreshed);
  const rec = store.stored("acme");
  assert.equal(rec.vars.ACME_TOKEN, "AT2");
  assert.equal(rec.refreshToken, "RT2", "donen refresh token eskisinin yerine yazildi");
});

test("ensureFresh: refresh token yoksa yenilemez, sebep soyler; apiKey kaydinda dokunmaz", async () => {
  store.save("acme", { kind: "oauth2", vars: { ACME_TOKEN: "AT" }, refreshToken: null, expiresAt: new Date(Date.now() + 1000).toISOString() });
  mockToken([{ access_token: "X" }]);
  const r = await oauth2.ensureFresh({ dataDir: DATA_DIR, svc: "acme", cfg: CFG });
  assert.equal(r.refreshed, false);
  assert.match(r.reason, /refresh token/);
  store.save("acme", { kind: "apiKey", vars: { ACME_TOKEN: "pat" } });
  assert.equal((await oauth2.ensureFresh({ dataDir: DATA_DIR, svc: "acme", cfg: CFG })).refreshed, false);
  assert.equal(calls.length, 0);
});

test("statusFor: kayit, baglanti, yenilenebilirlik ve geri donus adresi", () => {
  store.save("acme", { kind: "oauth2", vars: { ACME_TOKEN: "AT" }, refreshToken: "RT", expiresAt: "2030-01-01T00:00:00.000Z" });
  const s = oauth2.statusFor({ dataDir: DATA_DIR, svc: "acme", cfg: CFG, origin: "https://panel.example" });
  assert.equal(s.supported, true);
  assert.equal(s.clientReady, true);
  assert.equal(s.clientSource, "env");
  assert.equal(s.connected, true);
  assert.equal(s.canRefresh, true);
  assert.equal(s.redirectUri, "https://panel.example/api/oauth/callback");
  assert.equal(oauth2.statusFor({ dataDir: DATA_DIR, svc: "acme", cfg: null, origin: "x" }).supported, false);
});

test("saveClientCreds dosyaya yazar, env yoksa oradan okunur", () => {
  delete process.env.ACME_CLIENT_ID;
  delete process.env.ACME_CLIENT_SECRET;
  assert.equal(oauth2.clientCreds(DATA_DIR, "acme"), null);
  oauth2.saveClientCreds(DATA_DIR, "acme", " id ", " sec ");
  assert.deepEqual(oauth2.clientCreds(DATA_DIR, "acme"), { id: "id", secret: "sec", source: "file" });
});
