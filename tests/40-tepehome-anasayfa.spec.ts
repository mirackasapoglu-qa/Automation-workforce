/*
 * ÜRÜN: Tepe Home redesign — anasayfa ve ana geçişler.
 *
 * ⚠️ Bu dosya ELLE DOĞRULANDI (2026-09-16): her locator gerçek DOM'a karşı
 * ölçüldü. Panelin AI üretimi aynı case'ler için uydurma seçiciler yazmıştı —
 * ölçülen farklar:
 *   · "Tüm Ürünler" adında bir bağlantı YOK; anasayfadaki bağlantının metni
 *     "TÜMÜNÜ GÖR" ve dördü birden `/tum-urunler`e gidiyor.
 *   · "Yeni Gelenler" / "Kampanyalı Ürünler" / "Koleksiyon Ürünleri" başlıkları
 *     LAZY — kaydırmadan DOM'a girmiyor.
 *
 * Test başlıkları kapsam ağacındaki case başlıklarıyla BİREBİR aynı olmak
 * zorunda: paket koşumunda sonuç satırı bu başlıkla case'e eşleniyor.
 */
import { test, expect } from "@playwright/test";

/** Lazy bölümler kaydırmadan DOM'a girmiyor (repo kuralı: loadLazyContent). */
async function kaydir(page: import("@playwright/test").Page) {
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
}

test("Anasayfa temel bölümleriyle yüklenir", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Tepe Home/);
  await kaydir(page);

  for (const baslik of ["Yeni Gelenler", "Kampanyalı Ürünler", "Koleksiyon Ürünleri"]) {
    await expect(
      page.getByRole("heading", { name: baslik, exact: true }).filter({ visible: true }).first(),
      `'${baslik}' bölüm başlığı`,
    ).toBeVisible();
  }

  // Bölümlerde gerçekten ürün var mı: fiyat taşıyan kart sayısı.
  // (Kart konteyneri Tailwind hash'li, başlıktan XPath ile inmek kırılgan.)
  const kartlar = page.locator("a").filter({ hasText: "₺" });
  expect(await kartlar.count(), "fiyatlı ürün kartı").toBeGreaterThan(2);
});

test("Anasayfadan Tüm Ürünler sayfasına geçiş", async ({ page }) => {
  await page.goto("/");
  // ⚠️ Bağlantının METNİ "TÜMÜNÜ GÖR"; hedefe göre seçiyoruz ki metin
  // değişirse bile test kırılmasın.
  await page.locator('a[href="/tum-urunler"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/tum-urunler\/?$/);
  await expect(page).toHaveTitle("Tüm Ürünler - Tepe Home");
});
