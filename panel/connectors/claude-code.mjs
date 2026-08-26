/**
 * Claude Code connector — "ai" yeteneği (senaryo önerme, perf yorumlama,
 * test case üretimi).
 *
 * Diğerlerinden farkı: KİMLİK İSTEMEZ. Eskiden bu yeteneği `anthropic.mjs`
 * karşılıyordu ve panel modeli kendisi çağırdığı için ayrı bir API anahtarı
 * (ya da `ant auth login` profili) şarttı; anahtar yoksa üç özellik birden
 * kapalı kalıyordu. Artık panel model ÇAĞIRMAZ: bağlamdan prompt kurar,
 * kullanıcı onu zaten açık olan Claude Code sohbetine verir, dönen JSON panele
 * yapıştırılır. Kimlik zinciri kullanıcının Claude Code oturumudur — panelin
 * yoklayabileceği bir dosya ya da ortam değişkeni yok, bu yüzden durum
 * koşulsuz "bağlandı".
 */
export const key = "claude-code";
export const label = "Claude Code";
export const icon = null;
export const capabilities = ["ai"];
/** Yoklanacak kimlik yok — panel adına çağrı yapmıyor. */
export const credential = {};
export const credentialLabel = "kimlik gerekmez — prompt Claude Code'a elle verilir";

export const setupFix = [];

export function configured() { return true; }

export function check() {
  return {
    state: "ok",
    detail: "anahtar gerekmez — prompt kopyalanır, yanıt panele yapıştırılır",
    note:
      "Senaryo öner, perf yorumu ve test case üretimi prompt üretir; JSON yanıtı " +
      "aynı kutuya yapıştırınca panel kapısından geçirilir.",
    fix: [],
  };
}
