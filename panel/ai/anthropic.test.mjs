/**
 * Anthropic istemcisi — AĞA ÇIKMAZ. `fetch` sahte; istek gövdesinin API
 * sözleşmesine uyduğu ve hata kodlarının doğru eşlendiği ölçülür.
 * Koşum: node --test panel/ai/anthropic.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Kimlik: env üzerinden (dosya/OAuth okuyucu boş kalsın diye geçici cwd).
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ai-test-")));
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.AI_RETRY_MS = "1"; // tekrar beklemesi testte 2 sn olmasin
delete process.env.AI_MODEL;
delete process.env.AI_EFFORT;

const { complete, estimateCost, settings, buildSystemBlocks } = await import("./anthropic.mjs");

test("onbellek bayragi YALNIZCA sabit onek esigi asinca konur (kisa istemde sus olmaz)", () => {
  const kisa = buildSystemBlocks({ system: "kurallar", stable: "kisa zemin", cacheMinTokens: 1100 });
  assert.equal(kisa.length, 2);
  assert.equal(kisa[1].cache_control, undefined);
  const uzun = buildSystemBlocks({ system: "kurallar", stable: "x".repeat(4400), cacheMinTokens: 1100 });
  assert.deepEqual(uzun[1].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(uzun[0].cache_control, undefined, "bayrak sabit blokta, talimatta degil");
  assert.equal(buildSystemBlocks({ system: "", stable: "", cacheMinTokens: 1100 }).length, 0);
});

const realFetch = globalThis.fetch;
const calls = [];
function mockFetch(responses) {
  calls.length = 0;
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (typeof r === "function") return r();
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", "request-id": "req_1", ...(r.headers ?? {}) } });
  };
}
test.after(() => { globalThis.fetch = realFetch; });

const okBody = (text, extra = {}) => ({
  model: "claude-opus-5", stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ...extra,
});

test("istek govdesi sozlesmeye uyar: basliklar, system cache, adaptive thinking, effort, sema", async () => {
  mockFetch([{ body: okBody('{"a":1}', { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 } }) }]);
  const r = await complete({ system: "S", stable: "z".repeat(4800), user: "U", schema: { type: "object", properties: { a: { type: "integer" } }, required: ["a"], additionalProperties: false } });
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.headers["x-api-key"], "sk-test");
  assert.equal(c.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.model, "claude-opus-5");
  assert.equal(c.body.system[0].text, "S");
  assert.deepEqual(c.body.system[1].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(r.cache, { read: 1200, write: 0, flagged: true });
  assert.deepEqual(c.body.thinking, { type: "adaptive" });
  assert.equal(c.body.output_config.effort, "high");
  assert.equal(c.body.output_config.format.type, "json_schema");
  assert.deepEqual(c.body.messages, [{ role: "user", content: "U" }]);
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(r.requestId, "req_1");
  assert.ok(r.costUsd > 0);
});

test("haiku'da thinking/effort gonderilmez (400 verir)", async () => {
  process.env.AI_MODEL = "claude-haiku-4-5";
  mockFetch([{ body: okBody("x", { model: "claude-haiku-4-5" }) }]);
  await complete({ user: "U" });
  assert.equal(calls[0].body.thinking, undefined);
  assert.equal(calls[0].body.output_config, undefined);
  delete process.env.AI_MODEL;
});

test("429 sonrasi bir kez tekrar eder ve basarili yaniti dondurur", async () => {
  mockFetch([{ status: 429, body: { error: { message: "slow down" } }, headers: { "retry-after": "0" } }, { body: okBody("ok") }]);
  const r = await complete({ user: "U" });
  assert.equal(r.text, "ok");
  assert.equal(calls.length, 2);
});

test("ikinci 429 RATE_LIMIT kodu ile firlar", async () => {
  mockFetch([{ status: 429, body: { error: { message: "slow" } }, headers: { "retry-after": "0" } }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "RATE_LIMIT" && e.status === 429);
});

test("401 → AUTH, 400 → BAD_REQUEST, 500 (tekrar sonrasi) → API_ERROR", async () => {
  mockFetch([{ status: 401, body: { error: { message: "bad key" } } }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "AUTH");
  mockFetch([{ status: 400, body: { error: { message: "schema" } } }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "BAD_REQUEST");
  mockFetch([{ status: 500, body: { error: { message: "boom" } } }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "API_ERROR");
});

test("refusal ve max_tokens icerik okunmadan hata olur", async () => {
  mockFetch([{ body: okBody("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "x" } }) }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "REFUSAL");
  mockFetch([{ body: okBody("{\"a\":", { stop_reason: "max_tokens" }) }]);
  await assert.rejects(complete({ user: "U", schema: { type: "object", additionalProperties: false } }), (e) => e.code === "TRUNCATED");
});

test("semali yanit JSON degilse BAD_JSON", async () => {
  mockFetch([{ body: okBody("not json") }]);
  await assert.rejects(complete({ user: "U", schema: { type: "object", additionalProperties: false } }), (e) => e.code === "BAD_JSON");
});

test("zaman asimi TIMEOUT", async () => {
  process.env.AI_TIMEOUT_MS = "10000"; // alt sinir 10 sn; abort'u sinyalle tetikliyoruz
  mockFetch([() => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("aborted"), { name: "AbortError" })), 5))]);
  // fetch abort'u taklit: sinyal disaridan
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 1);
  await assert.rejects(complete({ user: "U", signal: ac.signal }), (e) => e.code === "TIMEOUT");
  delete process.env.AI_TIMEOUT_MS;
});

test("anahtar yoksa NO_KEY, aga cikilmaz", async () => {
  const k = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  mockFetch([{ body: okBody("x") }]);
  await assert.rejects(complete({ user: "U" }), (e) => e.code === "NO_KEY");
  assert.equal(calls.length, 0);
  process.env.ANTHROPIC_API_KEY = k;
});

test("maliyet tahmini liste fiyatiyla, bilinmeyen modelde null", () => {
  const usd = estimateCost({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }, "claude-opus-5");
  // 5 + 2.5 + 0.5
  assert.equal(usd, 8);
  assert.equal(estimateCost({ input_tokens: 1 }, "bilinmeyen-model"), null);
  assert.equal(settings().model, "claude-opus-5");
});
