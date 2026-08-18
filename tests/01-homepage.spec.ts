import { test, expect } from "@playwright/test";
import { HomePage } from "../pages/HomePage";
import { BasePage } from "../pages/BasePage";

test.describe("01 - Anasayfa", () => {
  test("anasayfa yüklenir, başlık ve bilgi şeridi görünür", async ({ page }) => {
    const home = new HomePage(page);
    await home.open();

    await expect(page).toHaveTitle(/Tepe Home/);
    await home.assertNotNotFound();
    await expect(home.infoBar).toBeVisible();
  });

  test("ürün kartları render olur ve ürün detayına gider", async ({ page }) => {
    const home = new HomePage(page);
    await home.open();
    await home.loadLazyContent();

    expect(await home.productCardCount(), "anasayfada ürün kartı yok").toBeGreaterThan(0);

    const firstHref = await home.productCards.first().getAttribute("href");
    expect(firstHref).toMatch(/-p-/);

    await home.productCards.first().click();
    await home.settle(2500);
    expect(page.url()).toContain("-p-");
    await home.assertNotNotFound();
  });

  test("header öğeleri mevcut (kategoriler, arama, sepet, giriş, mağazalar)", async ({ page }) => {
    const home = new HomePage(page);
    await home.open();

    await expect(home.categoriesButton).toBeVisible();
    await expect(home.searchButton).toBeVisible();
    await expect(home.cartButton).toBeVisible();
    await expect(home.storesLink).toBeVisible();
    await expect(home.loginLink).toHaveAttribute("href", /\/giris/);
  });

  test("footer bülten alanı ve başa dön butonu çalışır", async ({ page }) => {
    const home = new HomePage(page);
    await home.open();

    await home.newsletterInput.scrollIntoViewIfNeeded();
    await expect(home.newsletterInput).toBeVisible();
    await expect(home.newsletterSubmit).toBeVisible();

    await home.backToTop.click({ timeout: 12_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(200);
  });

  test("anasayfada uygulama kaynaklı konsol hatası yok", async ({ page }) => {
    const errors = BasePage.collectConsoleErrors(page);
    const home = new HomePage(page);
    await home.open();
    await page.waitForTimeout(2500);

    const appErrors = BasePage.appErrorsOnly(errors);
    expect(appErrors, `Konsol hataları:\n${appErrors.join("\n")}`).toHaveLength(0);
  });
});
