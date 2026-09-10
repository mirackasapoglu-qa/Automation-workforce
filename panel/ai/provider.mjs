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
 * `stable`: sorgudan bağımsız sabit zemin (rag/digest.mjs). API yolunda ayrı
 * sistem bloğu olarak gider ve eşiği aşınca önbelleklenir; CLI yolunda metne
 * eklenir (CLI'de önbellek yok, o yüzden çağıran kısa tutar).
 *
 * Bu dosya proje adı bilmez (`npm run panel:check`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiKey, settings, complete } from "./anthropic.mjs";
import { askClaude, parseJsonLoose } from "../claude-cli.mjs";
import { assertBudget, record, spentToday, withSlot } from "./budget.mjs";
import * as accounts from "../auth/claude-accounts.mjs";
import { isCut } from "../connectors/cuts.mjs";

/** Bu sağlayıcının kayıt defterindeki anahtarı — şalter (kopar) bununla sorulur. */
const PROVIDER = "claude-code";

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ---- CLI var mı (PATH taraması, 60 sn önbellek — her preflight'ta disk taramasın)
let cliCache = { at: 0, bin: null };

/** Testler ve "CLI'yi yeni kurdum" durumu için önbelleği düşürür. */
export function resetCliCache() { cliCache = { at: 0, bin: null }; }

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

/**
 * Etkin yol: "api" | "cli" | "manual".
 *
 * `cli` iki şekilde açılır: panele eklenmiş Claude hesabı (abonelik token'ı,
 * sunucu yolu) ya da makinede zaten giriş yapılmış CLI (geliştirici yolu).
 * Hesap varsa CLI'nin PATH'te olması yine şart — komutu o çalıştırıyor.
 */
/**
 * Kurulu CLI'nin KENDİ oturumu var mı.
 *
 * ⚠️ Sunucudaki imajda CLI **relay için** kurulu (panelden giriş `claude
 * setup-token` çalıştırıyor) ama hiç kimse o kutuda giriş yapmamış olabilir.
 * Bu ayrım yapılmadığı sürece panel hesap yokken bile "tek tık üretim açık"
 * diyordu ve her üretim kimlik hatasıyla düşüyordu (ölçüldü 2026-09-10:
 * sunucuda hesap yok, anahtar yok, `mode:"cli"`, `oneClick:true`).
 *
 * Claude Code kimliği Linux'ta `<config dir>/.credentials.json` içinde tutuyor
 * (binary'den doğrulandı; boş kurulumda dosya yok). macOS'ta Keychain'e
 * yazabildiği için orada dosyanın YOKLUĞU kanıt değil — eleme yalnız Linux'ta.
 */
function cliSessionReady() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  if (process.platform !== "linux") return true;
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  try { fs.accessSync(path.join(dir, ".credentials.json")); return true; } catch { return false; }
}

export function mode() {
  /*
   * ⚠️ ŞALTER ÖNCE. "Kopar" bu servisi KULLANMA demek; API anahtarı yolu zaten
   * `resolveCred` içinde kesiliyordu ama hesap ve yerel CLI yolları kesilmiyordu
   * — Claude koparılmışken tek tık üretim çalışmaya devam ediyordu (ölçüldü
   * 2026-09-10). Kimlik SİLİNMEZ: geri bağlamak tek tık.
   */
  if (isCut(PROVIDER)) return "manual";
  const forced = (process.env.AI_PROVIDER || "auto").trim().toLowerCase();
  const cliReady = Boolean(cliBinary());
  if (forced === "api") return apiKey() ? "api" : "manual";
  if (forced === "cli") return cliReady ? "cli" : "manual";
  if (forced === "manual") return "manual";
  // Hesap eklenmisse abonelik yolu API anahtarindan ONCE gelir: ekip bilincli
  // olarak kendi hesabini bagladi, panelde duran bir anahtar onu golgelememeli.
  if (cliReady && accounts.count() > 0) return "cli";
  if (apiKey()) return "api";
  // Ciplak CLI yolu yalnizca CLI'nin kendi oturumu varsa acilir.
  if (cliReady && cliSessionReady()) return "cli";
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
    const list = accounts.list();
    return {
      ...base,
      model: null,
      cliBin: cliBinary(),
      accounts: list,
      relay: accounts.relaySupported({ claudeBin: cliBinary() }),
      detail: list.length
        ? `Claude aboneliği · ${list.length} hesap (${list.map((a) => a.label).join(", ")})`
        : `yerel Claude Code CLI (${cliBinary()}) — makinedeki oturum`,
    };
  }
  const kopuk = isCut(PROVIDER);
  return {
    ...base,
    model: null,
    cut: kopuk || undefined,
    accounts: accounts.list(),
    relay: accounts.relaySupported({ claudeBin: cliBinary() }),
    detail: kopuk
      ? "bağlantı koparıldı — kimlik ve hesaplar yerinde, rozete tıklayınca geri gelir"
      : "tek tık kapalı — Claude hesabı ekle, ANTHROPIC_API_KEY ver ya da Claude Code CLI kur; istem üret + yapıştır yolu açık",
  };
}

/**
 * Model çağrısı. Şema verilirse `json` dolu döner (API'de sunucu şeması,
 * CLI'de gevşek ayrıştırma + bir kez düzeltici tekrar).
 *
 * @param {object} p
 * @param {string} p.purpose  denetim/defter etiketi (ör. "testcase-generate")
 * @param {string} p.system   kısa talimat
 * @param {string} [p.stable] sabit zemin (önbelleklenebilir)
 * @param {string} p.user     bağlam + istek
 * @param {object} [p.schema] JSON Schema
 * @param {number} [p.maxTokens]
 * @param {string} [p.account] hangi Claude hesabı (CLI yolu); verilmezse ilki
 */
export async function ask({ purpose = "ai", system = "", stable = "", user, schema = null, maxTokens, account = null } = {}) {
  const m = mode();
  if (m === "manual") {
    throw err("NO_PROVIDER", isCut(PROVIDER)
      ? "Claude bağlantısı koparılmış — Bağlantılar kartındaki rozete tıklayıp geri bağla (kimlik ve hesaplar yerinde duruyor)."
      : "Tek tık üretim kapalı: ne Claude hesabı, ne ANTHROPIC_API_KEY, ne Claude Code CLI var. İstem üret + yapıştır yolu çalışır.");
  }
  if (!user || !String(user).trim()) throw err("BAD_INPUT", "istem boş");
  assertBudget();

  /*
   * Hesap seçimi CLI yolunda: kişi kendi aboneliğiyle koşar. Otomatik geçiş
   * YOK — istenen hesap yoksa hata, sessizce başkasının hesabına düşmek
   * abonelik paylaşımı olurdu.
   */
  let acct = null;
  if (m === "cli") {
    if (account && !accounts.has(account)) throw err("NO_ACCOUNT", `Seçilen Claude hesabı yok: ${account}`);
    acct = accounts.envFor(account);
  }

  const t0 = Date.now();
  try {
    const out = await withSlot(() => (m === "api"
      ? complete({ system, stable, user, schema, maxTokens })
      : viaCli({ system, stable, user, schema, account: acct })));
    if (acct) accounts.touch(acct.id);
    record({
      purpose, provider: m, model: out.model, ok: true, costUsd: out.costUsd, ms: out.durationMs,
      account: acct?.label ?? null,
      usage: out.usage ?? null, cacheRead: out.cache?.read ?? null, cacheWrite: out.cache?.write ?? null,
    });
    return { provider: m, account: acct ? { id: acct.id, label: acct.label } : null, ...out };
  } catch (e) {
    record({ purpose, provider: m, model: e.model ?? null, ok: false, code: e.code ?? null, account: acct?.label ?? null, costUsd: e.costUsd ?? null, ms: Date.now() - t0, error: String(e.message).slice(0, 200) });
    throw e;
  }
}

/**
 * CLI yolu. Sistem + zemin + kullanıcı tek metin olarak gider (CLI'nin sistem
 * alanı yok). Bozuk JSON ARALIKLI bir sorun (aynı istem bir geçerli bir bozuk
 * üretti, ölçüldü) — tek seferlik düzeltici tekrar burada, çağıranlarda değil.
 */
async function viaCli({ system, stable, user, schema, account = null }) {
  const opt = account ? { env: account.env, account: { id: account.id, label: account.label } } : {};
  const prompt = [system, stable, user].filter(Boolean).join("\n\n");
  let r = await askClaude(prompt, opt);
  let json = null;
  if (schema) {
    try {
      json = parseJsonLoose(r.text);
    } catch (parseErr) {
      const fix = `${prompt}\n\n---\nUYARI: önceki yanıt GEÇERLİ JSON DEĞİLDİ (${String(parseErr.message).slice(0, 120)}). `
        + "Yalnızca geçerli, tek parça JSON döndür; metin içinde çift tırnak kullanma.";
      const r2 = await askClaude(fix, opt);
      r = { ...r2, costUsd: (r.costUsd ?? 0) + (r2.costUsd ?? 0), durationMs: r.durationMs + r2.durationMs, retried: true };
      json = parseJsonLoose(r.text);
    }
  }
  return {
    text: r.text, json, usage: null, costUsd: r.costUsd, cache: null, durationMs: r.durationMs,
    model: r.model, models: r.models ?? null, stopReason: "end_turn", requestId: r.sessionId ?? null, retried: r.retried ?? false,
  };
}

/** Hata kodu → HTTP durumu (rotalar tek yerden eşler). */
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
    case "BAD_INPUT":
    case "NO_ACCOUNT": return 400;
    default: return 502;
  }
}

/** Kullanıcıya "şimdi ne yapayım" satırı. */
export function hintFor(code) {
  switch (code) {
    case "NO_PROVIDER":
    case "NO_CLI":
    case "NO_KEY": return "Bağlantılar → Claude kartından hesap ekle (kendi aboneliğinle), ANTHROPIC_API_KEY ver ya da yerelde Claude Code CLI kur. Bu arada 'İstem üret' ile kopyala-yapıştır yolu çalışır.";
    case "NO_ACCOUNT": return "Seçtiğin Claude hesabı silinmiş olabilir — listeden birini seç ya da yeni hesap ekle.";
    case "BUDGET": return "AI_DAILY_USD tavanı doldu; yarın sıfırlanır ya da tavanı artır.";
    case "BUSY": return "Başka bir üretim sürüyor; birkaç saniye sonra tekrar dene.";
    case "RATE_LIMIT": return "Bu hesabın kullanım limiti dolmuş. Limit yenilenene kadar bekle ya da kendi hesabınla başka bir hesap ekleyip onu seç — panel kendiliğinden başkasının hesabına geçmez.";
    case "AUTH": return "Anahtar geçersiz ya da süresi dolmuş — ANTHROPIC_API_KEY'i yenile.";
    case "TIMEOUT": return "Model zaman aşımına uğradı; istemi küçült ya da AI_TIMEOUT_MS'i artır.";
    case "REFUSAL": return "Model isteği reddetti; istem metnini gözden geçir.";
    case "TRUNCATED": return "Yanıt kesildi; en fazla case/senaryo sayısını düşür ya da AI_MAX_TOKENS'ı artır.";
    case "BAD_JSON": return "Model geçerli JSON döndürmedi; bir kez daha dene, tekrar ederse 'İstem üret' yolunu kullan.";
    case "BAD_REQUEST": return "API isteği reddetti (gövde/şema); mesajı Console loguyla karşılaştır, AI_MODEL değerini kontrol et.";
    default: return "Tekrar dene; sürerse 'İstem üret' ile kopyala-yapıştır yolu çalışır.";
  }
}
