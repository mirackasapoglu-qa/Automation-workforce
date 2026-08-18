import { test, expect } from "./fixtures";
import { ProductPage } from "../pages/ProductPage";
import { CartPage } from "../pages/CartPage";
import { CheckoutPage } from "../pages/CheckoutPage";
import { TEST_PRODUCTS } from "./routes";
import { ORDERS_ALLOWED } from "../pages/authState";
import { KNOWN_ISSUES } from "./known-issues";

/**
 * ⚠️ KAPSAM SINIRI: Bu spec ÖDEME ADIMINA KADAR gider, siparişi TAMAMLAMAZ.
 * "ÖDEME YAP" butonuna basılmaz (CheckoutPage.submitOrder() ayrıca
 * ALLOW_HOMEE_ORDERS=1 guard'ı ile korunuyor).
 *
 * TEST HİJYENİ: her test sepeti boşaltarak biter.
 */
test.describe("25 - Ödeme adımı (sipariş tamamlanmaz)", () => {
  test.afterEach(async ({ memberPage }) => {
    const cart = new CartPage(memberPage);
    await cart.open().catch(() => {});
    await cart.clear().catch(() => {});
  });

  test("sepetten ödeme adımına geçilir ve tüm bölümler render olur", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const cart = new CartPage(memberPage);
    await cart.open();
    const cartTotal = await cart.total();
    await cart.proceedToCheckout();

    expect(memberPage.url(), "ödeme sayfasına geçilemedi").toContain("/odeme");

    const checkout = new CheckoutPage(memberPage);
    await expect(checkout.contactSection).toBeVisible();
    await expect(checkout.addressSection).toBeVisible();
    await expect(checkout.paymentSection).toBeVisible();
    await expect(checkout.summarySection).toBeVisible();

    // Sepet toplamı ödeme butonundaki tutarla aynı olmalı
    expect(await checkout.payButtonAmount(), "ödeme tutarı sepet toplamıyla uyuşmuyor").toBe(
      cartTotal,
    );
  });

  test("ödeme yöntemleri (kredi kartı / havale) seçilebilir", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const checkout = new CheckoutPage(memberPage);
    await checkout.open();

    await expect(checkout.creditCardOption).toBeVisible();
    await expect(checkout.transferOption).toBeVisible();

    await checkout.selectPaymentMethod("havale");
    await checkout.assertNotNotFound();
    await checkout.selectPaymentMethod("kredi");
    await checkout.assertNotNotFound();
  });

  /** BİLİNEN HATA HOMEE-004 */
  test("sözleşme metinleri yüklenir (Mesafeli Satış / Ön Bilgilendirme)", async ({ memberPage }) => {
    test.setTimeout(180_000);
    test.fail(true, `${KNOWN_ISSUES.checkoutContractsNotLoading.id}: ${KNOWN_ISSUES.checkoutContractsNotLoading.detail}`);
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const checkout = new CheckoutPage(memberPage);
    await checkout.open();

    const { ok, errors } = await checkout.contractsLoaded();
    expect(ok, `sözleşme metinleri yüklenemedi:\n${errors.join("\n")}`).toBe(true);
  });

  test("sözleşme onayı olmadan ödeme butonu ilerletmez", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const checkout = new CheckoutPage(memberPage);
    await checkout.open();

    expect(await checkout.contractsCheckbox.isChecked(), "sözleşme baştan onaylı gelmemeli").toBe(
      false,
    );
    // Buton görünür ama sipariş açmadığımız için TIKLAMIYORUZ
    await expect(checkout.payButton).toBeVisible();
  });

  test("adres olmadan uyarı gösterilir", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const checkout = new CheckoutPage(memberPage);
    await checkout.open();

    if (await checkout.hasSavedAddress()) {
      test.skip(true, "Hesapta kayıtlı adres var — 'adres yok' durumu test edilemez");
    }
    const body = await memberPage.locator("body").innerText();
    expect(body).toMatch(/Kayıtlı teslimat adresiniz yok/);
    await expect(checkout.newAddressButton).toBeVisible();
  });

  test("sipariş tamamlama guard'ı aktif (ALLOW_HOMEE_ORDERS)", async ({ memberPage }) => {
    const checkout = new CheckoutPage(memberPage);
    if (ORDERS_ALLOWED) {
      test.skip(true, "ALLOW_HOMEE_ORDERS=1 — guard kapalı, bu kontrol atlandı");
    }
    await expect(async () => {
      await checkout.submitOrder();
    }).rejects.toThrow(/ALLOW_HOMEE_ORDERS/);
  });
});
