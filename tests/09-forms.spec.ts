import { test, expect } from "@playwright/test";
import { BasePage } from "../pages/BasePage";
import { KNOWN_ISSUES } from "./known-issues";

/**
 * Form testleri KASITLI OLARAK yıkıcı değil: gerçek iletişim talebi / gerçek bülten
 * kaydı oluşturmuyoruz. Sadece validasyon davranışını doğruluyoruz.
 * (Gerçek gönderim gerekirse ayrı bir spec + kullanıcı onayı ile eklenir.)
 */
test.describe("09 - Formlar (validasyon)", () => {
  test("bülten aboneliği geçersiz e-postayı reddeder", async ({ page }) => {
    const p = new BasePage(page);
    await p.goto("/");

    await p.newsletterInput.scrollIntoViewIfNeeded();
    await p.newsletterInput.fill("gecersiz-eposta");
    await p.newsletterSubmit.click({ timeout: 12_000 });
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();
    expect(body, "geçersiz e-posta için uyarı gösterilmedi").toMatch(
      /geçerli|geçersiz|hatalı|giriniz/i,
    );
  });

  test("iletişim sayfası formu render olur", async ({ page }) => {
    const p = new BasePage(page);
    await p.goto("/iletisim");

    await p.assertNotNotFound();
    const inputs = await page.locator("input:visible, textarea:visible").count();
    expect(inputs, "iletişim formunda alan bulunamadı").toBeGreaterThan(1);
  });

  /** BİLİNEN HATA HOMEE-003: boş gönderimde hiçbir geri bildirim yok */
  test("iletişim formu boş gönderimde validasyon gösterir", async ({ page }) => {
    test.fail(true, `${KNOWN_ISSUES.contactFormNoValidation.id}: ${KNOWN_ISSUES.contactFormNoValidation.detail}`);
    const p = new BasePage(page);
    await p.goto("/iletisim");

    const submit = page
      .locator('form button[type="submit"]:visible, button:visible:has-text("GÖNDER")')
      .first();
    if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "İletişim formunda gönder butonu bulunamadı");
    }
    await submit.click({ timeout: 12_000 });
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();
    expect(body, "boş gönderimde validasyon çıkmadı").toMatch(
      /zorunlu|gerekli|giriniz|boş bırak|doldur/i,
    );
  });
});
