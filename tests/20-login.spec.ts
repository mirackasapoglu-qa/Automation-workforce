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
    test.setTimeout(90_000);
    const login = new LoginPage(page);
    await login.open();

    // "admin" geçerli bir e-posta değil → format uyarısı beklenir
    await login.emailInput.fill("admin");
    await login.passwordInput.fill("password123");
    const msg = await login.submitAndCatchMessage(/geçerli bir e-posta/i);

    expect(msg, "e-posta format uyarısı gösterilmedi").not.toBeNull();
    await login.assertStillOnLogin();
  });

  test("yanlış şifre ile giriş reddedilir", async ({ page }) => {
    test.setTimeout(90_000);
    const login = new LoginPage(page);
    await login.open();

    await login.emailInput.fill(TEST_EMAIL || "qa-yok@example.com");
    await login.passwordInput.fill("KesinlikleYanlisSifre123!");

    // Mesaj ~1.2 sn sonra çıkıp kaybolan bir toast → poll ederek yakala
    const msg = await login.submitAndCatchMessage(
      /kontrol edin|hatalı|geçersiz|yanlış|bulunamadı|eşleşmiyor/i,
    );

    expect(msg, "hatalı giriş mesajı hiç gösterilmedi").not.toBeNull();
    await login.assertStillOnLogin();
  });

  test("boş form gönderiminde zorunlu alan uyarısı", async ({ page }) => {
    test.setTimeout(90_000);
    const login = new LoginPage(page);
    await login.open();

    const msg = await login.submitAndCatchMessage(/giriniz|zorunlu|gerekli|doldur/i);

    expect(msg, "boş formda hiçbir validasyon mesajı çıkmadı").not.toBeNull();
    await login.assertStillOnLogin();
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
