import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class FavoritesPage extends BasePage {
  readonly heading: Locator;
  readonly productLinks: Locator;
  readonly removeButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Favorilerim")').first();
    // Sadece iç linkler — PersonaClick önerileri prod domain'ine gidiyor
    this.productLinks = page.locator('a[href^="/"][href*="-p-"]:visible');
    this.removeButtons = page.locator(
      'button[aria-label="Favoriden çıkar"]:visible, button[aria-label="Favorilerden çıkar"]:visible',
    );
  }

  async open() {
    await this.goto("/hesabim/favorilerim");
  }

  async count(): Promise<number> {
    const hrefs = await this.productLinks.evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? ""),
    );
    return new Set(hrefs).size;
  }

  async isEmpty(): Promise<boolean> {
    const body = await this.page.locator("body").innerText();
    return /favori.*bulunmuyor|henüz favori|boş/i.test(body) || (await this.count()) === 0;
  }
}
