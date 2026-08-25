import { test, expect } from "./fixtures";
import { ProductPage } from "../pages/ProductPage";
import { CartPage } from "../pages/CartPage";
import { CheckoutPage } from "../pages/CheckoutPage";
import { OrdersPage } from "../pages/OrdersPage";
import { TEST_PRODUCTS } from "./routes";
import { ORDERS_ALLOWED } from "../pages/authState";

/**
 * 26 - HAVALE / EFT ile sipariş tamamlama
 *
 * ⚠️⚠️ BU SPEC GERÇEK SİPARİŞ AÇAR. `ALLOW_HOMEE_ORDERS=1` olmadan komple skip
 * edilir. Havale seçildiği için PARA ÇEKİLMEZ — sipariş "ödeme bekliyor"
 * durumunda banka/IBAN bilgisi ekranıyla kalır. Ama sipariş kaydı OLUŞUR ve
 * otomasyonla İPTAL EDİLEMEZ (OrdersPage'de iptal akışı yok).
 *
 * Bu yüzden:
 *   - yalnızca SAP test ürünü kullanılır (TEST_PRODUCTS.deneme), 1 adet
 *   - koşum başına TEK sipariş açılır
 *   - sipariş numarası ve banka ekranı kanıt olarak diske yazılır
 *
 * Ölçüm (2026-08-20): havale akışında banka bilgisi ekranı POM'da modellenmemişti;
 * bu spec o ekranı ilk kez doğruluyor.
 */
test.describe("26 - Havale ile sipariş tamamlama", () => {
  test.skip(
    !ORDERS_ALLOWED,
    "ALLOW_HOMEE_ORDERS=1 verilmedi — gerçek sipariş açan spec atlandı",
  );

  test("havale ile sipariş tamamlanır ve banka bilgisi gösterilir", async ({ memberPage }, testInfo) => {
    test.setTimeout(300_000);

    // 0) ÖN KOŞUL: sepet boş olmalı.
    // `addToCart()` badge'in ARTMASINI bekliyor; sepette aynı ürün zaten varsa
    // adet artıyor ama satır sayısı değişmiyor ve ekleme "doğrulanamadı" diye
    // patlıyor. Ölçüldü 2026-08-21: önceki bir koşumdan kalan tek ürün bu spec'i
    // iki kez düşürdü. Boş sepeti varsaymak yerine garanti ediyoruz.
    const cart = new CartPage(memberPage);
    await cart.open();
    if ((await cart.lineCount()) > 0) {
      await cart.clear();
      expect(await cart.lineCount(), "sepet temizlenemedi, ön koşul sağlanamıyor").toBe(0);
    }

    // 1) Tek test ürünü, 1 adet
    const product = new ProductPage(memberPage);
    await product.open(TEST_PRODUCTS.deneme);
    await product.addToCart();

    await cart.open();
    expect(await cart.lineCount(), "sepette tam 1 satır olmalı").toBe(1);
    expect(await cart.firstLineQuantity(), "adet 1 olmalı").toBe(1);
    const cartTotal = await cart.total();
    await cart.proceedToCheckout();

    // 2) Ödeme adımı — havale
    const checkout = new CheckoutPage(memberPage);
    expect(memberPage.url()).toContain("/odeme");
    expect(await checkout.hasSavedAddress(), "kayıtlı teslimat adresi yok").toBe(true);
    await checkout.selectPaymentMethod("havale");
    await checkout.acceptContracts();

    const payAmount = await checkout.payButtonAmount();
    expect(payAmount, "ödeme tutarı sepet toplamıyla uyuşmuyor").toBe(cartTotal);

    await memberPage.screenshot({
      path: `panel-data/evidence/26-havale-odeme-adimi.png`,
      fullPage: true,
    });

    // 3) ⚠️ GERÇEK SİPARİŞ
    await checkout.submitOrder();

    // 4) Sonuç ekranı: sipariş numarası + banka bilgisi
    const body = await memberPage.locator("body").innerText();

    /*
     * Sipariş no: doğrudan ORD- kalıbı.
     * ESKİ HALİ etiketten yakalıyordu: /(?:Sipariş\s*(?:No|Numaras[ıi])...)/i
     * Sayfa "SİPARİŞ NO:" yazıyor ve JS'de dotted İ (U+0130) ile i, `/i` bayrağı
     * altında bile eşdeğer DEĞİL — regex hiç eşleşmiyordu. Ölçüldü 2026-08-21:
     * gerçek sipariş ORD-20260821-896094 açıldı ama numara "okunamadı" oluyordu.
     */
    const orderNo = body.match(/\bORD-\d{8}-\d+\b/)?.[0] ?? null;
    testInfo.annotations.push({ type: "siparis-no", description: orderNo ?? "okunamadı" });
    testInfo.annotations.push({ type: "tutar", description: String(payAmount) });

    /*
     * KANIT DOSYA ADINA SİPARİŞ NO GİRİYOR. Sabit adla yazıldığında her koşum
     * öncekini eziyordu: 2026-08-22'de üç gerçek sipariş açılmıştı ama diskte
     * yalnızca en sonuncunun kanıtı kaldı. Sipariş kaydı otomasyonla iptal
     * edilemediği için kanıtın kalıcı olması gerekiyor.
     */
    const stamp = orderNo ?? `okunamadi-${testInfo.workerIndex}`;

    /*
     * Başarı sayfası `/odeme/basarili` — yani "/odeme" İÇERİYOR.
     * `not.toContain("/odeme")` bu yüzden gerçek bir siparişten sonra bile
     * fail veriyordu (ölçüldü: ORD-20260821-896094 açıldı, test kırmızı kaldı).
     * Ödeme formunda KALMADIĞIMIZI, başarı sayfasına GİTTİĞİMİZİ doğruluyoruz.
     */
    expect(memberPage.url(), "sipariş sonuç sayfasına gidilmedi").toMatch(
      /\/odeme\/basarili/,
    );
    expect(orderNo, `sipariş numarası okunamadı. Sayfa metni:\n${body.slice(0, 600)}`).not.toBeNull();

    await memberPage.screenshot({
      path: `panel-data/evidence/26-havale-${stamp}-sonuc.png`,
      fullPage: true,
    });

    // Havalede IBAN/banka bilgisi gösterilmeli — ödeme buradan yapılacak
    expect(
      body,
      `havale sonuç ekranında banka/IBAN bilgisi yok. Sayfa:\n${body.slice(0, 600)}`,
    ).toMatch(/IBAN|Banka|Havale|EFT/i);

    // 5) Hesaptan doğrula
    const orders = new OrdersPage(memberPage);
    await orders.open();
    const ordersBody = await memberPage.locator("body").innerText();
    expect(
      ordersBody,
      `sipariş ${orderNo} /hesabim/siparislerim listesinde görünmüyor`,
    ).toContain(orderNo!);

    await memberPage.screenshot({
      path: `panel-data/evidence/26-havale-${stamp}-siparislerim.png`,
      fullPage: true,
    });
    console.log(`\n✓ SİPARİŞ AÇILDI — no: ${orderNo}, tutar: ${payAmount}\n`);
  });
});
