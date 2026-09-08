/**
 * Koşum kapısı — idempotency ve kuyruk mantığı, süreç başlatmadan.
 * Koşum: node --test panel/run-queue.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRunGate } from "./run-queue.mjs";

test("ayni requestId 60 sn icinde ilk sonucu dondurur, sonra unutur", () => {
  let t = 1000;
  const g = createRunGate({ dedupeMs: 60_000, now: () => t });
  assert.equal(g.recall("r1"), null);
  g.remember("r1", { ok: true, id: "guest-all" });
  assert.deepEqual(g.recall("r1"), { ok: true, id: "guest-all", deduped: true });
  t += 59_000;
  assert.ok(g.recall("r1"));
  t += 2_000;
  assert.equal(g.recall("r1"), null, "suresi dolunca yeni istek sayilir");
  assert.equal(g.recall(""), null, "bos id kontrol yok");
});

test("kuyruk FIFO, ust sinir, ayni is iki kez siraya girmez", () => {
  const g = createRunGate({ queueLimit: 2 });
  assert.deepEqual(g.enqueue({ runId: "a" }).position, 1);
  assert.equal(g.enqueue({ runId: "a" }).code, "DUPLICATE");
  assert.equal(g.enqueue({ runId: "a", headless: true }).position, 2, "farkli parametre = farkli is");
  assert.equal(g.enqueue({ runId: "b" }).code, "QUEUE_FULL");
  assert.equal(g.size(), 2);
  assert.equal(g.pending()[0].id, "a");
  assert.equal(g.dequeue().runId, "a");
  assert.equal(g.dequeue().headless, true);
  assert.equal(g.dequeue(), null);
});

test("clear sirayi bosaltir ve sayiyi doner", () => {
  const g = createRunGate();
  g.enqueue({ runId: "a" });
  g.enqueue({ runId: "b" });
  assert.equal(g.clear(), 2);
  assert.equal(g.size(), 0);
});
