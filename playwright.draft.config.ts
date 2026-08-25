/**
 * Kaydedici TASLAKLARI için ayrı config.
 *
 * Neden ayrı: taslaklar `panel-data/recorded/` altında, yani ana `testDir`in
 * DIŞINDA duruyor — bir taslağın ham adımlarıyla gerçek suite'e karışması
 * yapısal olarak mümkün olmasın diye (2026-08-21'de `tests/.recorded/`
 * altındaki bir taslağın `./fixtures` import'u tüm suite'i
 * "0 tests in 0 files" haline getirmişti).
 *
 * Çıktı dizini de ayrı: `outputDir` devralınsaydı Playwright koşum başında
 * `test-results/`'ı temizlediği için taslak koşmak GERÇEK suite'in
 * `results.json`'ını silerdi — panelin "Son sonuçlar" görünümü boşalır,
 * oran defteri de o koşumu bir daha göremezdi. (Ölçtük: 2026-08-21'de
 * ilk taslak koşumu tam bunu yaptı.)
 *
 * Kullanım (panel bunu kendisi yapıyor):
 *   npx playwright test --config playwright.draft.config.ts <dosya.spec.ts>
 */
import base from "./playwright.config";

export default {
  ...base,
  testDir: "./panel-data/recorded",
  outputDir: "./test-results/draft",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/draft/results.json" }],
  ],
} as typeof base;
