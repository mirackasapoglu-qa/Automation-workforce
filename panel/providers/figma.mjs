/**
 * Figma sağlayıcısı — "design" yeteneği.
 *
 * ⚠️ HİÇ ÇAĞRI YAPMAZ. Üç uç da Tier 1 ve View/Collab koltuğunda limit ayda 6
 * istek; durumu yoklamanın kendisi kotayı bitiriyordu. Durum, gerçek çağrıların
 * `figma-quota.mjs`'e bıraktığı nottan okunur. check() saf yerel okuma.
 *
 * KİMLİK: kişisel erişim token'ı (`figd_…`, `X-Figma-Token` başlığı).
 * Figma OAuth'u Faz 3'te (token yenileme + dört çağrı yerinde başlık değişimi).
 */
import fs from "node:fs";
import path from "node:path";
import { resolve, credLabel } from "../auth/credential-store.mjs";
import { quotaCheck } from "../figma-quota.mjs";

export const key = "figma";
export const label = "Figma";
export const icon = "figma";
export const order = 20;
export const capabilities = ["design"];

export const auth = {
  apiKey: {
    file: ".figma-credentials",
    vars: [{ name: "FIGMA_TOKEN", label: "Kişisel erişim token'ı (figd_…)", secret: true }],
    setupUrl: "https://www.figma.com/settings",
    steps: ["Figma > Settings > Personal access tokens ile token üret", "Token'ı buraya gir (kota yüzünden ağa çıkılıp doğrulanmaz; ilk gerçek çağrı doğrular)"],
  },
};

export const credential = { file: auth.apiKey.file, vars: auth.apiKey.vars.map((v) => v.name) };
export const credentialLabel = credLabel(credential.file, credential.vars);
export const setupUrl = auth.apiKey.setupUrl;
export const setupFix = auth.apiKey.steps;

const NOTES_FILE = path.join(process.cwd(), "panel-data", "quota-notes.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

export function configured() { return resolve(key, credential.vars, { file: credential.file }).ok; }

/**
 * Panelden kimlik kaydedilince çağrılır. AĞA ÇIKMAZ (kota): token biçimen
 * doğruysa kabul; gerçek doğrulama ilk diff/render çağrısında olur.
 * `check()` kota bloke olunca "blocked" döner — o token'ın geçersizliği değil.
 */
export function probe() {
  const r = resolve(key, credential.vars, { file: credential.file });
  if (!r.ok) return { ok: false, detail: "FIGMA_TOKEN yok" };
  const looksRight = /^figd_/.test(r.values.FIGMA_TOKEN) || r.values.FIGMA_TOKEN.length >= 20;
  return looksRight
    ? { ok: true, detail: "kaydedildi — kota yüzünden ağa çıkılmadı, ilk gerçek çağrı doğrular" }
    : { ok: false, detail: "token biçimi beklenen gibi değil (figd_… ya da 20+ karakter)" };
}

/** MCP tarafı: çağrı yapılmaz, elle tutulan nottan okunur. */
function mcpPart() {
  const n = readJson(NOTES_FILE, {}).figmaMcp;
  if (!n) return { label: "MCP", state: "unknown", detail: "not yok" };
  if (n.dailyLimit) {
    return { label: "MCP", state: "ok", detail: `${n.dailyLimit}/gün${n.perMinute ? `, ${n.perMinute}/dk` : ""} (${n.seat} seat)` };
  }
  const resets = n.resetsAt ? new Date(n.resetsAt) : null;
  const open = resets ? Date.now() > resets.getTime() : false;
  return {
    label: "MCP",
    state: open ? "unknown" : "blocked",
    detail: open
      ? `kota yenilenmiş olabilir (${n.monthlyLimit}/ay, ${n.seat} seat) — teyit edilmedi`
      : `${n.monthlyLimit}/ay tükendi (${n.seat} seat) — ${resets ? resets.toISOString().slice(0, 10) : "?"} sonrası`,
  };
}

const WORST = ["off", "blocked", "warn", "unknown", "ok"];
const worstOf = (states) => WORST.find((w) => states.includes(w)) ?? "unknown";

export function check() {
  if (!configured()) {
    return { state: "off", detail: "FIGMA_TOKEN yok — tasarım diff'i kapalı", parts: [], fix: setupFix };
  }
  const parts = [
    { label: "/files", ...quotaCheck("files", { key: "figmaFiles", label: "/files" }) },
    { label: "/images", ...quotaCheck("images", { key: "figmaImages", label: "/images" }) },
    mcpPart(),
  ];
  const state = worstOf(parts.map((p) => p.state));
  return {
    state,
    detail: parts.map((p) => `${p.label}: ${p.detail}`).join(" · "),
    parts,
    note: "Üç uç da Tier 1, TEK sayaç. Limit koltuğa bağlı: View/Collab 6/ay, Dev/Full 10-20/dk. Panel yoklama YAPMAZ — durum gerçek çağrıların notundan.",
    fix: state === "blocked"
      ? ["Kota penceresi dolana kadar bekle (tarih yukarıda)",
         "Koltuğu Dev/Full'e yükselt — Tier 1 6/ay yerine 10-20/dk olur",
         "Kota kapalıyken: node scripts/figma-offline-diff.mjs (API çağrısı yapmaz)"]
      : [],
  };
}

/** "design" yeteneği — tasarım kaynağını çözer (şimdilik proje profilinden). */
export const design = {
  async fileKey() { return (await import("../project.mjs")).PROJECT.figma?.fileKey ?? null; },
};
