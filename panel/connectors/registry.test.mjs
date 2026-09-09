/**
 * Kayıt defteri — otomatik keşif, sağlayıcı yüzeyi, kimlik özeti, preflight satırları.
 * Ağa çıkmaz: bu ortamda hiçbir kimlik yok; MobAI köprüsü kapalı.
 * Koşum: PANEL_PROJECT=<profil> node --test panel/connectors/registry.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MOBAI_BRIDGE = "off";
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "registry-home-")); // ~/.<svc>-credentials gorulmesin
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "registry-cwd-"))); // panel-data (onbellek, kayit) repoya yazilmasin
for (const k of ["JIRA_EMAIL", "JIRA_TOKEN", "FIGMA_TOKEN", "ANTHROPIC_API_KEY", "LINEAR_API_KEY", "SLACK_BOT_TOKEN", "CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN"]) delete process.env[k];
process.env.AI_PROVIDER = "manual";

const reg = await import("./index.mjs");

test("providers/*.mjs otomatik kesfedilir, zorunlu yuzey tam", () => {
  const keys = Object.keys(reg.ALL).sort();
  assert.deepEqual(keys, ["claude-code", "confluence", "figma", "jira", "linear", "mobai", "slack"]);
  for (const m of Object.values(reg.ALL)) {
    for (const r of ["key", "label", "capabilities", "configured", "check"]) assert.ok(m[r] != null, `${m.key}: ${r}`);
    assert.ok(typeof m.auth === "object", `${m.key}: auth bildirimi`);
    for (const cap of m.capabilities) assert.ok(typeof m[cap] === "object" || cap === "ai", `${m.key}: ${cap} yetenek nesnesi`);
  }
});

test("kimlik bildirimi: apiKey vars {name,label,secret}; oauth2 yalniz linear ve slack'te", () => {
  const withApiKey = Object.values(reg.ALL).filter((m) => m.auth.apiKey).map((m) => m.key).sort();
  assert.deepEqual(withApiKey, ["claude-code", "confluence", "figma", "jira", "linear", "slack"]);
  const withOauth = Object.values(reg.ALL).filter((m) => m.auth.oauth2).map((m) => m.key).sort();
  assert.deepEqual(withOauth, ["linear", "slack"]);
  for (const m of Object.values(reg.ALL)) {
    for (const v of m.auth.apiKey?.vars ?? []) assert.match(v.name, /^[A-Z][A-Z0-9_]*$/);
    // Eski yuzey korunuyor: credential.vars = auth.apiKey.vars adlari
    if (m.auth.apiKey) assert.deepEqual(m.credential.vars, m.auth.apiKey.vars.map((v) => v.name));
  }
  assert.deepEqual(reg.ALL.mobai.auth, {}, "yerel kopru: girilecek kimlik yok");
});

test("preflight satirlari: auth ozeti, kaynak, sira", async () => {
  const rows = await reg.preflight([], { origin: "https://panel.example" });
  const keys = rows.map((r) => r.key);
  assert.equal(keys[0], "claude-code", "order=10 ilk");
  assert.ok(keys.indexOf("figma") < keys.indexOf("jira"));
  const jira = rows.find((r) => r.key === "jira");
  assert.equal(jira.auth.apiKey.connected, false);
  assert.equal(jira.auth.apiKey.vars.length, 2);
  assert.equal(jira.auth.apiKey.vars[1].secret, true);
  assert.equal(jira.credentialSource, null);
  assert.equal(jira.state, "off");
  const linear = rows.find((r) => r.key === "linear");
  assert.equal(linear.auth.oauth2.supported, true);
  assert.equal(linear.auth.oauth2.redirectUri, "https://panel.example/api/oauth/callback");
  assert.equal(linear.oauth, linear.auth.oauth2, "geriye donuk `oauth` alani");
  assert.equal(linear.passive, true, "bu projede kullanilmiyor");
  const mobai = rows.find((r) => r.key === "mobai");
  assert.equal(mobai.state, "off");
  assert.deepEqual(mobai.auth, {});
});

test("capability(): profil eslemesi, bilinmeyen yetenek reddi", () => {
  assert.equal(reg.tracker(), reg.ALL.jira.tracker);
  assert.throws(() => reg.setCapability("uydurma", "jira"), /Bilinmeyen yetenek/);
  assert.throws(() => reg.setCapability("chat", "jira"), /yeteneğini sunmuyor/);
});
