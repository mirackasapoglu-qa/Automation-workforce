/**
 * ÜRETİLMİŞ SPEC'LERİ GERİ GETİRME — deploy sonrası "Bilinmeyen spec" onarımı.
 *
 * İki kaynak, tek çağrı:
 *   1. `panel-data/generated/` — üretilen her spec'in KALICI kopyası (volume).
 *   2. Kapsam ağacındaki kayıt adımları (`testCase.recorded`) — kaydediciden
 *      gelen `gen-rec-*` dosyaları modelsiz, deterministik olarak yeniden
 *      üretilebiliyor.
 *
 * Neden gerekli: `tests/` dizini İMAJIN içinde ve `tests/gen-*.spec.ts`
 * gitignore'da; her deploy imajı git'ten yeniden kuruyor, yani üretilen
 * dosyalar siliniyor. Ağaçtaki referans (`runRef.specs`) ise volume'de kalıyor.
 * Sonuç, canlıda ölçüldü (2026-09-15): ağaç iki gen spec istiyor, `/api/specs`
 * sıfır tanesini görüyor, koşum "Bilinmeyen spec" diyor.
 *
 * ⚠️ HİÇBİR DOSYA EZİLMEZ. Yalnızca gerçekten eksik olanlar yazılır — üretilen
 * kod elle düzeltilmiş olabilir ve dosya başlığı zaten bunu teşvik ediyor.
 *
 * ⚠️ 2. kaynak 1.'den ÖNCEKİ kayıtları da kurtarır: bu değişiklikten önce
 * kaydedilen spec'lerin kalıcı kopyası hiç oluşmamıştı, ama adımları ağaçta.
 */
import fs from "node:fs";
import path from "node:path";
import { restoreGenerated } from "./spec-gen.mjs";
import { restoreFromTree } from "./recorded-spec.mjs";

const TESTS = path.join(process.cwd(), "tests");

/**
 * @param {() => {tree: Array}} readTree ağacı okuyan fonksiyon (enjekte edilir:
 *   bu modül scope.mjs'in yazma katmanına bağlı olmasın)
 * @param {{product?: string}} opts
 */
export function restoreSpecs(readTree, { product = "" } = {}) {
  const depo = restoreGenerated();

  let agac = { restored: [], skipped: 0 };
  try {
    const { tree } = readTree();
    agac = restoreFromTree(tree, {
      exists: (f) => fs.existsSync(path.join(TESTS, f)),
      write: (f, icerik) => {
        fs.mkdirSync(TESTS, { recursive: true });
        fs.writeFileSync(path.join(TESTS, f), icerik);
      },
      product,
    });
  } catch { /* agac okunamazsa depodan geleni yine de koru */ }

  return {
    restored: [...depo.restored, ...agac.restored],
    fromStore: depo.restored.length,
    fromTree: agac.restored.length,
    adopted: depo.adopted.length,
  };
}
