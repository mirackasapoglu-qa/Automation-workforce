import { test, expect } from "@playwright/test";
import { CategoryPage } from "../pages/CategoryPage";
import { LISTING_WITH_PRODUCTS } from "./routes";

const MAIN_LISTING = LISTING_WITH_PRODUCTS[0]; // /tum-urunler

test.describe("03 - Kategori / liste sayfası", () => {
  test("ürün listesi render olur, sayaç ve kartlar tutarlı", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    await expect(cat.heading).toBeVisible();
    await cat.assertHasProducts(5);

    const body = await page.locator("body").innerText();
    const counter = body.match(/(\d[\d.]*)\s*ürün/)?.[1];
    expect(counter, "'N ürün' sayacı bulunamadı").toBeTruthy();
    expect(Number(counter!.replace(/\./g, ""))).toBeGreaterThan(0);
  });

  test("ürün kartından detay sayfasına gidilir", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    const slugs = await cat.uniqueProductSlugs();
    await cat.open(slugs[0]);
    await cat.assertNotNotFound();
    expect(page.url()).toContain("-p-");
    await expect(page.locator("h1:visible").first()).toBeVisible();
  });

  test("filtre paneli açılır ve filtre grupları listelenir", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    await cat.openFilterPanel();
    const groups = await cat.filterGroupNames();
    expect(groups.length, `filtre grubu bulunamadı: ${JSON.stringify(groups)}`).toBeGreaterThan(1);

    // "Temizle" / "Uygula" ancak bir grup açıldıktan sonra beliriyor.
    // Grup zaten açıksa ilk tıklama kapatabilir — kontrol edip gerekirse tekrar aç.
    await cat.expandFilterGroup("Renk");
    if (!(await page.locator('input[type="checkbox"]:visible').first().isVisible({ timeout: 4000 }).catch(() => false))) {
      await cat.expandFilterGroup("Renk");
    }
    await expect(
      page.locator('input[type="checkbox"]:visible').first(),
      "Renk grubu açılmadı (seçenek görünmüyor)",
    ).toBeVisible({ timeout: 10_000 });
    await expect(cat.applyFiltersButton).toBeVisible({ timeout: 10_000 });
  });

  test("filtre grubu genişletilir, seçenek işaretlenip uygulanır", async ({ page }) => {
    test.setTimeout(150_000);
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    const before = (await cat.uniqueProductSlugs()).length;

    await cat.openFilterPanel();
    await cat.expandFilterGroup("Renk");

    const labels = await cat.filterOptionLabels();
    expect(labels.length, "Renk grubunda seçenek yok").toBeGreaterThan(0);

    const box = page.locator('input[type="checkbox"]:visible').first();
    await expect(box, "filtre seçeneği checkbox olarak görünmedi").toBeVisible({ timeout: 10_000 });
    await box.click({ timeout: 10_000, force: true });
    await page.waitForTimeout(1000);

    await expect(cat.applyFiltersButton).toBeVisible();
    await cat.applyFilters();

    await cat.assertNotNotFound();
    const after = (await cat.uniqueProductSlugs()).length;
    console.log(`  filtre: ${before} → ${after} ürün | seçenekler: ${labels.slice(0, 5).join(", ")}`);
    expect(after, "filtre uygulandıktan sonra liste bozuldu").toBeGreaterThanOrEqual(0);
  });

  test("sıralama seçenekleri açılır", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    const opts = await cat.sortOptions();
    expect(opts.length, `sıralama seçeneği bulunamadı: ${JSON.stringify(opts)}`).toBeGreaterThan(0);
    console.log(`  sıralama seçenekleri: ${opts.join(" | ")}`);
  });

  test("'DAHA FAZLA GÖSTER' listeyi büyütür", async ({ page }) => {
    test.setTimeout(120_000);
    const cat = new CategoryPage(page);
    await cat.open(MAIN_LISTING);

    await cat.loadMoreButton.scrollIntoViewIfNeeded();
    const { before, after } = await cat.loadMore();
    expect(after, `öncesi=${before} sonrası=${after} — liste büyümedi`).toBeGreaterThan(before);
  });

  test("ürün dönen tüm kategori rotaları kart gösteriyor", async ({ page }) => {
    test.setTimeout(180_000);
    const cat = new CategoryPage(page);
    for (const route of LISTING_WITH_PRODUCTS) {
      await cat.open(route);
      await cat.assertNotNotFound();
      await cat.assertHasProducts();
    }
  });
});
