import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class HomePage extends BasePage {
  readonly productCards: Locator;
  readonly infoBar: Locator;
  readonly journalSection: Locator;

  constructor(page: Page) {
    super(page);
    this.productCards = page.locator('a[href^="/"][href*="-p-"]:visible');
    this.infoBar = page.locator('text=/Ücretsiz teslimat/').first();
    this.journalSection = page.locator('text=/TEPE HOME JOURNAL/').first();
  }

  async open() {
    await this.goto("/");
  }

  /** Mega menüyü açar, içindeki kategori linklerini döner. */
  async openCategoryMenu(): Promise<string[]> {
    await this.categoriesButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(2000);
    return this.page.$$eval('a[href^="/"]', (as) =>
      [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].filter(
        (h) => h && h !== "/#" && !h.includes("-p-"),
      ),
    );
  }

  async productCardCount(): Promise<number> {
    return this.productCards.count();
  }
}
