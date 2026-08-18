import { test, expect } from "./fixtures";
import { ProductPage } from "../pages/ProductPage";
import { FavoritesPage } from "../pages/FavoritesPage";
import { TEST_PRODUCTS } from "./routes";

/**
 * TEST HİJYENİ: favori durumu test sonunda BAŞLANGIÇ DEĞERİNE döndürülür.
 * Ürün zaten favorideyse test onu önce çıkarır (aksi hâlde "sayı arttı mı"
 * ölçümü yanlış olur) ve sonunda eski durumuna geri koyar.
 */
test.describe("23 - Favoriler", () => {
  test("ürün favoriye eklenir, favorilerimde görünür, sonra kaldırılır", async ({ memberPage }) => {
    test.setTimeout(240_000);
    const product = new ProductPage(memberPage);
    const fav = new FavoritesPage(memberPage);

    await product.open(TEST_PRODUCTS.sapTest);
    const wasFavorited = await product.isFavorited();

    // Ölçüm temiz olsun: başlangıçta favoride OLMASIN
    await product.setFavorite(false);

    await fav.open();
    const before = await fav.count();

    // EKLE
    await product.open(TEST_PRODUCTS.sapTest);
    await product.setFavorite(true);
    expect(await product.isFavorited(), "buton favoriye eklendiğini göstermiyor").toBe(true);

    await fav.open();
    expect(await fav.count(), `favori sayısı ${before} → beklenen ${before + 1}`).toBe(before + 1);

    // KALDIR
    await product.open(TEST_PRODUCTS.sapTest);
    await product.setFavorite(false);
    await fav.open();
    expect(await fav.count(), "favori kaldırılamadı").toBe(before);

    // TEMİZLİK: başlangıç durumuna dön
    if (wasFavorited) {
      await product.open(TEST_PRODUCTS.sapTest);
      await product.setFavorite(true);
    }
  });

  test("favorilerim sayfası liste veya boş durum gösterir", async ({ memberPage }) => {
    const fav = new FavoritesPage(memberPage);
    await fav.open();

    await expect(fav.heading).toBeVisible();
    await fav.assertNotNotFound();

    const count = await fav.count();
    if (count === 0) {
      const body = await memberPage.locator("body").innerText();
      expect(body, "favori yok ama boş durum mesajı da yok").toMatch(
        /favori|bulunmamaktadır|bulunmuyor|boş/i,
      );
    }
  });
});
