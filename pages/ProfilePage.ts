import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * /hesabim/profil — Profil & Ayarlar.
 *
 * ⚠️ Bu sayfada HESABIMI SİL ve ŞİFREMİ DEĞİŞTİR var. Suite bunlara ASLA basmaz;
 * POM'da locator olarak tutulur ki "var mı" assert edilebilsin (tıklama yok).
 */
export class ProfilePage extends BasePage {
  readonly heading: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly birthDateInput: Locator;
  readonly mailPermission: Locator;
  readonly smsPermission: Locator;
  readonly phonePermission: Locator;
  readonly updateInfoButton: Locator;
  readonly savePreferencesButton: Locator;
  /** ⚠️ TIKLANMAZ */
  readonly changePasswordButton: Locator;
  /** ⚠️ TIKLANMAZ */
  readonly deleteAccountButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Profil")').first();
    this.firstNameInput = page.locator('input[name="firstName"]:visible').first();
    this.lastNameInput = page.locator('input[name="lastName"]:visible').first();
    this.emailInput = page.locator('input[name="email"]:visible').first();
    this.phoneInput = page.locator('input[name="phone"]:visible').first();
    this.birthDateInput = page.locator('input[name="birthDate"]:visible').first();
    this.mailPermission = page.locator('input[name="permission-mail"]').first();
    this.smsPermission = page.locator('input[name="permission-sms"]').first();
    this.phonePermission = page.locator('input[name="permission-phone"]').first();
    this.updateInfoButton = page.locator('button:visible:has-text("BİLGİLERİMİ GÜNCELLE")').first();
    this.savePreferencesButton = page.locator('button:visible:has-text("TERCİHLERİMİ KAYDET")').first();
    this.changePasswordButton = page.locator('button:visible:has-text("ŞİFREMİ DEĞİŞTİR")').first();
    this.deleteAccountButton = page.locator('button:visible:has-text("HESABIMI SİL")').first();
  }

  async open() {
    await this.goto("/hesabim/profil");
  }

  async permissionStates(): Promise<{ mail: boolean; sms: boolean; phone: boolean }> {
    return {
      mail: await this.mailPermission.isChecked().catch(() => false),
      sms: await this.smsPermission.isChecked().catch(() => false),
      phone: await this.phonePermission.isChecked().catch(() => false),
    };
  }

  /** Tercih toggle'ı + kaydet. Test hijyeni: çağıran taraf ESKİ DURUMA GERİ ALMALI. */
  async togglePermission(which: "mail" | "sms" | "phone") {
    const map = { mail: this.mailPermission, sms: this.smsPermission, phone: this.phonePermission };
    await map[which].click({ timeout: 12_000, force: true });
    await this.page.waitForTimeout(800);
  }

  async savePreferences() {
    await this.savePreferencesButton.click({ timeout: 15_000 });
    await this.page.waitForTimeout(4000);
  }
}
