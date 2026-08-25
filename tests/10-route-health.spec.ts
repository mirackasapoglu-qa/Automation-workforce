import { test, expect } from "@playwright/test";
import { BasePage } from "../pages/BasePage";
import { CategoryPage } from "../pages/CategoryPage";
import {
  ACCOUNT_ROUTES,
  KNOWN_BROKEN_ROUTES,
  LISTING_EMPTY,
  LISTING_WITH_PRODUCTS,
  STATIC_ROUTES,
} from "./routes";

/**
 * 10 - Rota sağlığı (tek geçiş süpürmesi)
 *
 * NEDEN VAR: Homee 404'te de HTTP 200 dönüyor — durum kodu tek başına yalan
 * söyler, tespit DOM'dan yapılmalı. Ayrıca baseline listeleri (KNOWN_BROKEN_ROUTES,
 * LISTING_EMPTY) zamanla gerçekle uyumsuzlaşıyor; bu spec 2026-08-20 rota
 * denetiminin kod hâli ve listelerin kaymasını otomatik yakalıyor.
 *
 * MİSAFİR SETİ — mutasyon yok, tamamen okuma.
 */
test.describe("10 - Rota sağlığı", () => {
  test("bilinen kırık rotalar hâlâ 404 (düzelen listeden çıkarılmalı)", async ({ page }) => {
    test.setTimeout(180_000);
    const p = new BasePage(page);
    const fixed: string[] = [];

    for (const route of KNOWN_BROKEN_ROUTES) {
      await p.goto(route);
      if (!(await p.isNotFound())) fixed.push(route);
    }

    expect(
      fixed,
      `Bu rotalar artık 404 DEĞİL — KNOWN_BROKEN_ROUTES'tan çıkar: ${fixed.join(", ")}`,
    ).toHaveLength(0);
  });

  test("boş kategoriler hâlâ 0 ürün (dolan listeden çıkarılmalı)", async ({ page }) => {
    test.setTimeout(240_000);
    const cat = new CategoryPage(page);
    const filled: string[] = [];

    for (const route of LISTING_EMPTY) {
      await cat.open(route);
      await cat.loadLazyContent(3);
      const n = (await cat.uniqueProductSlugs()).length;
      if (n > 0) filled.push(`${route} (${n} ürün)`);
    }

    expect(
      filled,
      `Bu rotalar artık ürün dönüyor — LISTING_EMPTY'den çıkar: ${filled.join(", ")}`,
    ).toHaveLength(0);
  });

  test("ürün dönmesi beklenen rotalar gerçekten ürün dönüyor", async ({ page }) => {
    test.setTimeout(180_000);
    const cat = new CategoryPage(page);
    const empty: string[] = [];

    for (const route of LISTING_WITH_PRODUCTS) {
      await cat.open(route);
      await cat.loadLazyContent(3);
      if ((await cat.uniqueProductSlugs()).length === 0) empty.push(route);
    }

    expect(empty, `Ürün beklenen rotalar boş döndü: ${empty.join(", ")}`).toHaveLength(0);
  });

  test("statik rotaların hiçbiri 404 vermiyor", async ({ page }) => {
    test.setTimeout(180_000);
    const p = new BasePage(page);
    const broken: string[] = [];

    for (const route of STATIC_ROUTES) {
      await p.goto(route.path);
      if (await p.isNotFound()) broken.push(route.path);
    }

    expect(broken, `404 dönen statik rotalar: ${broken.join(", ")}`).toHaveLength(0);
  });

  /**
   * 2026-08-20 ölçümü: misafir /hesabim → /giris?redirect=%2Fhesabim.
   * Alt hesap rotaları misafirken hiç test edilmiyordu — açıkta kalan
   * korumalı sayfa (login'e yönlenmeyen) burada yakalanır.
   */
  test("misafir korumalı hesap rotalarında login'e yönlendirilir", async ({ page }) => {
    test.setTimeout(180_000);
    const p = new BasePage(page);
    const leaked: string[] = [];

    for (const route of ACCOUNT_ROUTES) {
      await p.goto(route.path);
      const url = page.url();
      const redirected = /\/giris|\/kayit-ol/.test(url);
      if (!redirected) leaked.push(`${route.path} → ${url}`);
    }

    expect(
      leaked,
      `Misafirken login'e yönlenmeyen hesap rotaları:\n${leaked.join("\n")}`,
    ).toHaveLength(0);
  });
});
