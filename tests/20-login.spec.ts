import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { TEST_EMAIL, TEST_PASSWORD } from "../pages/authState";

/**
 * Bu spec MİSAFİR state ile koşar (varsayılan storageState = <env>-gate.json),
 * yani oturum açık değil — login testleri için doğru başlangıç durumu.
 */
test.describe("20 - Giriş (pozitif / negatif)", () => {
  test("giriş sayfası tüm yöntemleri sunar", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await expect(login.heading).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
    await expect(login.smsLoginButton).toBeVisible();
    await expect(login.googleButton).toBeVisible();
    await expect(login.appleButton).toBeVisible();
  });

  test("e-posta formatı geçersizse uyarı verir", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await login.login("admin", "password123");
    await login.assertStillOnLogin();

    const msgs = await login.validationMessages();
    expect(msgs.join(" "), `beklenen format uyarısı yok: ${JSON.stringify(msgs)}`).toMatch(
      /geçerli bir e-posta/i,
    );
  });

  test("yanlış şifre ile giriş reddedilir", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await login.login(TEST_EMAIL || "qa-yok@example.com", "KesinlikleYanlisSifre123!");
    await login.assertStillOnLogin();

    const body = await page.locator("body").innerText();
    expect(body, "hatalı giriş mesajı gösterilmedi").toMatch(
      /hatalı|geçersiz|yanlış|bulunamadı|eşleşmiyor/i,
    );
  });

  test("boş form gönderiminde zorunlu alan uyarısı", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await login.submitButton.click({ timeout: 15_000 });
    await page.waitForTimeout(2500);
    await login.assertStillOnLogin();

    const msgs = await login.validationMessages();
    expect(msgs.length, "hiçbir validasyon mesajı çıkmadı").toBeGreaterThan(0);
  });

  test("doğru bilgilerle giriş yapılır ve hesap sayfasına yönlenir", async ({ page }) => {
    test.skip(!TEST_EMAIL || !TEST_PASSWORD, "TEST_EMAIL/TEST_PASSWORD .env'de yok");
    const login = new LoginPage(page);
    await login.open();

    await login.login(TEST_EMAIL, TEST_PASSWORD);

    expect(page.url(), "giriş sonrası /hesabim'a yönlenmedi").toContain("/hesabim");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body, "hesap sayfasında kullanıcı e-postası görünmüyor").toContain(
      TEST_EMAIL.toLowerCase(),
    );
  });

  test("korumalı sayfa misafirken login'e yönlendirir", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto("/hesabim/siparislerim");

    expect(page.url()).toContain("/giris");
    expect(page.url()).toContain("redirect");
  });
});
