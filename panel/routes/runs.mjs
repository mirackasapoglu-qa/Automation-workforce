/**
 * Koşum uçları — motorun (run-engine.mjs) HTTP yüzü.
 *
 *   POST /api/run/preview     parametreli koşumun komutunu gösterir (çalıştırmaz; token yok, yan etki yok)
 *   POST /api/run             başlat — {id, params, headless, record, requestId, queue}; token
 *   GET  /api/run/state       süren koşum + sıra
 *   POST /api/stop            durdur — {all:false} sırayı korur; token
 *   GET  /api/runs/history    koşum günlüğü (yeniden eskiye)
 *   GET  /api/events          SSE: run-start/log/run-end/run-queued (+ diff olayları)
 *   POST /api/scope/run       kapsam düğümünden koşum; token
 *   GET  /api/scope/run-state düğüm koşumu sürüyor mu
 *
 * HTTP eşlemesi: mesgul/sıra dolu/aynı iş → 409; geçersiz istek → 400.
 */
export function registerRunRoutes(router, ctx) {
  const { send, audit, engine, sse, RUNS, buildCustomArgs, journal, readTree, findScopeNode } = ctx;

  router.post("/api/run/preview", ({ res, body }) => {
    const built = buildCustomArgs(body.params ?? {});
    return send(res, 200, { ok: !built.errors.length, errors: built.errors, command: ["npx", ...built.args].join(" ") });
  }, { body: true });

  router.post("/api/run", ({ res, body }) => {
    const { id, params, headless, record, requestId, queue } = body;
    const r = engine.start(id, params ?? null, Boolean(headless), Boolean(record), {
      requestId: typeof requestId === "string" ? requestId.slice(0, 80) : null,
      queue: Boolean(queue),
    });
    const status = r.ok ? 200 : ["BUSY", "QUEUE_FULL", "DUPLICATE"].includes(r.code) ? 409 : 400;
    return send(res, status, r);
  }, { auth: true, body: true });

  router.get("/api/run/state", ({ res }) => send(res, 200, { ok: true, ...engine.state() }));

  router.post("/api/stop", ({ res, body }) => {
    const all = body?.all !== false;
    audit({ event: "stop", id: engine.active()?.id ?? null, clearQueue: all });
    return send(res, 200, engine.stop({ all }));
  }, { auth: true, body: true });

  router.get("/api/runs/history", ({ res, url }) => {
    const n = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 50);
    return send(res, 200, { runs: journal.list(n, engine.journalId()) });
  });

  router.get("/api/events", ({ req, res }) => {
    sse.add(req, res);
    const st = engine.state();
    if (st.pending.length) sse.write(res, "run-queued", st);
    if (st.active) {
      sse.write(res, "run-start", st.active);
      for (const line of engine.recentLines(200)) sse.write(res, "log", { stream: "out", line });
    }
  });

  /**
   * Kapsam agacindaki bir dugumden GERCEK kosum. `runRef.runId` whitelist'te
   * olmak ZORUNDA. SIRAYA ALINMAZ: scopeRun tek slot, kuyruktaki ikinci dugum
   * ilkinin sonucunu ezerdi — mesgulse 409 + suren kosum bilgisi.
   */
  router.post("/api/scope/run", ({ res, body }) => {
    const { nodeId, headless = true } = body;
    const { tree } = readTree();
    const node = findScopeNode(tree, nodeId);
    if (!node) return send(res, 404, { ok: false, error: "Dugum bulunamadi." });
    const ref = node.runRef ?? {};
    if (!ref.runId) return send(res, 400, { ok: false, error: "Bu dugume bagli bir kosum yok (runRef bos)." });
    if (!RUNS[ref.runId]) return send(res, 400, { ok: false, error: `Kosum whitelist'te yok: ${ref.runId}` });
    const started = engine.start(ref.runId, null, Boolean(headless));
    if (!started.ok) return send(res, started.code === "BUSY" ? 409 : 400, started);
    engine.setScopeRun({ nodeId, runId: ref.runId, specs: ref.specs ?? [] });
    audit({ event: "scope-run-start", nodeId, runId: ref.runId });
    return send(res, 200, { ok: true, runId: ref.runId, specs: ref.specs ?? [] });
  }, { auth: true, body: true });

  router.get("/api/scope/run-state", ({ res }) => send(res, 200, {
    running: engine.isRunning(),
    activeRunId: engine.active()?.id ?? null,
    scopeNodeId: engine.scopeRun()?.nodeId ?? null,
  }));
}
