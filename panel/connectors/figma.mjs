/**
 * Figma connector — "design" yeteneği.
 *
 * ⚠️ HİÇ ÇAĞRI YAPMAZ. Üç uç da Tier 1 ve View/Collab koltuğunda limit ayda 6
 * istek; durumu yoklamanın kendisi kotayı bitiriyordu. Durum, gerçek çağrıların
 * `figma-quota.mjs`'e bıraktığı nottan okunur. Bu kural connector arayüzüne
 * geçerken de korunuyor — check() saf yerel okuma.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveCreds, credLabel } from "./credentials.mjs";
import { quotaCheck } from "../figma-quota.mjs";

export const key = "figma";
export const label = "Figma";
export const icon = "figma";
export const capabilities = ["design"];
export const credential = { file: ".figma-credentials", vars: ["FIGMA_TOKEN"] };
export const credentialLabel = credLabel(credential.file, credential.vars);

/** Token uretme sayfasi — panel "kimlik" satirini buraya link yapar. */
export const setupUrl = "https://www.figma.com/settings";

export const setupFix = [
  "Figma > Settings > Personal access tokens ile token üret",
  "echo 'FIGMA_TOKEN=figd_...' > ~/.figma-credentials && chmod 600 ~/.figma-credentials",
];

const NOTES_FILE = path.join(process.cwd(), "panel-data", "quota-notes.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

export function configured() { return resolveCreds(credential.file, credential.vars).ok; }

/** MCP tarafı: çağrı yapılmaz, elle tutulan nottan okunur. */
function mcpPart() {
  const n = readJson(NOTES_FILE, {}).figmaMcp;
  if (!n) return { label: "MCP", state: "unknown", detail: "not yok" };
  if (n.dailyLimit) {
    return { label: "MCP", state: "ok",
      detail: `${n.dailyLimit}/gün${n.perMinute ? `, ${n.perMinute}/dk` : ""} (${n.seat} seat)` };
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
    return { state: "off", detail: "~/.figma-credentials yok — tasarım diff'i kapalı", parts: [], fix: setupFix };
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
