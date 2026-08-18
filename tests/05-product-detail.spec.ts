import { test, expect } from "@playwright/test";
import { ProductPage } from "../pages/ProductPage";
import { TEST_PRODUCTS } from "./routes";
import { BasePage } from "../pages/BasePage";
import { KNOWN_ISSUES } from "./known-issues";

test.describe("05 - Ürün detay", () => {
  test("başlık, ürün kodu ve fiyat görünür", async ({ page }) => {
    const p = new ProductPage(page);
    await p.open(TEST_PRODUCTS.sapTest);

    await expect(p.title).toBeVisible();
    expect((await p.title.innerText()).trim().length).toBeGreaterThan(3);

    await expect(p.skuButton).toBeVisible();
    expect(await p.displayedSku(), "sayfadaki ürün kodu URL'deki SKU ile uyuşmuyor").toBe(
      p.skuFromUrl(),
    );

    const price = await p.priceValue();
    expect(price, "fiyat okunamadı").not.toBeNull();
    expect(price!).toBeGreaterThan(0);
  });

  test("ürün detay sekmeleri açılır (Açıklama / Ölçüler / Teslimat)", async ({ page }) => {
    const p = new ProductPage(page);
    await p.open(TEST_PRODUCTS.sehpa);

    for (const tab of ["aciklama", "olculer", "teslimat"] as const) {
      await p.openTab(tab);
      await p.assertNotNotFound();
    }
  });

  test("taksit seçenekleri açılır", async ({ page }) => {
    const p = new ProductPage(page);
    await p.open(TEST_PRODUCTS.sehpa);

    if (await p.installmentButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await p.installmentButton.click({ timeout: 10_000 });
      await page.waitForTimeout(2000);
      const body = await page.locator("body").innerText();
      expect(body, "taksit tablosu görünmedi").toMatch(/taksit|Taksit/);
    } else {
      test.skip(true, "Bu üründe taksit seçeneği yok");
    }
  });

  test("SEPETE EKLE butonu aktif ve ürün görseli yüklü", async ({ page }) => {
    const p = new ProductPage(page);
    await p.open(TEST_PRODUCTS.sapTest);

    await expect(p.addToCartButton).toBeVisible();
    await expect(p.addToCartButton).toBeEnabled();

    const broken = await page.$$eval("img", (imgs) =>
      imgs
        .filter((i) => !!(i as HTMLImageElement).offsetHeight)
        .filter((i) => !(i as HTMLImageElement).naturalWidth)
        .map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src)
        .slice(0, 5),
    );
    expect(broken, `kırık görseller: ${broken.join(", ")}`).toHaveLength(0);
  });

  /** BİLİNEN HATA HOMEE-001: "parameters is not iterable" */
  test("ürün detayda uygulama kaynaklı konsol hatası yok", async ({ page }) => {
    test.fail(true, `${KNOWN_ISSUES.productDetailConsoleError.id}: ${KNOWN_ISSUES.productDetailConsoleError.detail}`);
    const errors = BasePage.collectConsoleErrors(page);
    const p = new ProductPage(page);
    await p.open(TEST_PRODUCTS.sapTest);
    await page.waitForTimeout(2000);

    const appErrors = BasePage.appErrorsOnly(errors);
    expect(appErrors, `Konsol hataları:\n${appErrors.join("\n")}`).toHaveLength(0);
  });
});
