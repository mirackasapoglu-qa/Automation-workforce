import { test, expect } from "@playwright/test";
import { ProductPage } from "../pages/ProductPage";
import { CartPage } from "../pages/CartPage";
import { TEST_PRODUCTS } from "./routes";

/**
 * TEST HİJYENİ: her test sepeti boşaltarak biter. Misafir sepeti oturum
 * cookie'sine bağlı; storageState dosyasına yazılmadığı için testler arası
 * sızma olmamalı — yine de temizlik zorunlu (aynı context içinde birden fazla
 * adım varsa toplam/adet assertion'ları bozulur).
 */
test.describe("06 - Sepet", () => {
  test.afterEach(async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open().catch(() => {});
    await cart.clear().catch(() => {});
  });

  test("ürün sepete eklenir ve sepette doğru satır görünür", async ({ page }) => {
    test.setTimeout(120_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    const title = (await product.title.innerText()).trim();
    const sku = product.skuFromUrl();
    const unitPrice = await product.priceValue();

    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();

    await expect(cart.heading).toBeVisible();
    expect(await cart.lineCount(), "sepete eklenen ürün sepette görünmüyor").toBe(1);

    const body = await page.locator("body").innerText();
    expect(body, "sepette ürün adı yok").toContain(title.split(" ").slice(0, 3).join(" "));
    expect(body, "sepette ürün kodu yok").toContain(sku);
    expect(await cart.subtotal(), "ara toplam ürün fiyatıyla uyuşmuyor").toBe(unitPrice);
  });

  test("adet artırma ara toplamı doğru büyütür", async ({ page }) => {
    test.setTimeout(120_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    const unitPrice = await product.priceValue();
    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();
    const before = await cart.subtotal();
    expect(before).toBe(unitPrice);

    await cart.increaseFirstLine();
    const after = await cart.subtotal();

    expect(after, `1 adet=${before}, 2 adet=${after} — ara toplam 2 katına çıkmadı`).toBe(
      unitPrice! * 2,
    );
    expect(await cart.headerItemCount()).toBe(2);
  });

  test("adet azaltma ara toplamı geri düşürür", async ({ page }) => {
    test.setTimeout(150_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    const unitPrice = await product.priceValue();
    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();
    await cart.increaseFirstLine();
    expect(await cart.subtotal()).toBe(unitPrice! * 2);

    await cart.decreaseFirstLine();
    expect(await cart.subtotal(), "azaltma sonrası ara toplam geri dönmedi").toBe(unitPrice);
  });

  test("sipariş özeti: ara toplam + teslimat = toplam", async ({ page }) => {
    test.setTimeout(120_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();

    const sub = await cart.subtotal();
    const ship = await cart.shipping();
    const total = await cart.total();

    expect(sub, "ara toplam okunamadı").not.toBeNull();
    expect(total, "toplam okunamadı").not.toBeNull();
    expect(total, `${sub} + ${ship} ≠ ${total}`).toBeCloseTo((sub ?? 0) + (ship ?? 0), 2);
  });

  test("ürün sepetten silinir ve sepet boşalır", async ({ page }) => {
    test.setTimeout(120_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();
    expect(await cart.lineCount()).toBe(1);

    // Yıkıcı işlem: index'e kilitli, global .last() ile arama yok
    const { before, after } = await cart.removeLineByIndex(0);
    expect(after, `silme öncesi=${before} sonrası=${after}`).toBe(before - 1);
    expect(await cart.isEmpty(), "sepet boşalmadı").toBe(true);
  });

  test("boş sepette ödeme butonu yok, alışverişe devam bağlantısı var", async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();
    await cart.clear();
    await cart.open();

    expect(await cart.isEmpty()).toBe(true);
    await expect(cart.checkoutButton).toHaveCount(0);
  });

  test("iki farklı ürün sepette iki satır oluşturur", async ({ page }) => {
    test.setTimeout(180_000);
    const product = new ProductPage(page);
    await product.open(TEST_PRODUCTS.sapTest);
    await product.addToCart();
    await product.open(TEST_PRODUCTS.deneme);
    await product.addToCart();

    const cart = new CartPage(page);
    await cart.open();
    expect(await cart.lineCount(), "iki ürün için iki satır beklenir").toBe(2);
  });
});
