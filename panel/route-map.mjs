/**
 * Rota → koşum eşlemesi (eşleme mantığı).
 *
 * Panel'in "Site" sekmesinde iframe'de hangi sayfa açıksa, o sayfanın testini
 * tek tıkla tetiklemek için kullanılır.
 *
 * Verinin kendisi proje profilinde: `panel/projects/<proje>.mjs → routes`
 * (`rules`, `specRuns`, `cardSpecs`). `runId` değerleri panel/runs.json
 * whitelist'indeki id'ler olmalı — whitelist dışı komut çalışmaz.
 */
import { PROJECT } from "./project.mjs";
import { cardSpecs } from "./card-map.mjs";

export const ROUTE_RULES = PROJECT.routes.rules;
export const SPEC_RUNS = PROJECT.routes.specRuns;
/**
 * ⚠️ SABİT DEĞİL, FONKSİYON: kart→spec eşlemesi panelden de düzenlenebiliyor
 * (`panel-data/card-specs.json`). Sabit bir nesne olarak dışa verilseydi panel
 * yeniden başlatılana kadar düzenleme etkisiz kalırdı — sessizce eski eşlemeyle
 * koşum tetiklenirdi. Çağıran her seferinde okur.
 */
export const CARD_SPECS = cardSpecs;

export function matchRoute(pathname = "/") {
  const p = (pathname.split("#")[0] || "/").replace(/\/+$/, "") || "/";
  const clean = p.split("?")[0];
  for (const r of ROUTE_RULES) {
    if (r.test(clean)) return { ...r, test: undefined, matched: clean };
  }
  return null;
}

/** Bir kart için tetiklenebilir koşumları döner. */
export function runsForCard(key) {
  const specs = cardSpecs()[key] ?? [];
  const seen = new Set();
  const runs = [];
  for (const spec of specs) {
    const runId = SPEC_RUNS[spec];
    if (runId && !seen.has(runId)) {
      seen.add(runId);
      runs.push({ runId, spec });
    }
  }
  return runs;
}
