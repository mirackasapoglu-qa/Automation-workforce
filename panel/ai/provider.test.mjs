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
  // 60 sn onbellek: yeni modul ornegi ile olc
  const fresh = await import(`./provider.mjs?cli=${Date.now()}`);
  assert.equal(fresh.mode(), "cli");
  assert.equal(fresh.status().cliBin, bin);
  process.env.CLAUDE_BIN = path.join(tmp, "yok");
});

test("anahtar varken api yolu; CLI olsa bile anahtar once gelir", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const fresh = await import(`./provider.mjs?api=${Date.now()}`);
  assert.equal(fresh.mode(), "api");
  assert.equal(fresh.status().model, "claude-opus-5");
  process.env.AI_PROVIDER = "manual";
  assert.equal(fresh.mode(), "manual", "AI_PROVIDER=manual sirayi ezer");
  delete process.env.AI_PROVIDER;
});

test("api yolunda ask: json doner, deftere yazilir, harcama toplanir", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  mock([okBody('{"items":[]}')]);
  const r = await ai.ask({ purpose: "t", system: "S", user: "U", schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false } });
  assert.equal(r.provider, "api");
  assert.deepEqual(r.json, { items: [] });
  const s = budget.spentToday();
  assert.equal(s.calls, 1);
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
