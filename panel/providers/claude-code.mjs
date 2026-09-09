/**
 * Claude sağlayıcısı — "ai" yeteneği (senaryo önerme, perf yorumlama, test case
 * üretimi). Anahtar `claude-code` olarak KALDI: profiller (`connectors.ai`) ve
 * `panel-data/connectors.json` bu adı taşıyor.
 *
 * Üç yol, tek sıra (panel/ai/provider.mjs):
 *   api    — ANTHROPIC_API_KEY (sunucu: tek anahtar; panelden de girilebilir)
 *   cli    — makinedeki Claude Code CLI (geliştirici: kendi oturumu + MCP'leri)
 *   manual — istem üret + yapıştır (her zaman açık, hiç kimlik istemez)
 *
 * Durum AĞA ÇIKMADAN verilir: anahtarı doğrulamak ücretli bir istek; geçersiz
 * anahtar ilk gerçek çağrıda AUTH koduyla görünür.
 */
import { status, cliBinary } from "../ai/provider.mjs";
import { CRED } from "../ai/anthropic.mjs";
import { credLabel } from "../auth/credential-store.mjs";

export const key = "claude-code";
export const label = "Claude";
export const icon = null;
export const order = 10;
export const capabilities = ["ai"];

export const auth = {
  apiKey: {
    file: CRED.file,
    vars: [{ name: "ANTHROPIC_API_KEY", label: "Anthropic API anahtarı (sk-ant-…)", secret: true }],
    setupUrl: "https://console.anthropic.com/settings/keys",
    steps: [
      "Anthropic Console > API Keys ile anahtar üret ve buraya gir",
      "Sunucuda alternatif: ANTHROPIC_API_KEY ortam değişkeni (+ isteğe bağlı AI_MODEL, AI_DAILY_USD)",
      "Yerelde anahtar yoksa Claude Code CLI (`claude`) kullanılır; o da yoksa istem üret + yapıştır",
    ],
  },
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = `${credLabel(CRED.file, CRED.vars)} (sunucu) · yerel Claude Code CLI · ya da elle yapıştırma`;
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

/** Elle yol her zaman var; "kurulu" demek tek tık var demek. */
export function configured() { return status().mode !== "manual"; }

export function check() {
  const s = status();
  const b = s.budget;
  const harcama = b?.capUsd
    ? `bugün $${b.usd.toFixed(2)} / $${b.capUsd.toFixed(2)} (${b.calls} çağrı)`
    : `bugün $${(b?.usd ?? 0).toFixed(2)} (${b?.calls ?? 0} çağrı)`;
  if (s.mode === "api") {
    return {
      state: "ok",
      detail: `API anahtarı · ${s.model} · effort ${s.effort}`,
      note: `Tek tık üretim açık. ${harcama}. Günlük tavan AI_DAILY_USD ile.`,
      parts: [
        { label: "yol", state: "ok", detail: "Messages API" },
        { label: "bütçe", state: b?.capUsd && b.usd >= b.capUsd ? "blocked" : "ok", detail: harcama },
      ],
      fix: [],
    };
  }
  if (s.mode === "cli") {
    return {
      state: "ok",
      detail: `yerel Claude Code CLI · ${cliBinary()}`,
      note: `Tek tık üretim açık (kullanıcının Claude Code oturumu ve MCP'leriyle). ${harcama}. Sunucuda bu yol yok — orada ANTHROPIC_API_KEY.`,
      parts: [{ label: "yol", state: "ok", detail: "claude -p (araçlar kapalı)" }],
      fix: [],
    };
  }
  return {
    state: "warn",
    detail: "tek tık kapalı — yalnızca istem üret + yapıştır",
    note: "Ne ANTHROPIC_API_KEY ne Claude Code CLI bulundu. Üç AI özelliği kopyala-yapıştır ile çalışmaya devam eder.",
    parts: [{ label: "yol", state: "warn", detail: "elle" }],
    fix: setupFix,
  };
}
