import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class StoresPage extends BasePage {
  readonly heading: Locator;
  readonly storeSearchInput: Locator;
  readonly directionsButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Mağazalarımız")').first();
    this.storeSearchInput = page.locator('input[placeholder*="Mağaza Ara"]:visible').first();
    this.directionsButtons = page.locator('button:visible:has-text("Yol tarifi")');
  }

  /**
   * Mağaza kartları client-render sonrası geliyor (yavaş makinede 3+ sn).
   * Sabit bekleme yerine ilk "Yol tarifi" butonunu bekler.
   */
  async open() {
    await this.goto("/magazalar");
    await this.directionsButtons
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});
  }

  async searchStore(term: string) {
    await this.storeSearchInput.fill(term);
    await this.page.waitForTimeout(2500);
  }

  /**
   * Mağaza sayısı — h2/h3 sayımı footer başlıklarını (KURUMSAL, İLETİŞİM, BLOG)
   * da yakaladığı için güvenilir değil; her mağaza kartında bir "Yol tarifi"
   * butonu var, onu sayıyoruz.
   */
  async storeCount(): Promise<number> {
    return this.directionsButtons.count();
  }

  /** Listelenen mağaza başlıkları (footer başlıkları hariç). */
  async storeNames(): Promise<string[]> {
    const FOOTER = ["KURUMSAL", "İLETİŞİM", "BLOG"];
    const names = await this.page.$$eval("h2, h3", (hs) =>
      hs
        .filter((h) => !!(h as HTMLElement).offsetHeight)
        .map((h) => (h as HTMLElement).innerText.trim())
        .filter(Boolean),
    );
    return names.filter((n) => !FOOTER.includes(n));
  }
}
