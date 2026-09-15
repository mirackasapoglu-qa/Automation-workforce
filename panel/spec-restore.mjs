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
import { restoreGenerated, storeSpec } from "./spec-gen.mjs";
import { restoreFromTree, GENERATOR } from "./recorded-spec.mjs";

const TESTS = path.join(process.cwd(), "tests");

/**
 * @param {() => {tree: Array}} readTree ağacı okuyan fonksiyon (enjekte edilir:
 *   bu modül scope.mjs'in yazma katmanına bağlı olmasın)
 * @param {{product?: string}} opts
 */
export function restoreSpecs(readTree, { product = "" } = {}) {
  const depo = restoreGenerated();

  /*
   * ⚠️ ESKİ ÜRETEÇTEN ÇIKMIŞ DOSYA TAZELENİR. Dosya diskte duruyor diye
   * atlamak yetmiyordu: üreteçteki seçici hataları düzeltildikten sonra bile
   * depodaki (volume) eski kopya her deploy'da geri konup yeni render'ı
   * gölgeliyordu — yani düzeltme elde duran kayıtlara HİÇ ulaşmazdı.
   *
   * Yalnız ÜRETEÇ ÇIKTISI tazelenir ve yalnız sürüm eskiyse: dosya başlığında
   * güncel `üretici: kayıt vN` varsa dokunulmaz. Sunucuda spec dosyasını elle
   * düzenlemenin bir yolu yok, yani tazelenen şey her zaman makine çıktısı.
   */
  const guncelMi = (f) => {
    try {
      const bas = fs.readFileSync(path.join(TESTS, f), "utf8").slice(0, 600);
      const m = bas.match(/üretici\s*:\s*kayıt v(\d+)/);
      return m ? Number(m[1]) >= GENERATOR : false;
    } catch { return false; }
  };

  let agac = { restored: [], skipped: 0 };
  let tazelenen = 0;
  try {
    const { tree } = readTree();
    agac = restoreFromTree(tree, {
      exists: (f) => {
        const vardi = fs.existsSync(path.join(TESTS, f));
        if (vardi && !guncelMi(f)) { tazelenen++; return false; }   // eski surum -> yeniden uret
        return vardi;
      },
      // Kalici kopya da guncellensin: yoksa bir sonraki deploy eskisini geri koyar.
      write: (f, icerik) => storeSpec(f, icerik),
      product,
    });
  } catch { /* agac okunamazsa depodan geleni yine de koru */ }

  return {
    restored: [...depo.restored, ...agac.restored],
    fromStore: depo.restored.length,
    fromTree: agac.restored.length,
    refreshed: tazelenen,
    adopted: depo.adopted.length,
  };
}
