import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Kategori / liste sayfası. İki rota şekli var:
 *   /tum-urunler, /tum-urunler/<slug>  → kanonik, çalışıyor
 *   /<slug>                            → bir kısmı 404 (bkz. tests/routes.ts)
 */
export class CategoryPage extends BasePage {
  readonly heading: Locator;
  readonly productLinks: Locator;
  readonly productCards: Locator;
  readonly filtersButton: Locator;
  readonly sortButton: Locator;
  readonly clearFiltersButton: Locator;
  readonly applyFiltersButton: Locator;
  readonly loadMoreButton: Locator;
  readonly priceSlider: Locator;
  readonly singleColumnButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator("h1:visible").first();
    this.productLinks = page.locator('a[href^="/"][href*="-p-"]');
    this.productCards = page.locator('a[href^="/"][href*="-p-"]:visible');
    this.filtersButton = page.locator('button:visible:has-text("Filtreler")').first();
    this.sortButton = page.locator('button:visible:has-text("Sırala")').first();
    // Masaüstünde filtreler sol sütunda inline; grup açılınca "Temizle" / "Uygula" çıkar.
    // Mobilde modal açılır ve buton "N ÜRÜNÜ GÖSTER" olur.
    this.clearFiltersButton = page
      .locator('button:visible:has-text("Temizle"), button:visible:has-text("TEMİZLE")')
      .first();
    this.applyFiltersButton = page
      .locator('button:visible:has-text("Uygula"), button:visible:has-text("ÜRÜNÜ GÖSTER")')
      .first();
    this.loadMoreButton = page.locator('button:visible:has-text("DAHA FAZLA GÖSTER")').first();
    this.priceSlider = page.locator('input[type="range"]').first();
    this.singleColumnButton = page.locator('button[aria-label="Tek kolon görünümü"]:visible').first();
  }

  async open(slug = "/tum-urunler") {
    await this.goto(slug);
  }

  /** Benzersiz ürün slug'ları — bir kart DOM'da 2 kez geçebiliyor (görsel + başlık). */
  async uniqueProductSlugs(): Promise<string[]> {
    const hrefs = await this.productLinks.evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? "").filter(Boolean),
    );
    return [...new Set(hrefs)];
  }

  /**
   * Masaüstünde filtre grupları zaten görünür — "Filtreler" butonuna basmak gerekmez
   * (basmak paneli kapatabilir). Sadece gruplar görünmüyorsa (mobil) panele bas.
   */
  async openFilterPanel() {
    const groupVisible = await this.page
      .locator('button:visible:has-text("Renk")')
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);
    if (!groupVisible) {
      await this.filtersButton.click({ timeout: 15_000 });
      await this.page.waitForTimeout(1800);
    }
  }

  /** Açılmış filtre grubundaki seçenek etiketleri (BEYAZ, GRİ, ...). */
  async filterOptionLabels(): Promise<string[]> {
    return this.page.$$eval("label", (ls) =>
      ls
        .filter((l) => !!(l as HTMLElement).offsetHeight)
        .map((l) => (l as HTMLElement).innerText.trim())
        .filter((t) => t && t.length < 30 && t !== "E-posta adresiniz"),
    );
  }

  /** Filtre panelindeki grubu açar: "Kategori" | "Renk" | "Malzeme" | "Fiyat" ... */
  async expandFilterGroup(name: string) {
    await this.page.locator(`button:visible:has-text("${name}")`).first().click({ timeout: 10_000 });
    await this.page.waitForTimeout(1200);
  }

  async filterGroupNames(): Promise<string[]> {
    return this.page.$$eval("button", (bs) =>
      bs
        .filter((b) => !!(b.offsetWidth || b.offsetHeight))
        .map((b) => (b as HTMLElement).innerText.trim())
        .filter((t) =>
          ["Kategori", "Renk", "Malzeme", "Fiyat", "Kategoriler", "Koleksiyonlar"].includes(t),
        ),
    );
  }

  async applyFilters() {
    await this.applyFiltersButton.click({ timeout: 15_000 });
    await this.settle(2500);
  }

  async loadMore(): Promise<{ before: number; after: number }> {
    const before = (await this.uniqueProductSlugs()).length;
    await this.loadMoreButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(4000);
    const after = (await this.uniqueProductSlugs()).length;
    return { before, after };
  }

  /** Sırala menüsünü açar ve verilen seçeneğe tıklar (tam metin, Türkçe /i kullanma). */
  async selectSort(optionText: string) {
    await this.sortButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(1200);
    await this.page
      .locator(`button:visible:has-text("${optionText}"), li:visible:has-text("${optionText}")`)
      .first()
      .click({ timeout: 10_000 });
    await this.settle(2500);
  }

  async sortOptions(): Promise<string[]> {
    await this.sortButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(1200);
    const opts = await this.page.$$eval("button, li", (els) =>
      els
        .filter((e) => !!(e.offsetWidth || e.offsetHeight))
        .map((e) => (e as HTMLElement).innerText.trim())
        .filter((t) => /Fiyat|Yeni|Önerilen|İndirim|Çok Satan|A-Z/i.test(t) && t.length < 40),
    );
    await this.page.keyboard.press("Escape");
    return [...new Set(opts)];
  }

  /** Listedeki fiyatlar (₺1.234,56 → 1234.56). */
  async prices(): Promise<number[]> {
    const raw = await this.page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("span, div, p, strong, b").forEach((e) => {
        if (e.children.length === 0) {
          const t = (e.textContent ?? "").trim();
          if (/^₺\s?[\d.,]+$/.test(t)) out.push(t);
        }
      });
      return out;
    });
    return raw
      .map((t) => t.replace(/[₺\s]/g, ""))
      .map((s) => Number(s.replace(/\./g, "").replace(",", ".")))
      .filter((n) => !Number.isNaN(n) && n > 0);
  }

  async assertHasProducts(min = 1) {
    const slugs = await this.uniqueProductSlugs();
    expect(slugs.length, `${this.page.url()} → ürün kartı bulunamadı`).toBeGreaterThanOrEqual(min);
  }
}
