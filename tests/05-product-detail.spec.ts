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

  /**
   * KAPSAM BOŞLUĞU KAPATMA: üstteki test yalnızca `sapTest` ürününü tarıyordu,
   * bu yüzden varyantlı üründeki HOMEE-009 hatası 2026-08-20'ye kadar kaçtı.
   * Bu test 3 test ürününün HEPSİNİ gezer.
   * BİLİNEN HATA HOMEE-001: 2 SAP test ürününde "parameters is not iterable".
   */
  test("tüm TEST_PRODUCTS ürün detayları konsol hatasız", async ({ page }) => {
    test.fail(
      true,
      `${KNOWN_ISSUES.productDetailConsoleError.id}: ${KNOWN_ISSUES.productDetailConsoleError.detail}`,
    );
    test.setTimeout(120_000);
    const errors = BasePage.collectConsoleErrors(page);
    const p = new ProductPage(page);
    const seen: string[] = [];

    for (const [name, path] of Object.entries(TEST_PRODUCTS)) {
      const before = errors.length;
      await p.open(path);
      await page.waitForTimeout(2000);
      const fresh = BasePage.appErrorsOnly(errors.slice(before));
      if (fresh.length) seen.push(`${name} (${path}): ${fresh.join(" | ")}`);
    }

    expect(seen, `Ürün bazında konsol hataları:\n${seen.join("\n")}`).toHaveLength(0);
  });

  /**
   * BİLİNEN HATA HOMEE-009: varyantlı üründe null'dan URL kuruluyor →
   * GET /null?v=0.2 → 404. Ölçüm 2026-08-20: 3/3 koşumda deterministik.
   * Yalnızca SİTE İÇİ (aynı origin) istekler sayılır; 3P CDN gürültüsü hariç.
   */
  test("varyantlı ürün detayında 404 dönen site içi istek yok", async ({ page }) => {
    test.fail(
      true,
      `${KNOWN_ISSUES.pdpNullAssetRequest.id}: ${KNOWN_ISSUES.pdpNullAssetRequest.detail}`,
    );
    const bad: string[] = [];
    // Site içi = config'deki baseURL ile aynı host. 3P CDN/analytics gürültüsü sayılmaz.
    const siteHost = new URL(test.info().project.use.baseURL as string).host;
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.host === siteHost && r.status() >= 400) {
        bad.push(`${r.status()} ${u.pathname}${u.search}`);
      }
    });

    const pd = new ProductPage(page);
    await pd.open(TEST_PRODUCTS.sehpa);
    await page.waitForTimeout(2500);

    expect([...new Set(bad)], `4xx/5xx dönen site içi istekler:\n${bad.join("\n")}`).toHaveLength(0);
  });
});
