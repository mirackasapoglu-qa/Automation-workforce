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
import * as accounts from "../auth/claude-accounts.mjs";

export const key = "claude-code";
export const label = "Claude";
export const icon = null;
export const order = 10;
export const capabilities = ["ai"];

export const auth = {
  /**
   * Abonelik hesapları — kişi kendi Claude hesabıyla bağlanır (API anahtarı
   * gerekmez). Arayüz bu bildirimi görünce hesap listesi + "Hesap ekle" çizer;
   * uçlar `panel/routes/claude.mjs`, depo `auth/claude-accounts.mjs`.
   */
  accounts: {
    kind: "claude-subscription",
    endpoint: "/api/claude/accounts",
    steps: [
      "Panelden giriş (sunucu): 'Hesap ekle' → çıkan adresi kendi tarayıcında aç → kendi Claude hesabınla gir → kodu panele yapıştır",
      "Ya da kendi makinende: `claude setup-token` → çıkan sk-ant-oat… token'ını panele yapıştır",
      "Her hesap sunucuda kendi yapılandırma dizinini alır (claude-1, claude-2, …)",
      "Limit dolunca panel BAŞKA hesaba geçmez — abonelik paylaşımı olurdu; hesabı sen seçersin",
    ],
  },
  apiKey: {
    file: CRED.file,
    vars: [{ name: "ANTHROPIC_API_KEY", label: "Anthropic API anahtarı (sk-ant-…)", secret: true }],
    setupUrl: "https://console.anthropic.com/settings/keys",
    steps: [
      "Anthropic Console > API Keys ile anahtar üret ve buraya gir",
      "Sunucuda alternatif: ANTHROPIC_API_KEY ortam değişkeni (+ isteğe bağlı AI_MODEL, AI_DAILY_USD)",
      "Abonelik hesabı eklenmişse o öncelikli; anahtar yolu isteyene açık kalır",
    ],
  },
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = `${credLabel(CRED.file, CRED.vars)} (sunucu) · yerel Claude Code CLI · ya da elle yapıştırma`;
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

/** Elle yol her zaman var; "kurulu" demek tek tık var demek. */
export function configured() { return status().mode !== "manual"; }

/**
 * Kartın göreceği hesap durumu (TOKEN YOK). Registry bunu `auth.accounts`
 * bildirimiyle birleştirip arayüze verir.
 */
export function accountState() {
  return {
    list: accounts.list(),
    relay: accounts.relaySupported({ claudeBin: cliBinary() }),
    // Suren "panelden giris" akislari: kart bunlari gosterir, devam ettirir,
    // iptal eder. Yoksa terk edilmis akislar gorunmez sekilde slot tutuyordu.
    logins: accounts.pendingList(),
  };
}

export function check() {
  const s = status();
  const b = s.budget;
  const harcama = b?.capUsd
    ? `bugün $${b.usd.toFixed(2)} / $${b.capUsd.toFixed(2)} (${b.calls} çağrı)`
    : `bugün $${(b?.usd ?? 0).toFixed(2)} (${b?.calls ?? 0} çağrı)`;
  // Suren "panelden giris" akislari kartta GORUNUR (her modda): eskiden
  // yalnizca "Baglan…" kutusu acilinca fark ediliyordu, o da akisi gostermiyordu.
  const suren = accounts.pendingList();
  const surenPart = suren.length
    ? [{
        label: "süren giriş",
        state: "warn",
        detail: `${suren.length} akış bekliyor (${suren.map((l) => l.label || l.loginId).join(", ")}) — "Bağlan…" kutusundan devam et ya da vazgeç`,
      }]
    : [];
  if (s.mode === "api") {
    return {
      state: "ok",
      detail: `API anahtarı · ${s.model} · effort ${s.effort}`,
      note: `Tek tık üretim açık. ${harcama}. Günlük tavan AI_DAILY_USD ile.`,
      parts: [
        { label: "yol", state: "ok", detail: "Messages API" },
        { label: "bütçe", state: b?.capUsd && b.usd >= b.capUsd ? "blocked" : "ok", detail: harcama },
        ...surenPart,
      ],
      fix: [],
    };
  }
  if (s.mode === "cli") {
    const list = accounts.list();
    const relay = accounts.relaySupported({ claudeBin: cliBinary() });
    if (list.length) {
      const suresiDolan = list.filter((a) => a.expired);
      return {
        state: suresiDolan.length === list.length ? "warn" : "ok",
        detail: `Claude aboneliği · ${list.length} hesap`,
        note: `Her hesap kendi token'ı ve kendi yapılandırma diziniyle koşar. ${harcama}. `
          + "Limit dolunca panel başka hesaba GEÇMEZ — hesabı sen seçersin.",
        parts: [
          ...list.map((a) => ({
            label: a.label,
            state: a.expired ? "warn" : "ok",
            detail: `${a.id}${a.lastUsedAt ? ` · son kullanım ${new Date(a.lastUsedAt).toLocaleDateString("tr-TR")}` : " · hiç kullanılmadı"}${a.expired ? " · süresi dolmuş" : ""}`,
          })),
          { label: "panelden giriş", state: relay.ok ? "ok" : "unknown", detail: relay.ok ? "açık" : relay.reason },
          ...surenPart,
        ],
        fix: suresiDolan.length ? ["Süresi dolan hesabı sil ve yeniden ekle (token bir yıllık)"] : [],
      };
    }
    return {
      state: "ok",
      detail: `yerel Claude Code CLI · ${cliBinary()}`,
      note: `Tek tık üretim açık (bu makinedeki Claude Code oturumuyla). ${harcama}. Sunucuda hesap ekle ya da ANTHROPIC_API_KEY ver.`,
      parts: [{ label: "yol", state: "ok", detail: "claude -p (araçlar kapalı)" }, ...surenPart],
      fix: [],
    };
  }
  // CLI kurulu ama oturumsuz olabilir (sunucudaki imajda relay icin kurulu):
  // "CLI bulunamadi" demek yaniltirdi, dogru adim "hesap ekle"dir.
  const cliVar = Boolean(cliBinary());
  const relay = accounts.relaySupported({ claudeBin: cliBinary() });
  return {
    state: "warn",
    detail: "tek tık kapalı — yalnızca istem üret + yapıştır",
    note: cliVar
      ? "Claude Code CLI kurulu ama bu makinede oturum açılmamış; hesap da anahtar da yok. "
        + "Panelden giriş yaparak kendi aboneliğini bağla ya da ANTHROPIC_API_KEY ver. "
        + "Üç AI özelliği o zamana kadar kopyala-yapıştır ile çalışmaya devam eder."
      : "Ne Claude hesabı, ne ANTHROPIC_API_KEY, ne Claude Code CLI bulundu. Üç AI özelliği kopyala-yapıştır ile çalışmaya devam eder.",
    parts: [
      { label: "yol", state: "warn", detail: "elle" },
      ...(cliVar ? [{ label: "panelden giriş", state: relay.ok ? "ok" : "unknown", detail: relay.ok ? "açık — hesap ekleyebilirsin" : relay.reason }] : []),
      ...surenPart,
    ],
    fix: auth.accounts.steps,
  };
}
