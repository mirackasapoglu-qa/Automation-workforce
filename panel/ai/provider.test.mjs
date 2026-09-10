/**
 * Sağlayıcı sırası, bütçe tavanı ve eşzamanlılık kapısı — AĞA ÇIKMAZ.
 * Koşum: node --test panel/ai/provider.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-prov-"));
process.chdir(tmp); // panel-data/ai-usage.jsonl buraya yazilsin, repo kirlenmesin
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AI_PROVIDER;
delete process.env.AI_DAILY_USD;
process.env.CLAUDE_BIN = path.join(tmp, "yok-boyle-bir-cli");

const ai = await import("./provider.mjs");
const budget = await import("./budget.mjs");

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

const okBody = (text, usage = { input_tokens: 1000, output_tokens: 100 }) => ({
  model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text }], usage,
});
const mock = (bodies, delayMs = 0) => {
  let i = 0;
  globalThis.fetch = async () => {
    const b = bodies[Math.min(i++, bodies.length - 1)];
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  };
};

test("hicbir sey yokken mode=manual, ask NO_PROVIDER (501)", async () => {
  assert.equal(ai.mode(), "manual");
  assert.equal(ai.status().oneClick, false);
  await assert.rejects(ai.ask({ purpose: "t", user: "U" }), (e) => e.code === "NO_PROVIDER");
  assert.equal(ai.httpStatusFor("NO_PROVIDER"), 501);
});

test("CLAUDE_BIN calistirilabilir bir dosyaya isaret edince mode=cli", async () => {
  const bin = path.join(tmp, "claude");
  fs.writeFileSync(bin, "#!/bin/sh\necho hi\n", { mode: 0o755 });
  process.env.CLAUDE_BIN = bin;
  // CLI'nin KENDI oturumu: Linux'ta <config dir>/.credentials.json aranir.
  const cfg = fs.mkdtempSync(path.join(tmp, "cfg-"));
  fs.writeFileSync(path.join(cfg, ".credentials.json"), "{}");
  process.env.CLAUDE_CONFIG_DIR = cfg;
  ai.resetCliCache(); // 60 sn PATH onbellegi — testte acikca dusurulur
  assert.equal(ai.mode(), "cli");
  assert.equal(ai.status().cliBin, bin);
  process.env.CLAUDE_BIN = path.join(tmp, "yok");
  delete process.env.CLAUDE_CONFIG_DIR;
  ai.resetCliCache();
});

test("CLI kurulu ama OTURUMSUZ: tek tik acilmaz (sunucudaki imaj hali)", async () => {
  // Sunucuda CLI relay icin kurulu; kimse giris yapmamis olabilir. Eskiden
  // panel bu durumda "tek tik uretim acik" diyordu ve her uretim kimlik
  // hatasiyla dusuyordu (olculdu 2026-09-10).
  const bin = path.join(tmp, "claude");
  fs.writeFileSync(bin, "#!/bin/sh\necho hi\n", { mode: 0o755 });
  process.env.CLAUDE_BIN = bin;
  const bos = fs.mkdtempSync(path.join(tmp, "bos-cfg-"));   // .credentials.json YOK
  process.env.CLAUDE_CONFIG_DIR = bos;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  ai.resetCliCache();
  const beklenen = process.platform === "linux" ? "manual" : "cli"; // macOS'ta kimlik Keychain'de olabilir
  assert.equal(ai.mode(), beklenen);
  assert.equal(ai.status().oneClick, beklenen !== "manual");

  // Token verilmisse (hesap yolu) oturum vardir.
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-test";
  ai.resetCliCache();
  assert.equal(ai.mode(), "cli", "token verilince ciplak CLI yolu acilir");

  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_BIN = path.join(tmp, "yok");
  ai.resetCliCache();
});

test("anahtar varken api yolu; CLI olsa bile anahtar once gelir", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  ai.resetCliCache();
  assert.equal(ai.mode(), "api");
  assert.equal(ai.status().model, "claude-opus-5");
  process.env.AI_PROVIDER = "manual";
  assert.equal(ai.mode(), "manual", "AI_PROVIDER=manual sirayi ezer");
  delete process.env.AI_PROVIDER;
});

test("stable zemin API yolunda ayri sistem blogu olarak gider, CLI yolunda metne eklenir", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  let body = null;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify(okBody("x")), { status: 200 }); };
  await ai.ask({ purpose: "t", system: "S", stable: "ZEMIN", user: "U" });
  assert.equal(body.system.length, 2);
  assert.equal(body.system[1].text, "ZEMIN");
  assert.equal(body.system[1].cache_control, undefined, "kisa zemin: bayrak yok");
});

test("api yolunda ask: json doner, deftere yazilir, harcama toplanir", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  mock([okBody('{"items":[]}')]);
  const r = await ai.ask({ purpose: "t", system: "S", user: "U", schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false } });
  assert.equal(r.provider, "api");
  assert.deepEqual(r.json, { items: [] });
  const s = budget.spentToday();
  assert.ok(s.calls >= 1, "defterde en az bu cagri var (onceki testler de yazmis olabilir)");
  assert.ok(s.usd > 0);
  assert.ok(fs.existsSync(path.join(tmp, "panel-data", "ai-usage.jsonl")));
});

test("gunluk tavan dolunca BUDGET (429), aga cikilmaz", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  // 1M girdi token = $5 → tavani asar
  mock([okBody("x", { input_tokens: 1_000_000, output_tokens: 0 })]);
  await ai.ask({ purpose: "t", user: "U" });
  process.env.AI_DAILY_USD = "1";
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  await assert.rejects(ai.ask({ purpose: "t", user: "U" }), (e) => e.code === "BUDGET");
  assert.equal(called, false);
  assert.equal(ai.httpStatusFor("BUDGET"), 429);
  delete process.env.AI_DAILY_USD;
});

test("basarisiz cagri da deftere duser (ok:false)", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401 });
  await assert.rejects(ai.ask({ purpose: "t", user: "U" }), (e) => e.code === "AUTH");
  const lines = fs.readFileSync(path.join(tmp, "panel-data", "ai-usage.jsonl"), "utf8").trim().split("\n");
  const last = JSON.parse(lines.at(-1));
  assert.equal(last.ok, false);
  assert.equal(last.code, "AUTH");
});

test("eszamanlilik: 1 slot + 4 kuyruk, fazlasi BUSY", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.AI_MAX_CONCURRENCY = "1";
  mock([okBody("x")], 30);
  const results = await Promise.allSettled(Array.from({ length: 7 }, () => ai.ask({ purpose: "t", user: "U" })));
  const busy = results.filter((r) => r.status === "rejected" && r.reason.code === "BUSY").length;
  const ok = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(busy, 2);
  assert.equal(ok, 5);
  assert.deepEqual(budget.slotState(), { running: 0, waiting: 0, max: 1 });
  delete process.env.AI_MAX_CONCURRENCY;
});

test("hata kodu → HTTP ve ipucu eslemesi", () => {
  assert.equal(ai.httpStatusFor("TIMEOUT"), 504);
  assert.equal(ai.httpStatusFor("REFUSAL"), 422);
  assert.equal(ai.httpStatusFor("BUSY"), 429);
  assert.equal(ai.httpStatusFor("WHATEVER"), 502);
  assert.match(ai.hintFor("NO_PROVIDER"), /ANTHROPIC_API_KEY/);
});
