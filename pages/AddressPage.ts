import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export type AddressData = {
  title: string;
  firstName: string;
  lastName: string;
  phone: string;
  identityNumber?: string;
  detail: string;
};

/**
 * /hesabim/adreslerim — adres CRUD.
 * Şehir / İlçe / Mahalle native <select> DEĞİL, custom dropdown button'ları.
 */
export class AddressPage extends BasePage {
  readonly heading: Locator;
  readonly addButton: Locator;
  readonly titleInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly phoneInput: Locator;
  readonly phone2Input: Locator;
  readonly identityInput: Locator;
  readonly notTrCitizenCheckbox: Locator;
  readonly detailTextarea: Locator;
  readonly makeDefaultCheckbox: Locator;
  readonly cityDropdown: Locator;
  readonly districtDropdown: Locator;
  readonly neighborhoodDropdown: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly individualTab: Locator;
  readonly corporateTab: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Adreslerim")').first();
    this.addButton = page.locator('button:visible:has-text("YENİ ADRES EKLE")').first();
    this.titleInput = page.locator('input[name="title"]:visible').first();
    this.firstNameInput = page.locator('input[name="firstName"]:visible').first();
    this.lastNameInput = page.locator('input[name="lastName"]:visible').first();
    this.phoneInput = page.locator('input[name="phone"]:visible').first();
    this.phone2Input = page.locator('input[name="phone2"]:visible').first();
    this.identityInput = page.locator('input[name="identityNumber"]:visible').first();
    this.notTrCitizenCheckbox = page.locator('input[name="not-tr-citizen"]').first();
    this.detailTextarea = page.locator('textarea[name="addressDetail"]:visible').first();
    this.makeDefaultCheckbox = page.locator('input[name="make-default-address"]').first();
    this.cityDropdown = page.locator('button:visible:has-text("Şehir")').first();
    this.districtDropdown = page.locator('button:visible:has-text("İlçe")').first();
    this.neighborhoodDropdown = page.locator('button:visible:has-text("Mahalle")').first();
    this.saveButton = page.locator('button:visible:has-text("ADRESİ KAYDET")').first();
    this.cancelButton = page.locator('button:visible:has-text("VAZGEÇ")').first();
    this.individualTab = page.locator('button:visible:has-text("Bireysel")').first();
    this.corporateTab = page.locator('button:visible:has-text("Kurumsal")').first();
  }

  async open() {
    await this.goto("/hesabim/adreslerim");
  }

  async openForm() {
    await this.addButton.click({ timeout: 20_000 });
    await this.page.waitForTimeout(2500);
    await expect(this.titleInput, "adres formu açılmadı").toBeVisible({ timeout: 15_000 });
  }

  /** Custom dropdown: butona tıkla, açılan listeden ilk (ya da eşleşen) seçeneği seç. */
  async pickFromDropdown(dropdown: Locator, optionText?: string) {
    await dropdown.click({ timeout: 15_000 });
    await this.page.waitForTimeout(1500);
    const option = optionText
      ? this.page.locator(`li:visible:has-text("${optionText}"), button:visible:has-text("${optionText}"), div[role="option"]:visible:has-text("${optionText}")`).first()
      : this.page.locator('li:visible, div[role="option"]:visible').first();
    await option.click({ timeout: 15_000 });
    await this.page.waitForTimeout(1800);
  }

  async fillForm(data: AddressData, opts: { city?: string; district?: string } = {}) {
    await this.titleInput.fill(data.title);
    await this.firstNameInput.fill(data.firstName);
    await this.lastNameInput.fill(data.lastName);
    await this.phoneInput.fill(data.phone);
    if (data.identityNumber) {
      await this.identityInput.fill(data.identityNumber).catch(() => {});
    }
    await this.pickFromDropdown(this.cityDropdown, opts.city);
    await this.pickFromDropdown(this.districtDropdown, opts.district);
    if (await this.neighborhoodDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.pickFromDropdown(this.neighborhoodDropdown);
    }
    await this.detailTextarea.fill(data.detail);
  }

  async save() {
    await this.saveButton.click({ timeout: 20_000 });
    await this.page.waitForTimeout(5000);
    await this.dismissOverlays();
  }

  /** Kayıtlı adres kartı sayısı — başlık metnine göre sayar. */
  async addressCount(): Promise<number> {
    const body = await this.page.locator("body").innerText();
    if (/Kayıtlı adresiniz bulunmuyor/.test(body)) return 0;
    return this.page.locator('button:visible:has-text("Düzenle")').count();
  }

  async hasAddressTitled(title: string): Promise<boolean> {
    const body = await this.page.locator("body").innerText();
    return body.includes(title);
  }

  /**
   * Adres siler. YIKICI: seçici, adres başlığını içeren KARTA kilitlenir; onay
   * modalındaki buton global .last() ile aranmaz.
   */
  async deleteAddressTitled(title: string) {
    const card = this.page
      .locator("div")
      .filter({ hasText: title })
      .filter({ has: this.page.locator('button:has-text("Sil")') })
      .last();

    const deleteBtn = card.locator('button:has-text("Sil")').first();
    await expect(deleteBtn, `"${title}" başlıklı adres kartında Sil butonu yok`).toBeVisible({
      timeout: 12_000,
    });
    await deleteBtn.click({ timeout: 15_000 });
    await this.page.waitForTimeout(2000);

    // Onay modalı: modal konteynerine kilitle
    const modal = this.page.locator('[role="dialog"]:visible, div:visible:has-text("emin misiniz")').last();
    const confirm = modal.locator('button:visible:has-text("Sil"), button:visible:has-text("EVET"), button:visible:has-text("ONAYLA")').first();
    if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) {
      await confirm.click({ timeout: 12_000 });
    }
    await this.page.waitForTimeout(4500);
    await this.dismissOverlays();
  }
}
