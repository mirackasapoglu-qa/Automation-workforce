import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";
import { ORDERS_ALLOWED } from "./authState";

/**
 * /odeme — Teslimat ve Ödeme.
 *
 * ⚠️ payButton GERÇEK SİPARİŞ AÇAR. `submitOrder()` sadece ALLOW_HOMEE_ORDERS=1
 * ile çalışır; varsayılan koşumda çağrılsa bile hata fırlatır.
 */
export class CheckoutPage extends BasePage {
  readonly contactSection: Locator;
  readonly addressSection: Locator;
  readonly paymentSection: Locator;
  readonly summarySection: Locator;
  readonly addressBookButton: Locator;
  readonly newAddressButton: Locator;
  readonly creditCardOption: Locator;
  readonly transferOption: Locator;
  readonly contractsCheckbox: Locator;
  readonly distanceSalesContract: Locator;
  readonly preInfoForm: Locator;
  /** ⚠️ GERÇEK SİPARİŞ — doğrudan tıklanmaz */
  readonly payButton: Locator;

  constructor(page: Page) {
    super(page);
    this.contactSection = page.locator('h2:visible:has-text("İletişim Bilgileri")').first();
    this.addressSection = page.locator('h2:visible:has-text("Teslimat Adresi")').first();
    this.paymentSection = page.locator('h2:visible:has-text("Ödeme yöntemi")').first();
    this.summarySection = page.locator('h2:visible:has-text("Sipariş Özeti")').first();
    this.addressBookButton = page.locator('button:visible:has-text("ADRES DEFTERİM")').first();
    this.newAddressButton = page.locator('button:visible:has-text("YENİ ADRES EKLE")').first();
    this.creditCardOption = page.locator('button:visible:has-text("KREDİ KARTI")').first();
    this.transferOption = page.locator('button:visible:has-text("HAVALE / EFT")').first();
    this.contractsCheckbox = page.locator('input[name="checkout-contracts-accepted"]').first();
    this.distanceSalesContract = page
      .locator('button:visible:has-text("Mesafeli Satış Sözleşmesi")')
      .first();
    this.preInfoForm = page.locator('button:visible:has-text("Ön Bilgilendirme Formu")').first();
    this.payButton = page.locator('button:visible:has-text("ÖDEME YAP")').first();
  }

  async open() {
    await this.goto("/odeme");
  }

  /** "₺4.200 - ÖDEME YAP" → 4200 */
  async payButtonAmount(): Promise<number | null> {
    const t = await this.payButton.innerText({ timeout: 10_000 }).catch(() => "");
    const m = t.match(/₺\s?([\d.,]+)/);
    return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
  }

  async selectPaymentMethod(method: "kredi" | "havale") {
    const btn = method === "kredi" ? this.creditCardOption : this.transferOption;
    await btn.click({ timeout: 15_000 });
    await this.page.waitForTimeout(2500);
  }

  async acceptContracts() {
    await this.contractsCheckbox.click({ timeout: 12_000, force: true });
    await this.page.waitForTimeout(800);
  }

  async hasSavedAddress(): Promise<boolean> {
    const body = await this.page.locator("body").innerText();
    return !/Kayıtlı teslimat adresiniz yok/.test(body);
  }

  /** Sözleşme metinleri gerçekten yüklendi mi (bilinen hata: "yüklenemedi"). */
  async contractsLoaded(): Promise<{ ok: boolean; errors: string[] }> {
    const body = await this.page.locator("body").innerText();
    const errors = body
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => /yüklenemedi/i.test(l));
    return { ok: errors.length === 0, errors };
  }

  /** ⚠️ GERÇEK SİPARİŞ AÇAR. Guard olmadan çalışmaz. */
  async submitOrder() {
    if (!ORDERS_ALLOWED) {
      throw new Error(
        "🚫 submitOrder() çağrıldı ama ALLOW_HOMEE_ORDERS=1 değil. Bu koşum sipariş açmaz.",
      );
    }
    await expect(this.payButton).toBeEnabled({ timeout: 15_000 });
    await this.payButton.click({ timeout: 20_000 });
    await this.settle(8000);
  }
}
