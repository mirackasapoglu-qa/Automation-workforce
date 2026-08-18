import { test, expect } from "./fixtures";
import { ProductPage } from "../pages/ProductPage";
import { FavoritesPage } from "../pages/FavoritesPage";
import { TEST_PRODUCTS } from "./routes";

/**
 * TEST HİJYENİ: favoriye eklenen ürün test sonunda kaldırılır (toggle geri alınır).
 */
test.describe("23 - Favoriler", () => {
  test("ürün favoriye eklenir, favorilerimde görünür, sonra kaldırılır", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(memberPage);
    const fav = new FavoritesPage(memberPage);

    await fav.open();
    const before = await fav.count();

    await product.open(TEST_PRODUCTS.sapTest);
    await expect(product.favoriteButton).toBeVisible({ timeout: 20_000 });
    await product.favoriteButton.click({ timeout: 15_000 });
    await memberPage.waitForTimeout(4000);

    await fav.open();
    const after = await fav.count();
    expect(after, `favori sayısı ${before} → ${after}, artmadı`).toBe(before + 1);

    // TEMİZLİK: aynı ürün sayfasında toggle'ı geri al
    await product.open(TEST_PRODUCTS.sapTest);
    await product.favoriteButton.click({ timeout: 15_000 }).catch(async () => {
      await memberPage.locator('button[aria-label*="Favori"]:visible').first().click();
    });
    await memberPage.waitForTimeout(4000);

    await fav.open();
    expect(await fav.count(), "favori kaldırılamadı — başlangıç durumuna dönülmedi").toBe(before);
  });
});
