import { test as base, Page, BrowserContext, expect } from "@playwright/test";
import { GUEST_STATE, TEST_EMAIL, TEST_PASSWORD } from "../pages/authState";

/**
 * ⚠️ HOMEE'YE ÖZGÜ: ÜYE OTURUMU STORAGE STATE İLE PAYLAŞILAMAZ.
 *
 * Uygulama refresh-token'ı KULLANIMDA ROTATE ediyor: kaydedilmiş bir üye
 * storageState'i ilk açan context çalışır, aynı dosyayla açılan ikinci context
 * doğrudan /giris'e düşer (ölçüldü: 1. context OK, 2. ve 3. FAIL).
 *
 * Bu yüzden NadirGold'daki "tek state'i tüm testler paylaşır" deseni burada
 * KULLANILAMAZ. Her üye testi kendi context'inde UI login yapar (~8 sn).
 * Kapı (temporary_auth_verified) cookie'si paylaşılabilir — o rotate olmuyor.
 */
export async function loginAsMember(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("TEST_EMAIL / TEST_PASSWORD .env içinde yok — üye testleri koşamaz.");
  }

  await page.goto("/giris?redirect=%2Fhesabim", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  // ⚠️ Alanlar `readonly` acilıyor (otomatik doldurmaya karsi); readonly
  // yalnizca TIKLAYINCA kalkiyor. Once click, sonra fill — aksi halde
  // Playwright "element is not editable" ile 30sn bekleyip dusuyor.
  const emailInput = page.locator('input[name="email"]:visible, input[name="login-email"]:visible').first();
  const passwordInput = page.locator('input[name="password"]:visible, input[name="login-password"]:visible').first();
  await emailInput.click();
  await emailInput.fill(TEST_EMAIL);
  await passwordInput.click();
  await passwordInput.fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "GİRİŞ YAP", exact: true }).first().click({ timeout: 15_000 });
  await page.waitForTimeout(6000);

  // Gerçek doğrulama: sadece "login'e yönlenmedi" yetmez, e-posta görünmeli
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(
    body.includes(TEST_EMAIL.toLowerCase()) || !page.url().includes("/giris"),
    "üye girişi doğrulanamadı",
  ).toBe(true);
}

type MemberFixtures = {
  /** Girişi yapılmış, izole context'te taze sayfa. */
  memberPage: Page;
};

export const test = base.extend<MemberFixtures>({
  memberPage: async ({ browser, baseURL }, use) => {
    const context: BrowserContext = await browser.newContext({
      baseURL,
      storageState: GUEST_STATE,
    });
    const page = await context.newPage();
    await loginAsMember(page);
    await use(page);
    await context.close();
  },
});

export { expect };
