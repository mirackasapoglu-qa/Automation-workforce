/**
 * Claude connector — "ai" yeteneği (senaryo önerme, perf yorumlama, test case
 * üretimi). Anahtar `claude-code` olarak KALDI: profiller (`connectors.ai`)
 * ve `panel-data/connectors.json` bu adı taşıyor.
 *
 * Üç yol, tek sıra (panel/ai/provider.mjs):
 *   api    — ANTHROPIC_API_KEY (sunucu: tek anahtar, başka kurulum yok)
 *   cli    — makinedeki Claude Code CLI (geliştirici: kendi oturumu + MCP'leri)
 *   manual — istem üret + yapıştır (her zaman açık, hiç kimlik istemez)
 *
 * Durum AĞA ÇIKMADAN verilir: anahtarı doğrulamak ücretli bir istek; geçersiz
 * anahtar ilk gerçek çağrıda AUTH koduyla görünür ve arayüz ne yapılacağını söyler.
 * `manual` → `warn`: özellik kapanmadı ama "tek tık" yok; rozet amber yanar,
 * sunucuya anahtar konmadığını hatırlatır. Yerelde CLI varken `ok`.
 */
import { status, cliBinary } from "../ai/provider.mjs";
import { CRED } from "../ai/anthropic.mjs";
import { credLabel } from "./credentials.mjs";

export const key = "claude-code";
export const label = "Claude";
export const icon = null;
export const capabilities = ["ai"];
export const credential = { file: CRED.file, vars: CRED.vars };
export const credentialLabel =
  `${credLabel(CRED.file, CRED.vars)} (sunucu) · yerel Claude Code CLI · ya da elle yapıştırma`;

/** Anahtar sayfası — panel "kimlik" satırını buraya link yapar. */
export const setupUrl = "https://platform.claude.com/settings/keys";

export const setupFix = [
  "Sunucu: Dokploy'a ANTHROPIC_API_KEY ver (isteğe bağlı AI_MODEL, AI_DAILY_USD)",
  "Yerel: npm i -g @anthropic-ai/claude-code → `claude` PATH'te olsun (CLAUDE_BIN ile yol verilebilir)",
  "İkisi de yoksa 'İstem üret' + yapıştır yolu çalışmaya devam eder",
];

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
      note: `Tek tık üretim açık. ${harcama}. Kimlik: ${s.keySource === "env" ? "ortam değişkeni" : "~/.anthropic-credentials"}. Günlük tavan AI_DAILY_USD ile.`,
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
