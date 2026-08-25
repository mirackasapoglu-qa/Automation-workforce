import { test, expect } from "@playwright/test";
import { CategoryPage } from "../pages/CategoryPage";
import { BasePage } from "../pages/BasePage";
import { SEARCH_TERMS } from "./routes";
import { KNOWN_ISSUES } from "./known-issues";

/**
 * ⚠️ Homee aramasi PersonaClick "full_search" ile calisiyor ve sonuc kartlari
 * PROD domain'ine link veriyor (HOMEE-005). Bu yuzden site ici link sayan
 * assertion'lar burada kullanilamaz; sonuc sayimi tum domainler uzerinden yapilir.
 */
test.describe("04 - Arama", () => {
  test("header aramasıyla sonuç sayfasına gidilir", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open("/");
    await cat.search(SEARCH_TERMS.hit);

    expect(page.url()).toContain("/arama");
    expect(page.url()).toContain(encodeURIComponent(SEARCH_TERMS.hit));
    await cat.assertNotNotFound();

    const cards = await page.locator('a[href*="-p-"]').count();
    expect(cards, "arama sonucu hiç kart dönmedi").toBeGreaterThan(0);
  });

  test("arama sonucu başlığı sorguyu ve adedi gösterir", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.hit}`);

    const h1 = await cat.heading.innerText();
    expect(h1.toLocaleUpperCase("tr")).toContain(SEARCH_TERMS.hit.toLocaleUpperCase("tr"));
    expect(h1, "sonuç adedi (N) gösterilmiyor").toMatch(/\(\d+\)/);
  });

  test("sonuç dönmeyen arama boş durum mesajı gösterir", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.miss}`);

    await cat.assertNotNotFound();

    // Mesaj ("Arama Sonucu Bulunamadı.") client-render sonrası geliyor —
    // gövdeyi tek seferde okumak yerine görünmesini BEKLE.
    await expect(
      page.getByText(/Bulunamadı|sonuç yok|0 ürün/).first(),
      "boş sonuç mesajı gösterilmiyor",
    ).toBeVisible({ timeout: 25_000 });

    expect(await cat.uniqueProductSlugs(), "boş sonuçta site içi ürün kartı olmamalı").toHaveLength(
      0,
    );
  });

  /** BİLİNEN HATA HOMEE-005: sonuç kartları prod domain'ine gidiyor */
  test("arama sonuç kartları site içi link veriyor", async ({ page }) => {
    test.fail(
      true,
      `${KNOWN_ISSUES.searchResultsLinkToProd.id}: ${KNOWN_ISSUES.searchResultsLinkToProd.detail}`,
    );
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.hit}`);
    await cat.loadLazyContent(3);

    const all = await page.locator('a[href*="-p-"]').evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? ""),
    );
    const external = [...new Set(all.filter((h) => !h.startsWith("/")))];
    expect(
      external,
      `${external.length}/${all.length} sonuç kartı dış domain'e gidiyor, örn: ${external[0]}`,
    ).toHaveLength(0);
  });

  /**
   * HOMEE-006 ARALIKLI: PersonaClick kişiselleştirmesi nedeniyle aynı sorgu bazı
   * koşumlarda alakasız sonuç döndürüyor (ölçüm: "koltuk" → kolonya). Deterministik
   * olmadığı için `test.fail()` yok; alaka bozulursa test fail eder.
   */
  test("arama sonuçları sorguyla alakalı", async ({ page }) => {
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.hit}`);

    const first5 = (
      await page.locator('a[href*="-p-"]').evaluateAll((as) =>
        as.map((a) => a.getAttribute("href") ?? ""),
      )
    ).slice(0, 5);
    const relevant = first5.filter((h) => h.includes(SEARCH_TERMS.hit));
    expect(
      relevant.length,
      `ilk 5 sonuçta "${SEARCH_TERMS.hit}" geçen ürün yok: ${first5.map((h) => h.split("/").pop()).join(", ")}`,
    ).toBeGreaterThan(0);
  });

  /**
   * BİLİNEN HATA HOMEE-010: sonuçsuz aramada JS crash —
   * "Cannot read properties of null (reading 'getBoundingClientRect')".
   * Ölçüm 2026-08-20: 3/3 koşumda deterministik. HOMEE-006'dan bağımsız.
   */
  test("sonuçsuz aramada JS hatası yok", async ({ page }) => {
    test.fail(
      true,
      `${KNOWN_ISSUES.emptySearchPageError.id}: ${KNOWN_ISSUES.emptySearchPageError.detail}`,
    );
    const errors = BasePage.collectConsoleErrors(page);
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.miss}`);
    await page.waitForTimeout(3000);

    const appErrors = BasePage.appErrorsOnly(errors);
    expect(appErrors, `Konsol hataları:\n${appErrors.join("\n")}`).toHaveLength(0);
  });

  /**
   * BİLİNEN HATA HOMEE-005: sonuçlu aramanın yanı sıra SONUÇSUZ aramada da
   * öneri kartları prod domain'ine gidiyor (ölçüm 2026-08-20: 8/8 kart).
   * Üstteki test yalnızca sonuçlu aramayı ölçüyordu.
   */
  test("sonuçsuz arama öneri kartları site içi link veriyor", async ({ page }) => {
    test.fail(
      true,
      `${KNOWN_ISSUES.searchResultsLinkToProd.id}: ${KNOWN_ISSUES.searchResultsLinkToProd.detail}`,
    );
    const cat = new CategoryPage(page);
    await cat.open(`/arama?q=${SEARCH_TERMS.miss}`);
    await page.waitForTimeout(3000);

    const all = await page.locator('a[href*="-p-"]').evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? ""),
    );
    const external = [...new Set(all.filter((h) => !h.startsWith("/")))];
    expect(
      external,
      `${external.length}/${all.length} öneri kartı dış domain'e gidiyor, örn: ${external[0]}`,
    ).toHaveLength(0);
  });
});
