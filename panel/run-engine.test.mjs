/**
 * Koşum motoru — GERÇEK alt süreçlerle (node -e), Playwright'sız.
 * Tek slot, idempotency, kuyruk boşalması, durdurma, spawn hatası, kapsam yazımı.
 * Koşum: node --test panel/run-engine.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRunEngine } from "./run-engine.mjs";

const NODE = process.execPath;
const RUNS = {
  quick: { label: "Hizli (headed)", cmd: NODE, args: ["-e", "setTimeout(()=>console.log('bitti'),120)"] },
  slow: { label: "Yavas", cmd: NODE, args: ["-e", "console.error('err-satir');setTimeout(()=>{},3000)"] },
  fail: { label: "Duser", cmd: NODE, args: ["-e", "process.exit(2)"] },
  missing: { label: "Yok", cmd: "kesinlikle-olmayan-ikili-xyz", args: [] },
};

function makeEngine(extra = {}) {
  const events = [];
  const audits = [];
  const journal = { started: [], finished: [], start(x) { journal.started.push(x); return `j${journal.started.length}`; }, finish(id, x) { journal.finished.push({ id, ...x }); } };
  const engine = createRunEngine({
    root: process.cwd(), runs: RUNS, pkgScripts: {},
    buildCustomArgs: (p) => (p?.bad ? { args: [], errors: ["kotu parametre"] } : { args: ["-e", "1"], errors: [] }),
    broadcast: (event, data) => events.push({ event, data }),
    audit: (e) => audits.push(e),
    journal, mergeHistory: () => {}, lastResults: () => ({ counts: { passed: 1 } }),
    dedupeMs: 60_000, queueLimit: 3,
    ...extra,
  });
  return { engine, events, audits, journal };
}

const waitFor = (fn, ms = 4000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function tick() { if (fn()) return resolve(); if (Date.now() - t0 > ms) return reject(new Error("zaman asimi")); setTimeout(tick, 15); })();
});
const ended = (events, n = 1) => () => events.filter((e) => e.event === "run-end").length >= n;

test("tek slot: ikinci istek BUSY, kosum bitince run-end ve journal.finish", async () => {
  const { engine, events, journal } = makeEngine();
  const r = engine.start("quick");
  assert.equal(r.ok, true);
  assert.equal(engine.isRunning(), true);
  const b = engine.start("quick");
  assert.equal(b.code, "BUSY");
  assert.equal(b.active.id, "quick");
  await waitFor(ended(events));
  assert.equal(engine.isRunning(), false);
  const end = events.find((e) => e.event === "run-end").data;
  assert.equal(end.code, 0);
  assert.ok(events.some((e) => e.event === "log" && e.data.line === "bitti"));
  assert.equal(journal.finished[0].code, 0);
  assert.deepEqual(journal.finished[0].counts, { passed: 1 });
});

test("headless donusumu: --headed argv'den duser; npm script'i dogrudan playwright cagrisina cevrilir", async () => {
  const seen = [];
  const runs = {
    ...RUNS,
    hd: { label: "Hd (headed)", cmd: NODE, args: ["-e", "1", "--headed"] },
    viaNpm: { label: "Npm (headed)", cmd: "npm", args: ["run", "test:x"] },
  };
  const { engine, events } = makeEngine({
    runs,
    pkgScripts: { "test:x": "playwright test tests/01.spec.ts --project=chromium --headed" },
    spawn: (cmd, args, opt) => { seen.push({ cmd, args, opt }); return fakeChild(); },
  });
  engine.start("hd", null, true);
  await waitFor(ended(events, 1));
  engine.start("viaNpm", null, true);
  await waitFor(ended(events, 2));
  assert.equal(seen[0].opt.shell, false);
  assert.equal(seen[0].opt.env.FORCE_COLOR, "0");
  assert.ok(!seen[0].args.includes("--headed"));
  assert.deepEqual(seen[1], { ...seen[1], cmd: "npx", args: ["playwright", "test", "tests/01.spec.ts", "--project=chromium"] });
  const labels = events.filter((e) => e.event === "run-start").map((e) => e.data.label);
  assert.deepEqual(labels, ["Hd (headless)", "Npm (headless)"]);
});

test("requestId: ayni id ikinci kez ILK sonucu (deduped) dondurur", async () => {
  const { engine, events } = makeEngine();
  const a = engine.start("quick", null, false, false, { requestId: "r1" });
  const b = engine.start("quick", null, false, false, { requestId: "r1" });
  assert.equal(b.deduped, true);
  assert.equal(b.journalId, a.journalId);
  await waitFor(ended(events));
});

test("queue:true: slot dolu iken siraya girer, ilki bitince kendiliginden baslar", async () => {
  const { engine, events } = makeEngine();
  engine.start("quick");
  const q = engine.start("fail", null, false, false, { queue: true });
  assert.deepEqual(q, { ok: true, queued: true, position: 1 });
  assert.equal(engine.state().pending[0].id, "fail");
  await waitFor(ended(events, 2));
  const starts = events.filter((e) => e.event === "run-start").map((e) => e.data.id);
  assert.deepEqual(starts, ["quick", "fail"]);
  assert.equal(events.filter((e) => e.event === "run-end")[1].data.code, 2);
  assert.equal(engine.queueSize(), 0);
});

test("stop: sureni oldurur ve sirayi temizler", async () => {
  const { engine, events } = makeEngine();
  engine.start("slow");
  engine.start("quick", null, false, false, { queue: true });
  const s = engine.stop();
  assert.deepEqual(s, { ok: true, cleared: 1 });
  await waitFor(ended(events));
  assert.notEqual(events.find((e) => e.event === "run-end").data.code, 0);
  assert.equal(engine.isRunning(), false);
  assert.equal(engine.queueSize(), 0);
  assert.equal(engine.stop().ok, false, "kosan bir sey yokken hata");
});

test("spawn hatasi (ikili yok) paneli DUSURMEZ: log + run-end(-1)", async () => {
  const { engine, events } = makeEngine();
  const r = engine.start("missing");
  assert.equal(r.ok, true);
  await waitFor(ended(events));
  assert.equal(events.find((e) => e.event === "run-end").data.code, -1);
  assert.ok(events.some((e) => e.event === "log" && /kosum hatasi/.test(e.data.line)));
  assert.equal(engine.isRunning(), false);
});

test("gecersiz istekler baslatmaz: whitelist disi, kotu parametre", () => {
  const { engine } = makeEngine();
  assert.match(engine.start("yok").error, /Whitelist/);
  assert.match(engine.start("custom", { bad: true }).error, /kotu parametre/);
  assert.equal(engine.isRunning(), false);
});

test("kapsam kosumu: bitince applyRunResults dugume yazar", async () => {
  const calls = [];
  const { engine, events } = makeEngine({ applyRunResults: (x) => { calls.push(x); return { written: 1, perSpec: [{ spec: "a", status: "passed" }] }; } });
  engine.start("quick");
  engine.setScopeRun({ nodeId: "n7", runId: "quick", specs: ["a"] });
  await waitFor(ended(events));
  assert.equal(calls[0].nodeId, "n7");
  assert.equal(calls[0].code, 0);
  assert.ok(events.some((e) => e.event === "scope-run-end" && e.data.nodeId === "n7"));
  assert.equal(engine.scopeRun(), null);
});

/** Sahte cocuk surec: hemen kapanir (spawn enjeksiyonu icin). */
function fakeChild() {
  const handlers = {};
  const ch = { stdout: { on() {} }, stderr: { on() {} }, on(ev, fn) { handlers[ev] = fn; }, kill() {} };
  setTimeout(() => handlers.close?.(0), 10);
  return ch;
}
