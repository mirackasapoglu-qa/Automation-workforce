import { test, expect } from "@playwright/test";
import { HomePage } from "../pages/HomePage";
import { CategoryPage } from "../pages/CategoryPage";
import { KNOWN_BROKEN_ROUTES, LISTING_EMPTY, MENU_ROUTES } from "./routes";
import { KNOWN_ISSUES } from "./known-issues";

test.describe("02 - Navigasyon ve rota sağlığı", () => {
  test("mega menü açılır ve kategori linkleri listelenir", async ({ page }) => {
    const home = new HomePage(page);
    await home.open();

    const links = await home.openCategoryMenu();
    expect(links.length, "menüde link bulunamadı").toBeGreaterThan(5);
    expect(links).toContain("/tum-urunler");
  });

  test("menüdeki tüm kategori rotaları açılır (404 yok)", async ({ page }) => {
    // Rota süpürmesi: 10 sayfa × ~5s → varsayılan timeout yetmez
    test.setTimeout(240_000);
    const cat = new CategoryPage(page);
    const broken: string[] = [];

    for (const route of MENU_ROUTES) {
      await cat.open(route);
      if (await cat.isNotFound()) broken.push(route);
    }

    expect(broken, `404 dönen rotalar: ${broken.join(", ")}`).toHaveLength(0);
  });

  /**
   * Bilinen kırık linkler regresyon kaydı. Biri düzelirse bu test FAIL eder →
   * tests/routes.ts'ten çıkarılması gerektiğini hatırlatır (kasıtlı davranış).
   */
  test("bilinen kırık linkler kayıt altında (düzelen listeden çıkarılmalı)", async ({ page }) => {
    test.setTimeout(180_000);
    const cat = new CategoryPage(page);
    const fixed: string[] = [];

    for (const route of KNOWN_BROKEN_ROUTES) {
      await cat.open(route);
      if (!(await cat.isNotFound())) fixed.push(route);
    }

    expect(
      fixed,
      `Artık çalışıyor → routes.ts KNOWN_BROKEN_ROUTES'tan çıkar: ${fixed.join(", ")}`,
    ).toHaveLength(0);
  });

  test("header ana menü linkleri (MOBİLYA / EVDEKOR) 404 vermez", async ({ page }) => {
    test.setTimeout(120_000);
    const cat = new CategoryPage(page);
    await cat.open("/");

    for (const label of ["MOBİLYA", "EVDEKOR"]) {
      const link = page.locator(`header a:visible:has-text("${label}")`).first();
      const href = await link.getAttribute("href");
      expect(href, `${label} linkinde href yok`).toBeTruthy();
      await cat.open(href!);
      await cat.assertNotNotFound();
    }
  });

  /**
   * Ürün listelemesi beklenen ama "0 ürün" dönen kategoriler kayıt altında.
   * Biri dolduğunda bu test FAIL eder → routes.ts LISTING_EMPTY'den çıkar.
   */
  test("boş kategoriler kayıt altında (dolan listeden çıkarılmalı)", async ({ page }) => {
    test.setTimeout(180_000);
    const cat = new CategoryPage(page);
    const nowHasProducts: string[] = [];

    for (const route of LISTING_EMPTY) {
      await cat.open(route);
      if ((await cat.uniqueProductSlugs()).length > 0) nowHasProducts.push(route);
    }

    expect(
      nowHasProducts,
      `Artık ürün dönüyor → routes.ts LISTING_EMPTY'den çıkar: ${nowHasProducts.join(", ")}`,
    ).toHaveLength(0);
  });

  test("logo anasayfaya döner", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open("/tum-urunler");
    await cat.logo.click({ timeout: 15_000 });
    await cat.settle(2000);
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("02b - Domain sızması", () => {
  /**
   * Test ortamındaki sayfalar PROD domain'ine link vermemeli.
   * Bilinen sorun: PersonaClick öneri widget'ı prod.tepehome.com.tr'ye link veriyor
   * (özellikle sonuçsuz aramada). Bu test sızmayı raporlar.
   */
  test("test ortamı sayfaları prod domain'ine link vermiyor", async ({ page }) => {
    test.setTimeout(150_000);
    test.fail(true, `${KNOWN_ISSUES.searchResultsLinkToProd.id}: ${KNOWN_ISSUES.searchResultsLinkToProd.detail}`);
    const cat = new CategoryPage(page);
    const leaks: string[] = [];

    // Sızma arama sayfalarında deterministik tekrarlanıyor; anasayfa/sepet önerileri
    // her koşumda render olmadığı için ölçüm arama sayfalarına odaklanır.
    for (const path of ["/arama?q=koltuk", "/arama?q=zzzqwertyyok"]) {
      await cat.open(path);
      await cat.loadLazyContent(3);
      const links = await cat.externalProdLinks();
      if (links.length) leaks.push(`${path} → ${links.length} link, örn: ${links[0]}`);
    }

    expect(leaks, `prod domain'ine sızan linkler:\n${leaks.join("\n")}`).toHaveLength(0);
  });
});
