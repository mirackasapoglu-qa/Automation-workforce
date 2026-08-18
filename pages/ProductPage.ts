import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export class ProductPage extends BasePage {
  readonly title: Locator;
  readonly skuButton: Locator;
  readonly addToCartButton: Locator;
  readonly installmentButton: Locator;
  readonly favoriteButton: Locator;
  readonly detailsHeading: Locator;
  readonly descriptionTab: Locator;
  readonly dimensionsTab: Locator;
  readonly deliveryTab: Locator;
  readonly nextImageButton: Locator;

  constructor(page: Page) {
    super(page);
    this.title = page.locator("h1:visible").first();
    this.skuButton = page.locator('button:visible:has-text("ÜRÜN KODU")').first();
    this.addToCartButton = page.locator('button:visible:has-text("SEPETE EKLE")').first();
    this.installmentButton = page.locator('button:visible:has-text("Taksit seçenekleri")').first();
    // Ana urunun favori butonu DOM'daki İLK favori butonu; etiketi duruma gore
    // degisiyor ("Favorilere ekle" ↔ "Favorilerden cikar"). Sonraki butonlar
    // oneri kartlarina ait — onlara basmak yanlis urunu favoriler.
    this.favoriteButton = page
      .locator(
        'button[aria-label="Favorilere ekle"]:visible, button[aria-label="Favorilerden çıkar"]:visible',
      )
      .first();
    this.detailsHeading = page.locator("#urun-detaylari-heading");
    this.descriptionTab = page.locator('button:visible:has-text("Açıklama")').first();
    this.dimensionsTab = page.locator('button:visible:has-text("Ölçüler")').first();
    this.deliveryTab = page.locator('button:visible:has-text("Teslimat")').first();
    this.nextImageButton = page.locator('button[aria-label="Sonraki görsel"]:visible').first();
  }

  async open(slug: string) {
    await this.goto(slug.startsWith("/") ? slug : `/${slug}`);
  }

  /** Ana urun favorilerde mi (butonun aria-label'ina bakar). */
  async isFavorited(): Promise<boolean> {
    const label = await this.favoriteButton.getAttribute("aria-label").catch(() => "");
    return (label ?? "").includes("çıkar");
  }

  /** Favori durumunu hedeflenen degere getirir; zaten oyleyse dokunmaz. */
  async setFavorite(on: boolean) {
    if ((await this.isFavorited()) === on) return;
    await this.favoriteButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(3500);
  }

  /** /xxx-p-1099765 → "1099765" */
  skuFromUrl(): string {
    return this.page.url().match(/-p-([^/?#]+)/)?.[1] ?? "";
  }

  /** Sayfada gösterilen ürün kodu ("ÜRÜN KODU: 1099765" → "1099765"). */
  async displayedSku(): Promise<string> {
    const t = await this.skuButton.innerText({ timeout: 10_000 }).catch(() => "");
    return t.split(":").pop()?.trim() ?? "";
  }

  /**
   * Sepete ekler ve GERÇEKTEN eklendiğini header badge'inden doğrular.
   * Hydration tamamlanmadan yapılan ilk tıklama sessizce kaybolabiliyor —
   * badge değişmezse bir kez daha dener.
   */
  async addToCart() {
    await expect(this.addToCartButton).toBeVisible({ timeout: 25_000 });
    const before = (await this.cartBadgeCount()) ?? 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      await this.addToCartButton.click({ timeout: 15_000 });
      for (let i = 0; i < 12; i++) {
        await this.page.waitForTimeout(1000);
        const now = (await this.cartBadgeCount()) ?? 0;
        if (now > before) {
          await this.dismissOverlays();
          return;
        }
      }
    }
    throw new Error(
      `Sepete ekleme doğrulanamadı: header badge ${before} değerinde kaldı (${this.page.url()})`,
    );
  }

  async openTab(tab: "aciklama" | "olculer" | "teslimat") {
    const map = {
      aciklama: this.descriptionTab,
      olculer: this.dimensionsTab,
      teslimat: this.deliveryTab,
    } as const;
    await map[tab].click({ timeout: 12_000 });
    await this.page.waitForTimeout(1200);
  }

  /** Ürün fiyatı (sayfadaki ilk ₺ değeri). */
  async priceValue(): Promise<number | null> {
    const raw = await this.page.evaluate(() => {
      const els = [...document.querySelectorAll("span, div, p, strong, b")];
      for (const e of els) {
        if (e.children.length === 0) {
          const t = (e.textContent ?? "").trim();
          if (/^₺\s?[\d.,]+$/.test(t)) return t;
        }
      }
      return "";
    });
    if (!raw) return null;
    const n = Number(raw.replace(/[₺\s]/g, "").replace(/\./g, "").replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
}
