/**
 * Yönlendirici — kayıt, koruma bayrakları, gövde, 405, önek.
 * Koşum: node --test panel/http/router.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "./router.mjs";

function fakeCtx({ authOk = true, body = {} } = {}) {
  const sent = [];
  return {
    ctx: {
      url: null,
      send: (res, code, payload) => sent.push({ code, payload }),
      requireAuth: (req, res) => { if (!authOk) sent.push({ code: 403, payload: { code: "STALE_TOKEN" } }); return authOk; },
      readBody: async () => body,
    },
    sent,
  };
}

const req = (method, path) => ({ method, url: path });
const dispatch = async (router, method, path, opts) => {
  const { ctx, sent } = fakeCtx(opts);
  ctx.url = new URL(path, "http://x");
  const handled = await router.dispatch(req(method, path), {}, ctx);
  return { handled, sent };
};

test("tam yol + metod eslesir, handler ctx'i alir", async () => {
  const r = createRouter();
  let got = null;
  r.get("/api/a", ({ path, url, body }) => { got = { path, q: url.searchParams.get("q"), body }; });
  const { handled } = await dispatch(r, "GET", "/api/a?q=1");
  assert.equal(handled, true);
  assert.deepEqual(got, { path: "/api/a", q: "1", body: undefined });
});

test("auth:true → token yoksa handler CALISMAZ", async () => {
  const r = createRouter();
  let ran = false;
  r.post("/api/w", () => { ran = true; }, { auth: true });
  const { handled, sent } = await dispatch(r, "POST", "/api/w", { authOk: false });
  assert.equal(handled, true);
  assert.equal(ran, false);
  assert.equal(sent[0].code, 403);
});

test("body:true → govde okunup verilir", async () => {
  const r = createRouter();
  let got;
  r.post("/api/b", ({ body }) => { got = body; }, { body: true });
  await dispatch(r, "POST", "/api/b", { body: { x: 1 } });
  assert.deepEqual(got, { x: 1 });
});

test("bilinen yol yanlis metod → 405; bilinmeyen yol → false (eski zincire duser)", async () => {
  const r = createRouter();
  r.get("/api/only-get", () => {});
  const a = await dispatch(r, "POST", "/api/only-get");
  assert.equal(a.handled, true);
  assert.equal(a.sent[0].code, 405);
  const b = await dispatch(r, "GET", "/api/nope");
  assert.equal(b.handled, false);
});

test("onek rotasi rest verir; tam yol onekten once gelir", async () => {
  const r = createRouter();
  let rest = null;
  r.prefix("GET", "/js/", ({ rest: x }) => { rest = x; });
  let exactHit = false;
  r.get("/js/special", () => { exactHit = true; });
  await dispatch(r, "GET", "/js/dialogs.js");
  assert.equal(rest, "dialogs.js");
  await dispatch(r, "GET", "/js/special");
  assert.equal(exactHit, true);
});

test("ayni rota iki kez kaydedilemez; list() koruma bayraklarini soyler", () => {
  const r = createRouter();
  r.post("/api/x", () => {}, { auth: true, body: true });
  assert.throws(() => r.post("/api/x", () => {}), /iki kez/);
  assert.deepEqual(r.list(), [{ method: "POST", path: "/api/x", auth: true, body: true }]);
  assert.throws(() => r.get("api/relative", () => {}), /geçersiz yol/);
});
