import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class OrdersPage extends BasePage {
  readonly heading: Locator;
  readonly orderCards: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Siparişlerim")').first();
    this.orderCards = page.locator('a[href*="/hesabim/siparislerim/"]:visible');
  }

  async open() {
    await this.goto("/hesabim/siparislerim");
  }

  async isEmpty(): Promise<boolean> {
    const body = await this.page.locator("body").innerText();
    // Gerçek metin: "Siparişiniz bulunmamaktadır."
    return /bulunmamaktadır|bulunmuyor|henüz sipariş/i.test(body);
  }

  async orderCount(): Promise<number> {
    return this.orderCards.count();
  }
}
