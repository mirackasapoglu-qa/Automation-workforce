/**
 * AI sağlayıcı katmanı — panelin model çağırdığı TEK kapı.
 *
 * Üç yol, tek sıra (connectors/credentials.mjs'teki "ortam > dosya" deseniyle aynı):
 *   1) api    — ANTHROPIC_API_KEY var → Messages API (sunucu yolu; tek anahtar, başka kurulum yok)
 *   2) cli    — anahtar yok ama makinede Claude Code CLI var → `claude -p` (geliştirici yolu,
 *               kullanıcının kendi oturumu ve MCP'leriyle)
 *   3) manual — ikisi de yok → istem üretilir, kullanıcı elle yapıştırır (kopyala-yapıştır ucu)
 *
 * `AI_PROVIDER=api|cli|manual` sırayı EZER (bir yolu zorlamak için); varsayılan `auto`.
 *
 * NEDEN TEK KAPI: üç özellik (senaryo · perf · test case) üç ayrı yerden model
 * çağırırsa bütçe, eşzamanlılık, kayıt ve hata kodları üç kez yazılır ve
 * birinde unutulur. Kapı (gate) katmanları burada DEĞİL: onlar veri yolunda
 * (scenario-suggest / perf-analyze / testcase-gen → applyFromModel) ve sağlayıcı
 * ne olursa olsun koşulsuz çalışır.
 *
 * Bu dosya proje adı bilmez (`npm run panel:check`).
 */
import fs from "node:fs";
import path from "node:path";
import { apiKey, settings, complete } from "./anthropic.mjs";
import { askClaude, parseJsonLoose } from "../claude-cli.mjs";
import { assertBudget, record, spentToday, withSlot } from "./budget.mjs";

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ---- CLI var mı (PATH taraması, 60 sn önbellek — her preflight'ta disk taramasın)
let cliCache = { at: 0, bin: null };
export function cliBinary() {
  if (Date.now() - cliCache.at < 60_000) return cliCache.bin;
  let found = null;
  const explicit = process.env.CLAUDE_BIN;
  if (explicit) {
    found = isExecutable(explicit) ? explicit : null;
  } else {
    const exts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const f = path.join(dir, `claude${ext}`);
        if (isExecutable(f)) { found = f; break; }
      }
      if (found) break;
    }
  }
  cliCache = { at: Date.now(), bin: found };
  return found;
}

function isExecutable(f) {
  try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; }
}

/** Etkin yol: "api" | "cli" | "manual". */
export function mode() {
  const forced = (process.env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (forced === "api") return apiKey() ? "api" : "manual";
  if (forced === "cli") return cliBinary() ? "cli" : "manual";
  if (forced === "manual") return "manual";
  if (apiKey()) return "api";
  if (cliBinary()) return "cli";
  return "manual";
}

/**
 * Panel/preflight için durum. Ağa ÇIKMAZ (anahtarı doğrulamak bir istek =
 * para); geçerlilik ilk gerçek çağrıda anlaşılır ve AUTH koduyla döner.
 */
export function status() {
  const m = mode();
  const s = settings();
  const key = apiKey();
  const budget = spentToday();
  const base = { mode: m, oneClick: m !== "manual", budget, forced: process.env.AI_PROVIDER || null };
  if (m === "api") {
    return {
      ...base,
      model: s.model,
      effort: s.effort,
      keySource: key.source,
      detail: `API anahtarı (${key.source === "env" ? "ortam değişkeni" : "~/.anthropic-credentials"}) · ${s.model} · effort ${s.effort}`
        + (budget.capUsd ? ` · bugün $${budget.usd.toFixed(2)} / $${budget.capUsd.toFixed(2)}` : ` · bugün $${budget.usd.toFixed(2)}`),
    };
  }
  if (m === "cli") {
    return {
      ...base,
      model: null,
      cliBin: cliBinary(),
      detail: `yerel Claude Code CLI (${cliBinary()}) — kullanıcının oturumu ve MCP'leri ile`,
    };
  }
  return {
    ...base,
    model: null,
    detail: "tek tık kapalı — ANTHROPIC_API_KEY ver (sunucu) ya da Claude Code CLI kur (yerel); istem üret + yapıştır yolu açık",
  };
}

/**
 * Model çağrısı. Şema verilirse `json` dolu döner (API'de sunucu şeması,
 * CLI'de gevşek ayrıştırma + bir kez düzeltici tekrar).
 *
 * @param {object} p
 * @param {string} p.purpose  denetim/defter etiketi (ör. "testcase-generate")
 * @param {string} p.system   sabit talimat
 * @param {string} p.user     bağlam + istek
 * @param {object} [p.schema] JSON Schema
 * @param {number} [p.maxTokens]
 */
export async function ask({ purpose = "ai", system = "", user, schema = null, maxTokens } = {}) {
  const m = mode();
  if (m === "manual") {
    throw err("NO_PROVIDER",
      "Tek tık üretim kapalı: ne ANTHROPIC_API_KEY ne Claude Code CLI var. İstem üret + yapıştır yolu çalışır.");
  }
  if (!user || !String(user).trim()) throw err("BAD_INPUT", "istem boş");
  assertBudget();

  const t0 = Date.now();
  try {
    const out = await withSlot(() => (m === "api"
      ? complete({ system, user, schema, maxTokens })
      : viaCli({ system, user, schema })));
    record({ purpose, provider: m, model: out.model, ok: true, costUsd: out.costUsd, ms: out.durationMs, usage: out.usage ?? null });
    return { provider: m, ...out };
  } catch (e) {
    record({ purpose, provider: m, model: e.model ?? null, ok: false, code: e.code ?? null, costUsd: e.costUsd ?? null, ms: Date.now() - t0, error: String(e.message).slice(0, 200) });
    throw e;
  }
}

/**
 * CLI yolu. Sistem + kullanıcı tek metin olarak gider (CLI'nin sistem alanı
 * yok). Bozuk JSON ARALIKLI bir sorun (aynı istem bir geçerli bir bozuk
 * üretti, ölçüldü) — tek seferlik düzeltici tekrar burada, çağıranlarda değil.
 */
async function viaCli({ system, user, schema }) {
  const prompt = [system, user].filter(Boolean).join("\n\n");
  let r = await askClaude(prompt);
  let json = null;
  if (schema) {
    try {
      json = parseJsonLoose(r.text);
    } catch (parseErr) {
      const fix = `${prompt}\n\n---\nUYARI: önceki yanıt GEÇERLİ JSON DEĞİLDİ (${String(parseErr.message).slice(0, 120)}). `
        + "Yalnızca geçerli, tek parça JSON döndür; metin içinde çift tırnak kullanma.";
      const r2 = await askClaude(fix);
      r = { ...r2, costUsd: (r.costUsd ?? 0) + (r2.costUsd ?? 0), durationMs: r.durationMs + r2.durationMs, retried: true };
      json = parseJsonLoose(r.text);
    }
  }
  return { text: r.text, json, usage: null, costUsd: r.costUsd, durationMs: r.durationMs, model: r.model, stopReason: "end_turn", requestId: r.sessionId ?? null, retried: r.retried ?? false };
}

/** Hata kodu → HTTP durumu (server.mjs tek yerden eşler). */
export function httpStatusFor(code) {
  switch (code) {
    case "NO_PROVIDER":
    case "NO_CLI":
    case "NO_KEY": return 501;
    case "BUDGET":
    case "BUSY":
    case "RATE_LIMIT": return 429;
    case "TIMEOUT": return 504;
    case "REFUSAL": return 422;
    case "BAD_INPUT": return 400;
    default: return 502;
  }
}

/** Kullanıcıya "şimdi ne yapayım" satırı. */
export function hintFor(code) {
  switch (code) {
    case "NO_PROVIDER":
    case "NO_CLI":
    case "NO_KEY": return "Sunucuda ANTHROPIC_API_KEY ver ya da yerelde Claude Code CLI kur. Bu arada 'İstem üret' ile kopyala-yapıştır yolu çalışır.";
    case "BUDGET": return "AI_DAILY_USD tavanı doldu; yarın sıfırlanır ya da tavanı artır.";
    case "BUSY": return "Başka bir üretim sürüyor; birkaç saniye sonra tekrar dene.";
    case "RATE_LIMIT": return "Anthropic hız sınırı; bir dakika bekleyip tekrar dene.";
    case "AUTH": return "Anahtar geçersiz ya da süresi dolmuş — ANTHROPIC_API_KEY'i yenile.";
    case "TIMEOUT": return "Model zaman aşımına uğradı; istemi küçült ya da AI_TIMEOUT_MS'i artır.";
    case "REFUSAL": return "Model isteği reddetti; istem metnini gözden geçir.";
    case "TRUNCATED": return "Yanıt kesildi; en fazla case/senaryo sayısını düşür ya da AI_MAX_TOKENS'ı artır.";
    case "BAD_JSON": return "Model geçerli JSON döndürmedi; bir kez daha dene, tekrar ederse 'İstem üret' yolunu kullan.";
    default: return "Tekrar dene; sürerse 'İstem üret' ile kopyala-yapıştır yolu çalışır.";
  }
}
