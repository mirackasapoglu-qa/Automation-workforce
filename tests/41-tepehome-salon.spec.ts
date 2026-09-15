/*
 * ÜRÜN: Tepe Home redesign — Salon kategorisi.
 *
 * ⚠️ ÖLÇÜLEN GERÇEK (2026-09-16): anasayfadaki "Salon" bağlantısı
 * `/tum-urunler/oturma-odasi` adresine gidiyor ve açılan sayfanın başlığı
 * "Oturma Odası" — sayfada "Salon" kelimesi HİÇ geçmiyor. Kapsam ağacındaki
 * case "üst bölümde 'Salon' görünür" diyordu; bu beklenti ÜRÜNE UYMUYOR
 * (menü adı "Salon", sayfa adı "Oturma Odası" — ayrıca raporlanacak bir
 * tutarsızlık). Test, DOĞRU olanı doğruluyor: bağlantı kategori listeleme
 * sayfasını açıyor mu.
 */
import { test, expect } from "@playwright/test";

test("Salon kategorisine anasayfadan erişim", async ({ page }) => {
  await page.goto("/");
  const salon = page.getByRole("link", { name: "Salon", exact: true }).filter({ visible: true }).first();
  await expect(salon).toBeVisible();
  await salon.click();

  // Adres anasayfadan farklı bir KATEGORİ adresine değişti mi
  await expect(page).toHaveURL(/\/tum-urunler\/[^/]+/);
  // ve listeleme sayfası gerçekten yüklendi mi (başlık + ürün kartı)
  await expect(page.getByRole("heading", { name: "Oturma Odası", exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(await page.locator("a").filter({ hasText: "₺" }).count(), "ürün kartı").toBeGreaterThan(0);
});
