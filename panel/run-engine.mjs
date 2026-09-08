/**
 * Koşum motoru — Playwright süreçlerini başlatır, izler, sıraya alır.
 *
 * Eskiden `server.mjs` içinde 300 satırlık kapanış değişkenleriydi (`active`,
 * `scopeRun`, `startRun`, `stopRun`); test edilemiyor, başka bir uç yanlışlıkla
 * `spawn` çağırırsa tek-slot kuralı sessizce deliniyordu. Şimdi tek nesne:
 *
 *   const engine = createRunEngine({ root, runs, ... });
 *   engine.start(runId, params, headless, record, { requestId, queue })
 *   engine.stop({ all })   engine.state()   engine.setScopeRun(...)
 *
 * KURALLAR (değişmedi, yalnız taşındı):
 *  - Tek slot: Playwright `test-results/`i koşum başında siler; paralel iki
 *    koşum birbirinin kanıtını yok eder. Kuyruk + idempotency `run-queue.mjs`.
 *  - Serbest komut yok: whitelist (`runs.json`), parametreli koşum
 *    (`buildCustomArgs`, argv doğrulanır) ya da karantinadaki taslak.
 *  - `spawn(..., { shell:false })` — kabuk devreye girmez.
 *  - `ordersEnv()` BİLİNÇLİ OLARAK koşum ortamına geçirilmez (sipariş guard'ı
 *    ayrı karar; bkz. CLAUDE.md).
 *
 * YENİ: `child.on("error")` — eskiden `npx` bulunamazsa 'error' olayı
 * dinleyicisiz kalıp SÜRECİ (paneli) düşürüyordu. Artık log'a düşer ve koşum
 * `code:-1` ile kapanır.
 *
 * Bağımlılıklar enjekte edilir (spawn dahil) — motor sunucusuz test edilir.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { createRunGate } from "./run-queue.mjs";

const LINE_CAP = 4000;

export function createRunEngine({
  root,
  runs,
  pkgScripts = {},
  buildCustomArgs,
  draftFile,
  ensureDraftBridge,
  broadcast,
  audit,
  journal,
  mergeHistory = () => {},
  lastResults = () => null,
  applyRunResults = null,
  spawn = nodeSpawn,
  env = () => process.env,
  dedupeMs,
  queueLimit,
} = {}) {
  if (!root || !runs || !broadcast || !audit || !journal) throw new Error("run-engine: root, runs, broadcast, audit, journal zorunlu");

  let active = null;   // { id, label, child, startedAt, lines[], journalId }
  let scopeRun = null; // { nodeId, runId, specs }
  const gate = createRunGate({ dedupeMs, queueLimit });

  const recordEnv = (record) => (record ? { PW_VIDEO: "on", PW_TRACE: "on" } : {});
  const publicActive = () => (active ? { id: active.id, label: active.label, startedAt: active.startedAt } : null);

  /** Koşum tanımı → komut. Hata varsa `{ error }`. */
  function resolveCommand(runId, params, headless) {
    if (runId === "draft") {
      const d = draftFile?.(params?.name);
      if (!d) return { error: "Taslak bulunamadi (ad gecersiz ya da dosya yok)" };
      const proj = params?.project === "mobile" ? "mobile" : "chromium";
      ensureDraftBridge?.();
      const args = ["playwright", "test", "--config", "playwright.draft.config.ts", d.base, `--project=${proj}`];
      if (params?.headed) args.push("--headed");
      return { cmd: "npx", args, label: `Taslak: ${d.base} (${proj}${params?.headed ? ", headed" : ""})` };
    }
    if (runId === "custom") {
      const built = buildCustomArgs?.(params) ?? { args: [], errors: ["parametreli kosum tanimli degil"] };
      if (built.errors.length) return { error: built.errors.join(" · ") };
      const label = `Parametreli: ${(params.specs ?? []).join(", ")}${params.grep ? ` -g "${params.grep}"` : ""}${
        params.repeatEach > 1 ? ` ×${params.repeatEach}` : ""}${params.headed ? " (headed)" : ""}`;
      return { cmd: "npx", args: built.args, label };
    }
    const run = runs[runId];
    if (!run) return { error: `Whitelist'te yok: ${runId}` };
    let { cmd, args, label } = run;
    if (headless) {
      // `npm run test:x` --headed'i package.json'da tasiyor; script'i dogrudan playwright cagrisina cevir.
      if (cmd === "npm" && args[0] === "run") {
        const parts = String(pkgScripts[args[1]] || "").split(/\s+/).filter((x) => x && x !== "--headed");
        if (parts[0] === "playwright") { cmd = "npx"; args = parts; label = label.replace(/\(headed\)/i, "(headless)"); }
      } else {
        const filtered = args.filter((a) => a !== "--headed");
        if (filtered.length !== args.length) { args = filtered; label = label.replace(/\(headed\)/i, "(headless)"); }
      }
    }
    return { cmd, args, label };
  }

  function start(runId, params = null, headless = false, record = false, meta = {}) {
    const prior = gate.recall(meta.requestId);
    if (prior) return prior;

    if (active) {
      if (meta.queue) {
        const q = gate.enqueue({ runId, params, headless, record, label: runs[runId]?.label ?? runId, requestId: meta.requestId ?? null });
        if (q.ok) {
          gate.remember(meta.requestId, q);
          audit({ event: "run-queued", id: runId, position: q.position, params });
          broadcast("run-queued", { id: runId, position: q.position, ...state() });
        }
        return q;
      }
      return {
        ok: false, code: "BUSY", error: `Zaten kosuyor: ${active.id}`, active: publicActive(),
        hint: "Bitmesini bekle, Durdur'a bas ya da `queue:true` ile siraya al.",
      };
    }

    const resolved = resolveCommand(runId, params, headless);
    if (resolved.error) return { ok: false, code: "INVALID", error: resolved.error };
    const { cmd, args, label } = resolved;

    let child;
    try {
      child = spawn(cmd, args, { cwd: root, env: { ...env(), FORCE_COLOR: "0", ...recordEnv(record) }, shell: false });
    } catch (e) {
      return { ok: false, code: "SPAWN", error: `Kosum baslatilamadi: ${e.message}` };
    }

    audit({ event: "run", id: runId, label, argv: [cmd, ...args], params, record: record || undefined });
    active = { id: runId, label, child, startedAt: Date.now(), lines: [] };
    active.journalId = journal.start({ runId, label, argv: [cmd, ...args].join(" ") });
    broadcast("run-start", { id: runId, label, startedAt: active.startedAt, argv: [cmd, ...args].join(" ") });

    const push = (chunk, stream) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        active.lines.push(line);
        if (active.lines.length > LINE_CAP) active.lines.shift();
        broadcast("log", { stream, line });
      }
    };
    child.stdout?.on("data", (c) => push(c, "out"));
    child.stderr?.on("data", (c) => push(c, "err"));

    let closed = false;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      try { mergeHistory(); } catch { /* rapor yoksa sessiz gec */ }
      const summary = active.lines.slice(-40).join("\n");
      const durationMs = Date.now() - active.startedAt;
      try { journal.finish(active.journalId, { code, durationMs, counts: lastResults()?.counts ?? null }); }
      catch { /* gunluk yazilamazsa kosum akisi etkilenmez */ }
      broadcast("run-end", { id: runId, code, durationMs, summary });

      if (scopeRun && scopeRun.runId === runId && applyRunResults) {
        const bekleyen = scopeRun;
        scopeRun = null;
        try {
          const out = applyRunResults({ nodeId: bekleyen.nodeId, specs: bekleyen.specs, results: lastResults(), durationMs, code });
          audit({ event: "scope-run-write", nodeId: bekleyen.nodeId, written: out.written });
          broadcast("scope-run-end", { nodeId: bekleyen.nodeId, ...out });
          broadcast("log", { stream: "out", line: `[kapsam] ${bekleyen.nodeId}: ${(out.perSpec ?? []).map((p) => `${p.spec} ${p.status ?? "?"}`).join(", ")}` });
        } catch (e) {
          broadcast("log", { stream: "err", line: `[kapsam] sonuc yazilamadi: ${e.message}` });
          broadcast("scope-run-end", { nodeId: bekleyen.nodeId, error: e.message });
        }
      }
      active = null;
      drain();
    };
    child.on("close", (code) => finish(code));
    child.on("error", (e) => {
      // ENOENT (npx yok) vb. — dinleyicisiz kalsa sureci dusururdu.
      push(Buffer.from(`[motor] kosum hatasi: ${e.message}`), "err");
      finish(-1);
    });

    const result = { ok: true, id: runId, journalId: active.journalId };
    gate.remember(meta.requestId, result);
    return result;
  }

  /** Slot bosalinca siradaki; baslatilamayan atlanir, log'a duser. */
  function drain() {
    const next = gate.dequeue();
    if (!next) return;
    const r = start(next.runId, next.params, next.headless, next.record, {});
    if (!r.ok) {
      broadcast("log", { stream: "err", line: `[kuyruk] ${next.runId} baslatilamadi: ${r.error}` });
      drain();
    }
  }

  /** Durdur = suren kosum + SIRA (varsayilan). `all:false` sirayi korur. */
  function stop({ all = true } = {}) {
    const cleared = all ? gate.clear() : 0;
    if (!active) return { ok: cleared > 0, error: cleared ? undefined : "Kosan bir sey yok", cleared };
    active.child.kill("SIGTERM");
    return { ok: true, cleared };
  }

  const state = () => ({ active: publicActive(), pending: gate.pending() });

  return {
    start,
    stop,
    state,
    active: publicActive,
    isRunning: () => Boolean(active),
    journalId: () => active?.journalId ?? null,
    recentLines: (n = 200) => (active ? active.lines.slice(-n) : []),
    setScopeRun: (v) => { scopeRun = v; },
    scopeRun: () => scopeRun,
    queueSize: () => gate.size(),
  };
}
