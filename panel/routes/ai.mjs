/**
 * AI rotaları — senaryo önerisi · perf yorumu · test case üretimi.
 *
 * Her özellik üç uçtan oluşur ve üçü de aynı veri yolundan geçer:
 *   /prompt   → istemi kur, kullanıcıya ver (anahtarsız yol)
 *   /apply    → yapıştırılan JSON'u kapıdan geçir, yaz
 *   /generate → istemi kur, sağlayıcıya sor, AYNI kapıdan geçir, yaz (tek tık)
 *
 * `generateAndApply` üç `generate`'in ortak gövdesi: model → kapı → yaz. Kapı
 * (gate/applyCases/allowedNodeIds) sağlayıcıdan bağımsız koşulsuz çalışır;
 * "apply" adımı fırlatırsa 422 REJECTED — ücret ödendi, sebep açık yazılır.
 *
 * `stable` (rag/digest.mjs): sorgudan bağımsız sabit zemin; test case ve senaryo
 * istemlerine girer ve API yolunda önbelleklenir. Perf istemine GİRMEZ (ölçüm
 * zaten sayısal; kural metni orada uydurmayı azaltmaz, maliyeti artırır).
 *
 * Bağımlılıklar `ctx` ile gelir; bu dosya `server.mjs` kapanışına bağlı değil.
 */
import * as ai from "../ai/provider.mjs";
import { buildPrompt, buildCardPrompt, applyFromModel, SCHEMA as TESTCASE_SCHEMA } from "../testcase-gen.mjs";
import {
  buildContext as buildScenarioContext,
  buildPrompt as buildScenarioPrompt,
  applyFromModel as applyScenarios,
  SCHEMA as SCENARIO_SCHEMA,
} from "../scenario-suggest.mjs";
import { buildPrompt as buildPerfPrompt, applyFromModel as applyPerfFindings, SCHEMA as PERF_SCHEMA } from "../perf-analyze.mjs";
import { stableDigest } from "../rag/digest.mjs";

const clampLimit = (v, def, max) => Math.min(Math.max(Number(v) || def, 1), max);

/** Sabit zemin — okunamazsa boş (özellik kapanmaz). */
function stable() {
  try { return stableDigest().text; } catch { return ""; }
}

export function registerAiRoutes(router, ctx) {
  const { send, audit, getCard, readPerf } = ctx;

  async function generateAndApply({ purpose, built, schema, apply, res, useStable = true }) {
    const t0 = Date.now();
    let r;
    try {
      r = await ai.ask({ purpose, system: built.system, stable: useStable ? stable() : "", user: built.user, schema });
    } catch (e) {
      const code = e.code ?? null;
      audit({ event: `${purpose}-error`, code, message: String(e.message).slice(0, 200), ms: Date.now() - t0 });
      return send(res, ai.httpStatusFor(code), { ok: false, error: e.message, code, hint: ai.hintFor(code), provider: ai.mode() });
    }
    let out;
    try {
      out = apply(r.json);
    } catch (e) {
      audit({ event: `${purpose}-rejected`, message: String(e.message).slice(0, 200), costUsd: r.costUsd, ms: r.durationMs });
      return send(res, 422, { ok: false, error: e.message, code: "REJECTED", provider: r.provider, model: r.model, cost: r.costUsd, ms: r.durationMs });
    }
    audit({
      event: purpose, provider: r.provider, model: r.model, costUsd: r.costUsd, ms: r.durationMs,
      retrieval: built.retrieval?.chunks ?? 0, cacheRead: r.cache?.read ?? null, ...(out.audit ?? {}),
    });
    return send(res, 200, {
      ok: true, ...out.body,
      provider: r.provider, model: r.model, cost: r.costUsd, ms: r.durationMs,
      usage: r.usage ?? null, cache: r.cache ?? null, retrieval: built.retrieval ?? null, requestId: r.requestId ?? null,
    });
  }

  // ---- durum
  router.get("/api/ai/status", ({ res }) => send(res, 200, { ok: true, ...ai.status() }));

  // ---- test case: kapsam ağacı
  router.post("/api/scope/testcases/prompt", ({ res, body }) => {
    try {
      const out = buildPrompt({ nodeIds: body.nodeIds, types: body.types, limit: body.limit });
      audit({ event: "testcase-prompt", nodes: out.nodes.length });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/scope/testcases/apply", ({ res, body }) => {
    try {
      const out = applyFromModel(body);
      audit({ event: "testcase-apply", written: out.written });
      ctx.broadcast("log", { stream: "out", line: `[case] elle uretim: ${out.written} case yazildi` });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/scope/testcases/generate", ({ res, body }) => {
    const { nodeIds, types, limit } = body;
    let built;
    try { built = buildPrompt({ nodeIds, types, limit: clampLimit(limit, 4, 12) }); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    return generateAndApply({
      purpose: "scope-testcase-generate", built, schema: TESTCASE_SCHEMA, res,
      apply: (json) => {
        const out = applyFromModel({ items: json?.items, card: null, allowedNodeIds: nodeIds });
        return { body: out, audit: { nodes: (nodeIds ?? []).length, written: out.written } };
      },
    });
  }, { auth: true, body: true });

  // ---- test case: Jira kartı
  router.post("/api/jira/testcases/prompt", async ({ res, body }) => {
    const { key, nodeId, types, limit } = body;
    if (!key) return send(res, 400, { ok: false, error: "key zorunlu" });
    try {
      const card = await getCard(String(key));
      if (card.error) return send(res, 502, { ok: false, error: card.error });
      const out = buildCardPrompt({ card, nodeId, types, limit: clampLimit(limit, 4, 12) });
      audit({ event: "jira-testcase-prompt", key, nodeId, types: out.types.length });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      audit({ event: "jira-testcase-prompt-error", key, message: e.message.slice(0, 200) });
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/jira/testcases/generate", async ({ res, body }) => {
    const { key, nodeId, types, limit } = body;
    if (!key) return send(res, 400, { ok: false, error: "key zorunlu" });
    let built;
    try {
      const card = await getCard(String(key));
      if (card.error) return send(res, 502, { ok: false, error: card.error });
      built = buildCardPrompt({ card, nodeId, types, limit: clampLimit(limit, 4, 12) });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
    return generateAndApply({
      purpose: "jira-testcase-generate", built, schema: TESTCASE_SCHEMA, res,
      apply: (json) => {
        const out = applyFromModel({ items: json?.items, card: String(key), allowedNodeIds: [nodeId] });
        return { body: out, audit: { card: String(key), written: out.written } };
      },
    });
  }, { auth: true, body: true });

  // ---- senaryo
  router.get("/api/scenarios/context", ({ res, url }) => {
    const c = buildScenarioContext({ limit: Number(url.searchParams.get("limit")) || 5 });
    return send(res, 200, {
      suites: c.suites.length, existingCases: c.existingCases.length, oracleSources: c.oracleSources, ready: c.oracleSources.length > 0,
    });
  });

  router.post("/api/scenarios/prompt", ({ res, body }) => {
    const { request, limit } = body;
    if (!request || !String(request).trim()) return send(res, 400, { ok: false, error: "request zorunlu" });
    const lim = clampLimit(limit, 5, 10);
    try {
      const out = buildScenarioPrompt({ request: String(request), limit: lim });
      audit({ event: "scenario-prompt", chars: String(request).length, limit: lim, oracles: out.context.oracleSources.length });
      return send(res, 200, { ok: true, prompt: out.prompt, limit: lim, suites: out.context.suites.length, oracleSources: out.context.oracleSources.length, retrieval: out.retrieval });
    } catch (e) {
      audit({ event: "scenario-prompt-error", code: e.code ?? null, message: e.message.slice(0, 200) });
      return send(res, e.code === "NO_ORACLE" ? 409 : 400, { ok: false, error: e.message, code: e.code ?? null });
    }
  }, { auth: true, body: true });

  router.post("/api/scenarios/apply", ({ res, body }) => {
    const lim = clampLimit(body.limit, 5, 10);
    try {
      const out = applyScenarios({ scenarios: body.scenarios, limit: lim });
      audit({ event: "scenario-apply", accepted: out.audit.accepted, dropped: out.audit.droppedNoOracle.length, rejected: out.audit.rejectedByContext.length });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      audit({ event: "scenario-apply-error", message: e.message.slice(0, 200) });
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/scenarios/generate", ({ res, body }) => {
    const { request, limit } = body;
    if (!request || !String(request).trim()) return send(res, 400, { ok: false, error: "request zorunlu" });
    const lim = clampLimit(limit, 5, 10);
    let built;
    try { built = buildScenarioPrompt({ request: String(request), limit: lim }); }
    catch (e) { return send(res, e.code === "NO_ORACLE" ? 409 : 400, { ok: false, error: e.message, code: e.code ?? null }); }
    return generateAndApply({
      purpose: "scenario-generate", built, schema: SCENARIO_SCHEMA, res,
      apply: (json) => {
        const out = applyScenarios({ scenarios: json?.scenarios, limit: lim });
        return { body: out, audit: { accepted: out.audit.accepted, dropped: out.audit.droppedNoOracle.length, rejected: out.audit.rejectedByContext.length } };
      },
    });
  }, { auth: true, body: true });

  // ---- perf yorumu (ölçüm SUNUCUDA okunur; istemciden gelen listeye güvenilmez)
  router.post("/api/perf/prompt", ({ res }) => {
    const perf = readPerf();
    try {
      const out = buildPerfPrompt(perf);
      audit({ event: "perf-prompt", routes: out.routes });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      audit({ event: "perf-prompt-error", message: e.message.slice(0, 200) });
      return send(res, 409, { ok: false, error: e.message });
    }
  }, { auth: true });

  router.post("/api/perf/apply", ({ res, body }) => {
    const perf = readPerf();
    try {
      const out = applyPerfFindings(perf, body);
      audit({ event: "perf-apply", findings: out.findings.length, dropped: out.dropped.length });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      audit({ event: "perf-apply-error", message: e.message.slice(0, 200) });
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/perf/generate", ({ res }) => {
    const perf = readPerf();
    let built;
    try { built = buildPerfPrompt(perf); }
    catch (e) { return send(res, 409, { ok: false, error: e.message }); }
    return generateAndApply({
      purpose: "perf-generate", built, schema: PERF_SCHEMA, res, useStable: false,
      apply: (json) => {
        const out = applyPerfFindings(perf, json);
        return { body: out, audit: { findings: out.findings.length, dropped: out.dropped.length } };
      },
    });
  }, { auth: true });
}
