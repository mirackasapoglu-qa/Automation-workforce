import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class AccountPage extends BasePage {
  readonly heading: Locator;
  readonly logoutButton: Locator;
  readonly summaryLink: Locator;
  readonly ordersLink: Locator;
  readonly returnsLink: Locator;
  readonly addressesLink: Locator;
  readonly favoritesLink2: Locator;
  readonly profileLink: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator("h1:visible").first();
    this.logoutButton = page.locator('button:visible:has-text("Çıkış Yap")').first();
    this.summaryLink = page.locator('a[href="/hesabim"]:visible').first();
    this.ordersLink = page.locator('a[href="/hesabim/siparislerim"]:visible').first();
    this.returnsLink = page.locator('a[href="/hesabim/iadelerim"]:visible').first();
    this.addressesLink = page.locator('a[href="/hesabim/adreslerim"]:visible').first();
    this.favoritesLink2 = page.locator('a[href="/hesabim/favorilerim"]:visible').first();
    this.profileLink = page.locator('a[href="/hesabim/profil"]:visible').first();
  }

  async open() {
    await this.goto("/hesabim");
  }

  /** Sol menüdeki hesap linkleri. */
  async menuHrefs(): Promise<string[]> {
    return this.page.$$eval('a[href^="/hesabim"]', (as) =>
      [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].filter((h) => h && h !== "/hesabim#"),
    );
  }

  async isLoggedIn(): Promise<boolean> {
    return !this.page.url().includes("/giris");
  }

  /**
   * Çıkış YAPMAK İÇİN ONAY GEREKİYOR: menüdeki "Çıkış Yap" butonu bir diyalog açar
   * ("Çıkış yapmak istiyor musunuz? — Bu cihazdaki oturumunuz sonlandırılacak.")
   * ve gerçek çıkış diyalogdaki "ÇIKIŞ YAP" butonuyla olur. Sadece ilk butona
   * basan test oturumun kapanmadığını görür ve bunu ürün hatası sanır.
   */
  async logout() {
    await this.logoutButton.click({ timeout: 15_000 });

    // `.first()` şart: sayfada birden fazla [role=dialog] olabiliyor ve strict-mode
    // hatası `.catch(() => false)` içinde sessizce yutulup onay ATLANIYORDU.
    const dialog = this.page.locator('[role="dialog"]').first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });

    const confirm = dialog.locator("button", { hasText: "ÇIKIŞ YAP" }).first();
    await confirm.click({ timeout: 15_000 });

    // Çıkış tamamlanınca uygulama anasayfaya döner
    await this.page
      .waitForURL((u) => !u.pathname.startsWith("/hesabim"), { timeout: 20_000 })
      .catch(() => {});
    await this.page.waitForTimeout(3000);
  }
}
