/**
 * Anthropic Messages API istemcisi — SIFIR BAĞIMLILIK, tek anahtar.
 *
 * NEDEN SDK DEĞİL: panel `node_modules` olmadan da açılır (ölçüldü 2026-08-22)
 * ve bu değişmez korunuyor. Node 22+ `fetch` yerleşik; `POST /v1/messages`
 * tek uç, gövde düz JSON. SDK'nın verdiği tek şey (tip + yeniden deneme) burada
 * 200 satırda var. Kural değişirse önce bu başlığı güncelle.
 *
 * KİMLİK: `ANTHROPIC_API_KEY` ortam değişkeni ya da `~/.anthropic-credentials`
 * (connectors/credentials.mjs → env > OAuth > dosya). Sunucuda tek yol env.
 *
 * KULLANIM SÖZLEŞMESİ (provider.mjs üzerinden çağrılır, doğrudan değil):
 *   complete({ system, stable, user, schema }) → { text, json, usage, costUsd, cache, ... }
 *
 * ÖLÇÜLMÜŞ/BELGELENMİŞ API KURALLARI (2026 API):
 *  - Yapılandırılmış çıktı: `output_config.format = {type:"json_schema", schema}`.
 *    Şemada her nesnede `additionalProperties:false` ŞART; sayısal/uzunluk
 *    kısıtları desteklenmez (sunucu 400 döner) — şemaları sade tut.
 *  - Düşünme: 4.6+ modellerde `thinking:{type:"adaptive"}`; `budget_tokens`
 *    Opus 5 / Sonnet 5 / 4.7+'da 400 verir. Haiku 4.5 adaptive'i TANIMAZ.
 *  - Çaba: `output_config.effort` (low…max) yalnız 4.6+; Haiku'da 400.
 *  - ÖNBELLEK: `system[]` bloğuna `cache_control` konur ama yalnızca sabit önek
 *    eşiği (modele göre 1024–2048+ token) aşıyorsa — altındayken bayrak SESSİZCE
 *    boşa gider (ölçüldü: 193 token'lık sistem istemi hiç önbelleklenmedi).
 *    Bu yüzden `stable` (rag/digest.mjs) ayrı blok olarak gelir ve bayrağı
 *    sadece o taşır; kısaysa bayrak hiç konmaz. `usage.cache_read_input_tokens`
 *    sıfır kalıyorsa AI_CACHE_MIN_TOKENS'ı yükselt.
 *  - Prefill YOK (400). Biçimi şema ya da sistem talimatı belirler.
 *  - `stop_reason: "refusal"` HTTP 200 ile gelir — içerik okunmadan kontrol.
 */
import { resolve as resolveCred } from "../auth/credential-store.mjs";

/**
 * Depo anahtarı sağlayıcı adı (`claude-code`), dosya adı `.anthropic-credentials`
 * — ikisi eşleşmediği için uyumluluk sarmalayıcısı değil depo doğrudan çağrılır.
 */
export const PROVIDER_KEY = "claude-code";
export const CRED = { file: ".anthropic-credentials", vars: ["ANTHROPIC_API_KEY"] };
export const DEFAULT_MODEL = "claude-opus-5";
const API_VERSION = "2023-06-01";

/**
 * Liste fiyatları ($/1M token) — MALİYET TAHMİNİ için. Fatura Console'da;
 * burası "bu tık kaça patladı" sorusuna 1 sn'de cevap vermek için var.
 * Önbellek yazma 1.25×, okuma 0.1× girdi fiyatı (Anthropic listesi, 2026-06).
 */
export const PRICES = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-fable-5": { in: 10, out: 50 },
};

function clampInt(raw, def, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Ortamdan model/çaba/limit — hepsi tek yerden okunsun. */
export function settings() {
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  return {
    model,
    effort: (process.env.AI_EFFORT || "high").trim(),
    maxTokens: clampInt(process.env.AI_MAX_TOKENS, 16000, 1024, 64000),
    timeoutMs: clampInt(process.env.AI_TIMEOUT_MS, 180_000, 10_000, 600_000),
    retryMs: clampInt(process.env.AI_RETRY_MS, 2000, 1, 20_000),
    cacheMinTokens: clampInt(process.env.AI_CACHE_MIN_TOKENS, /^claude-haiku/.test(model) ? 2100 : 1100, 256, 10_000),
    baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),
    thinking: (process.env.AI_THINKING || "on").trim() !== "off",
  };
}

/** Anahtar var mı, nereden (env|file). Yoksa null. */
export function apiKey() {
  const r = resolveCred(PROVIDER_KEY, CRED.vars, { file: CRED.file });
  return r.ok ? { key: r.values.ANTHROPIC_API_KEY, source: r.source } : null;
}

/** Kullanımdan tahmini USD. Bilinmeyen modelde null (uydurma yok). */
export function estimateCost(usage, model) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const inTok = Number(usage.input_tokens || 0);
  const outTok = Number(usage.output_tokens || 0);
  const cacheW = Number(usage.cache_creation_input_tokens || 0);
  const cacheR = Number(usage.cache_read_input_tokens || 0);
  const usd = (inTok * p.in + outTok * p.out + cacheW * p.in * 1.25 + cacheR * p.in * 0.1) / 1_000_000;
  return Math.round(usd * 1e5) / 1e5;
}

/** Kaba token tahmini (4 karakter ≈ 1 token) — eşik kararı için yeterli. */
export const estimateTokens = (s) => Math.round(String(s ?? "").length / 4);

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** Model ailesine göre hangi istek alanları GÜVENLE gönderilebilir. */
function capabilities(model) {
  const haiku = /^claude-haiku/.test(model);
  return { adaptiveThinking: !haiku, effort: !haiku };
}

/**
 * `system` dizisini kurar. `stable` varsa ayrı blok; önbellek bayrağı YALNIZCA
 * toplam sabit önek eşiği aşıyorsa konur (aksi hâlde süs olurdu).
 */
export function buildSystemBlocks({ system, stable, cacheMinTokens }) {
  const blocks = [];
  if (system) blocks.push({ type: "text", text: String(system) });
  if (stable) {
    const b = { type: "text", text: String(stable) };
    if (estimateTokens(system) + estimateTokens(stable) >= cacheMinTokens) {
      b.cache_control = { type: "ephemeral", ttl: "1h" };
    }
    blocks.push(b);
  }
  return blocks;
}

/**
 * Tek istek. Şema verilirse yanıt JSON garantili (sunucu tarafı şema).
 *
 * @param {object} p
 * @param {string} p.system     talimat (kısa; önbelleğe girmez)
 * @param {string} [p.stable]   sabit zemin (rag/digest.mjs; eşiği aşarsa önbelleklenir)
 * @param {string} p.user       değişen kısım (bağlam + istek)
 * @param {object} [p.schema]   JSON Schema (additionalProperties:false)
 * @param {number} [p.maxTokens]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{text:string, json:any|null, usage:object, costUsd:number|null,
 *   cache:{read:number, write:number, flagged:boolean}, durationMs:number, model:string,
 *   stopReason:string, requestId:string|null}>}
 */
export async function complete({ system, stable, user, schema = null, maxTokens, signal } = {}) {
  const k = apiKey();
  if (!k) throw err("NO_KEY", "ANTHROPIC_API_KEY yok — sunucuda ortam değişkeni ver.");
  if (!user || !String(user).trim()) throw err("BAD_INPUT", "istem boş");

  const s = settings();
  const cap = capabilities(s.model);
  const body = {
    model: s.model,
    max_tokens: maxTokens ? clampInt(maxTokens, s.maxTokens, 256, 64000) : s.maxTokens,
    messages: [{ role: "user", content: String(user) }],
  };
  const sys = buildSystemBlocks({ system, stable, cacheMinTokens: s.cacheMinTokens });
  if (sys.length) body.system = sys;
  const flagged = sys.some((b) => b.cache_control);
  if (cap.adaptiveThinking && s.thinking) body.thinking = { type: "adaptive" };
  const outCfg = {};
  if (cap.effort && s.effort) outCfg.effort = s.effort;
  if (schema) outCfg.format = { type: "json_schema", schema };
  if (Object.keys(outCfg).length) body.output_config = outCfg;

  const t0 = Date.now();
  const res = await postWithRetry(`${s.baseUrl}/v1/messages`, k.key, body, s, signal);
  const durationMs = Date.now() - t0;
  const requestId = res.headers.get("request-id");

  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    const code = res.status === 401 || res.status === 403 ? "AUTH"
      : res.status === 429 ? "RATE_LIMIT"
      : res.status === 400 ? "BAD_REQUEST"
      : "API_ERROR";
    throw err(code, `Anthropic API ${res.status}: ${msg}`, { status: res.status, requestId });
  }

  const stopReason = data?.stop_reason ?? "end_turn";
  const text = (data?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const usage = data?.usage ?? {};
  const model = data?.model ?? s.model;
  const costUsd = estimateCost(usage, model) ?? estimateCost(usage, s.model);
  const cache = {
    read: Number(usage.cache_read_input_tokens || 0),
    write: Number(usage.cache_creation_input_tokens || 0),
    flagged,
  };

  if (stopReason === "refusal") {
    throw err("REFUSAL", `Model isteği reddetti${data?.stop_details?.category ? ` (${data.stop_details.category})` : ""}.`, { requestId, usage, costUsd });
  }
  if (stopReason === "max_tokens") {
    throw err("TRUNCATED", `Yanıt max_tokens (${body.max_tokens}) sınırında kesildi — AI_MAX_TOKENS'ı artır.`, { requestId, usage, costUsd });
  }

  let json = null;
  if (schema) {
    try { json = JSON.parse(text); }
    catch (e) { throw err("BAD_JSON", `Şemalı yanıt JSON değil: ${e.message}`, { requestId, usage, costUsd, text }); }
  }
  return { text, json, usage, costUsd, cache, durationMs, model, stopReason, requestId };
}

/**
 * 429/529/5xx'te BİR kez tekrar (Retry-After'a uyar, en çok 20 sn; yoksa
 * AI_RETRY_MS). 4xx'in kalanı tekrarlanmaz: aynı gövde aynı hatayı verir.
 * Zaman aşımı AbortController; dış sinyal de iptal edebilir.
 */
async function postWithRetry(url, key, body, s, outerSignal) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": API_VERSION,
  };
  const once = async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), s.timeoutMs);
    const onOuter = () => ac.abort();
    outerSignal?.addEventListener("abort", onOuter, { once: true });
    try {
      return await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) throw err("TIMEOUT", `Anthropic API ${Math.round(s.timeoutMs / 1000)} sn içinde yanıt vermedi.`);
      throw err("NETWORK", `Anthropic API'ye ulaşılamadı: ${e.message}`);
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuter);
    }
  };
  const first = await once();
  if (!(first.status === 429 || first.status === 529 || first.status >= 500)) return first;
  const ra = Number(first.headers.get("retry-after"));
  const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : s.retryMs;
  await new Promise((r) => setTimeout(r, waitMs));
  return once();
}
