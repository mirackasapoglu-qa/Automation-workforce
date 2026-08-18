import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export class LoginPage extends BasePage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly rememberMe: Locator;
  readonly submitButton: Locator;
  readonly smsLoginButton: Locator;
  readonly googleButton: Locator;
  readonly appleButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Giriş Yap")').first();
    this.emailInput = page.locator('input[name="email"]:visible').first();
    this.passwordInput = page.locator('input[name="password"]:visible').first();
    this.rememberMe = page.locator("#login-remember-me").first();
    // "SMS İLE GİRİŞ YAP" da "GİRİŞ YAP" içeriyor → exact name şart
    this.submitButton = page.getByRole("button", { name: "GİRİŞ YAP", exact: true }).first();
    this.smsLoginButton = page.getByRole("button", { name: "SMS İLE GİRİŞ YAP", exact: true }).first();
    this.googleButton = page.getByRole("button", { name: "Google", exact: true }).first();
    this.appleButton = page.getByRole("button", { name: "Apple", exact: true }).first();
  }

  async open(redirect = "/hesabim") {
    await this.goto(`/giris?redirect=${encodeURIComponent(redirect)}`);
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(6000);
  }

  /** Görünen validasyon/hata metinleri. */
  async validationMessages(): Promise<string[]> {
    const body = await this.page.locator("body").innerText();
    return body
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => /geçersiz|zorunlu|hatalı|yanlış|bulunamadı|giriniz|eşleşmiyor|en az/i.test(l))
      .slice(0, 6);
  }

  async assertStillOnLogin() {
    expect(this.page.url(), "login sayfasından çıkmamalıydı").toContain("/giris");
  }
}
