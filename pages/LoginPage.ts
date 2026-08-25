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
    // Alan adlari 2026-08'de degisti (email -> login-email); iki ad da kabul edilir.
    this.emailInput = page.locator('input[name="email"]:visible, input[name="login-email"]:visible').first();
    this.passwordInput = page.locator('input[name="password"]:visible, input[name="login-password"]:visible').first();
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

  /**
   * E-posta + sifre alanlarini doldurur.
   *
   * ⚠️ Alanlar `readonly` aciliyor (otomatik doldurmaya karsi) ve readonly
   * yalnizca TIKLAYINCA kalkiyor. Dogrudan `fill()` "element is not editable"
   * ile 30sn bekleyip duser — bu yuzden dolduran her yer bu method'u kullanmali.
   */
  async fillCredentials(email: string, password: string) {
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
  }

  async login(email: string, password: string) {
  // ⚠️ Alanlar `readonly` acilıyor (otomatik doldurmaya karsi); readonly
  // yalnizca TIKLAYINCA kalkiyor. Once click, sonra fill — aksi halde
  // Playwright "element is not editable" ile 30sn bekleyip dusuyor.
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.submitButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(6000);
  }

  /**
   * Formu gönderir ve gövde metnini POLL EDEREK mesaj arar.
   *
   * ⚠️ Homee'nin hata mesajı ~1.2 sn sonra çıkan ve kaybolan bir TOAST
   * ("Lütfen e-posta adresinizi ya da şifrenizi kontrol edin."). Sabit bekleyip
   * sonra gövdeye bakan test mesajı KAÇIRIR.
   */
  async submitAndCatchMessage(pattern: RegExp, timeoutMs = 12_000): Promise<string | null> {
    await this.submitButton.click({ timeout: 15_000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.page.locator("body").innerText().catch(() => "");
      const hit = body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => pattern.test(l));
      if (hit) return hit;
      await this.page.waitForTimeout(300);
    }
    return null;
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
