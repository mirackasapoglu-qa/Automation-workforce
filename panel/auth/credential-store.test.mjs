/**
 * Kimlik deposu — kaynak önceliği, kayıt/silme, eski OAuth deposundan taşıma, şalter.
 * Koşum: node --test panel/auth/credential-store.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Depo process.cwd()/panel-data, dosya kaynagi os.homedir() — ikisi de gecici.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "credstore-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
process.env.HOME = home;
process.chdir(tmp);
delete process.env.ACME_TOKEN;
delete process.env.ACME_USER;

const store = await import("./credential-store.mjs");
const VARS = ["ACME_USER", "ACME_TOKEN"];

test("hicbir kaynak yokken ok:false, kaynak null", () => {
  const r = store.resolve("acme", VARS);
  assert.equal(r.ok, false);
  assert.equal(r.source, null);
});

test("dosya kaynagi: ~/.acme-credentials okunur", () => {
  fs.writeFileSync(path.join(home, ".acme-credentials"), "ACME_USER=dosya\nACME_TOKEN=dosya-tok\n");
  const r = store.resolve("acme", VARS);
  assert.equal(r.ok, true);
  assert.equal(r.source, "file");
  assert.equal(r.values.ACME_USER, "dosya");
});

test("panel kaydi dosyayi ezer, ortam ikisini de ezer", () => {
  store.save("acme", { kind: "apiKey", vars: { ACME_USER: "panel", ACME_TOKEN: " panel-tok " } });
  let r = store.resolve("acme", VARS);
  assert.equal(r.source, "store");
  assert.equal(r.values.ACME_TOKEN, "panel-tok", "deger kirpilir");
  assert.equal(r.kind, "apiKey");
  const f = path.join(tmp, "panel-data", "credentials", "acme.json");
  assert.ok(fs.existsSync(f));
  assert.equal(fs.statSync(f).mode & 0o777, 0o600, "0600 ile yazilir");
  process.env.ACME_USER = "env";
  process.env.ACME_TOKEN = "env-tok";
  r = store.resolve("acme", VARS);
  assert.equal(r.source, "env");
  assert.equal(r.values.ACME_USER, "env");
  delete process.env.ACME_USER;
  delete process.env.ACME_TOKEN;
});

test("oauth kaydi: source oauth, tokenType ve expiresAt doner", () => {
  store.save("acme", { kind: "oauth2", vars: { ACME_USER: "u", ACME_TOKEN: "at" }, tokenType: "Bearer", refreshToken: "rt", expiresAt: "2030-01-01T00:00:00.000Z" });
  const r = store.resolve("acme", VARS);
  assert.equal(r.source, "oauth");
  assert.equal(r.tokenType, "Bearer");
  assert.equal(r.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.equal(store.stored("acme").refreshToken, "rt");
});

test("remove: kayit silinir, dosya kaynagina duser", () => {
  const out = store.remove("acme");
  assert.equal(out.removed, true);
  assert.equal(store.resolve("acme", VARS).source, "file");
  assert.equal(store.remove("acme").removed, false);
});

test("eski panel-data/oauth/<svc>.json okunurken depoya TASINIR", () => {
  const legacy = path.join(tmp, "panel-data", "oauth", "legacy.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ service: "legacy", vars: { LEGACY_KEY: "tok" }, tokenType: "Bearer", refreshToken: "r", expiresAt: null, scope: "read", obtainedAt: "2026-09-01T00:00:00.000Z", team: "T" }));
  const rec = store.stored("legacy");
  assert.equal(rec.kind, "oauth2");
  assert.equal(rec.vars.LEGACY_KEY, "tok");
  assert.equal(rec.meta.team, "T");
  assert.ok(!fs.existsSync(legacy), "eski dosya kaldirildi");
  assert.ok(fs.existsSync(path.join(tmp, "panel-data", "credentials", "legacy.json")));
  assert.equal(store.resolve("legacy", ["LEGACY_KEY"]).source, "oauth");
});

test("save dogrulamasi: bos vars ve gecersiz ad reddedilir; servis adi temizlenir", () => {
  assert.throws(() => store.save("acme", { kind: "apiKey", vars: {} }), /kimlik degeri yok|kimlik değeri yok/);
  assert.throws(() => store.save("acme", { kind: "apiKey", vars: { "bad-name": "x" } }), /geçersiz/);
  assert.throws(() => store.save("../../etc", { kind: "apiKey", vars: { X: "1" } }), /servis adı/);
});

test("kopuk servis: kimlik VAR ama cozulmez (cut:true); geri baglaninca cozulur", async () => {
  const { setCut } = await import("../connectors/cuts.mjs");
  setCut("acme", true);
  const r = store.resolve("acme", VARS);
  assert.equal(r.ok, false);
  assert.equal(r.cut, true);
  setCut("acme", false);
  assert.equal(store.resolve("acme", VARS).ok, true);
});

test("sourceLabel insan dili", () => {
  assert.equal(store.sourceLabel("store"), "panel kaydı");
  assert.equal(store.sourceLabel("oauth"), "OAuth");
  assert.equal(store.sourceLabel(null), "yok");
});
