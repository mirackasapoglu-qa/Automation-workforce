/**
 * Anthropic connector — "ai" yeteneği (senaryo önerme, bulgu yorumlama).
 *
 * Diğerlerinden farkı: kimlik bir dosyada DEĞİL, ortamda ya da `ant auth login`
 * profilinde durur. Bu yüzden `credential.file` yok; kontrol yerel ve bedava.
 */
import { hasCredentials } from "../scenario-suggest.mjs";

export const key = "anthropic";
export const label = "Anthropic";
export const icon = null;
export const capabilities = ["ai"];
export const credential = { env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] };
export const credentialLabel = "ANTHROPIC_API_KEY ortam değişkeni ya da `ant auth login` profili";

export const setupFix = [
  "export ANTHROPIC_API_KEY=sk-...",
  "npm i -g @anthropic-ai/ant && ant auth login",
];

export function configured() { return hasCredentials(); }

export function check() {
  const ok = configured();
  return {
    state: ok ? "ok" : "off",
    detail: ok ? "kimlik var" : "anahtar yok — senaryo öner ve AI yorumu kapalı",
    note: "Kimlik panele değil ORTAMA verilir; panel yeniden başlatılmalı.",
    fix: ok ? [] : setupFix,
  };
}
