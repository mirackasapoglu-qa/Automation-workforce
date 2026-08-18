import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export class CartPage extends BasePage {
  readonly heading: Locator;
  readonly itemCountText: Locator;
  readonly increaseButtons: Locator;
  readonly decreaseButtons: Locator;
  readonly removeButtons: Locator;
  readonly moveToFavoritesButtons: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly couponApplyButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Sepetim")').first();
    this.itemCountText = page.locator("text=/^\\d+ ürün$/").first();
    this.increaseButtons = page.locator('button[aria-label="Artır"]:visible');
    this.decreaseButtons = page.locator('button[aria-label="Azalt"]:visible');
    this.removeButtons = page.locator('button[aria-label="Ürünü kaldır"]:visible');
    this.moveToFavoritesButtons = page.locator('button[aria-label="Favorilere ekle"]:visible');
    this.checkoutButton = page.locator('button:visible:has-text("ÖDEME ADIMINA GEÇİN")').first();
    this.continueShoppingButton = page
      .locator('button:visible:has-text("ALIŞVERİŞ YAPMAYA DEVAM EDİN")')
      .first();
    this.couponApplyButton = page.locator('button:visible:has-text("Uygula")').first();
  }

  /**
   * Sepet sayfası bazen BAYAT render dönüyor: header badge'inde ürün görünürken
   * liste boş geliyor (ölçüldü: sepete ekleme doğrulandıktan hemen sonra /sepet
   * 0 satır gösterdi). Badge ile liste çelişirse bir kez reload eder.
   */
  async open() {
    await this.goto("/sepet");
    const badge = (await this.cartBadgeCount()) ?? 0;
    if (badge > 0 && (await this.removeButtons.count()) === 0) {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.settle(2500);
    }
  }

  async isEmpty(): Promise<boolean> {
    return (await this.removeButtons.count()) === 0;
  }

  async lineCount(): Promise<number> {
    return this.removeButtons.count();
  }

  async headerItemCount(): Promise<number | null> {
    const body = await this.page.locator("body").innerText();
    const m = body.match(/(\d+)\s*ürün/);
    return m ? Number(m[1]) : null;
  }

  /** Etiketin hemen altındaki ₺ değerini okur (sipariş özeti satırları). */
  private async moneyNear(label: RegExp): Promise<number | null> {
    const lines = (await this.page.locator("body").innerText())
      .split("\n")
      .map((s) => s.trim());
    const idx = lines.findIndex((l) => label.test(l));
    if (idx === -1) return null;
    for (let i = idx; i < Math.min(idx + 3, lines.length); i++) {
      const m = lines[i].match(/₺\s?([\d.,]+)/);
      if (m) return Number(m[1].replace(/\./g, "").replace(",", "."));
    }
    return null;
  }

  subtotal = () => this.moneyNear(/Ara toplam/);
  shipping = () => this.moneyNear(/Teslimat ve Kurulum/);
  total = () => this.moneyNear(/^Toplam$/);

  /** İlk satırın adet göstergesi. */
  async firstLineQuantity(): Promise<number | null> {
    const row = this.increaseButtons.first().locator("xpath=../..");
    const txt = await row.innerText({ timeout: 5000 }).catch(() => "");
    const m = txt.match(/(?:^|\n)\s*(\d+)\s*(?:\n|$)/);
    return m ? Number(m[1]) : null;
  }

  async increaseFirstLine() {
    await this.increaseButtons.first().click({ timeout: 15_000 });
    await this.page.waitForTimeout(3500);
  }

  async decreaseFirstLine() {
    await this.decreaseButtons.first().click({ timeout: 15_000 });
    await this.page.waitForTimeout(3500);
  }

  /**
   * Yıkıcı işlem: seçici satır index'ine kilitli, global .last() KULLANILMAZ.
   * Silmeden önce satır sayısını assert eder (liste yeniden render olursa yanlış
   * ürünü silme riski gerçek).
   */
  async removeLineByIndex(index: number): Promise<{ before: number; after: number }> {
    const before = await this.lineCount();
    expect(index, `sepette ${before} satır var, index ${index} geçersiz`).toBeLessThan(before);
    await this.removeButtons.nth(index).click({ timeout: 15_000 });
    await this.page.waitForTimeout(4000);
    await this.dismissOverlays();
    return { before, after: await this.lineCount() };
  }

  /** Test hijyeni: sepeti tamamen boşalt (afterEach/teardown). */
  async clear() {
    for (let i = 0; i < 15; i++) {
      if ((await this.removeButtons.count()) === 0) break;
      await this.removeButtons.first().click({ timeout: 15_000 }).catch(() => {});
      await this.page.waitForTimeout(3000);
      await this.dismissOverlays();
    }
  }

  async proceedToCheckout() {
    await expect(this.checkoutButton).toBeVisible({ timeout: 20_000 });
    await this.checkoutButton.click({ timeout: 15_000 });
    await this.settle(3000);
  }
}
