import { test, expect } from "./fixtures";
import { AddressPage } from "../pages/AddressPage";

/**
 * TEST HİJYENİ:
 *  - Oluşturulan adres ayırt edilebilir başlık taşır: "QA-ADRES-<timestamp>"
 *  - Test kendi oluşturduğu kaydı siler ve sildiğini ÖLÇEREK doğrular.
 *  - Silme seçicisi başlığı içeren karta kilitli; global .last() kullanılmaz.
 */
const stamp = () => `QA-ADRES-${Date.now().toString().slice(-6)}`;

test.describe("22 - Adres yönetimi", () => {
  test("adres listesi ve 'YENİ ADRES EKLE' formu açılır", async ({ memberPage }) => {
    const addr = new AddressPage(memberPage);
    await addr.open();

    await expect(addr.heading).toBeVisible();
    await addr.openForm();

    await expect(addr.titleInput).toBeVisible();
    await expect(addr.firstNameInput).toBeVisible();
    await expect(addr.lastNameInput).toBeVisible();
    await expect(addr.phoneInput).toBeVisible();
    await expect(addr.detailTextarea).toBeVisible();
    await expect(addr.saveButton).toBeVisible();
    await expect(addr.individualTab).toBeVisible();
    await expect(addr.corporateTab).toBeVisible();
  });

  test("boş form kaydedilmeye çalışılınca validasyon verir", async ({ memberPage }) => {
    const addr = new AddressPage(memberPage);
    await addr.open();
    await addr.openForm();

    await addr.save();

    // Form kapanmamalı ve uyarı görünmeli.
    // Gözlem (2026-08-18): boş formda yalnızca "Lütfen telefon numaranızı giriniz."
    // uyarısı çıkıyor — diğer zorunlu alanlar için uyarı yok. Test en az bir
    // validasyon mesajı bekler; alan bazlı eksiklik FINDINGS.md'de not edildi.
    await expect(addr.titleInput, "boş form kaydedildi (validasyon yok!)").toBeVisible();
    const body = await memberPage.locator("body").innerText();
    expect(body).toMatch(/zorunlu|gerekli|giriniz|boş bırak|doldur|seçiniz/i);
  });

  test("yeni adres eklenir, listede görünür ve sonra silinir", async ({ memberPage }) => {
    test.setTimeout(240_000);
    const addr = new AddressPage(memberPage);
    const title = stamp();

    await addr.open();
    const initialCount = await addr.addressCount();

    await addr.openForm();
    await addr.fillForm({
      title,
      firstName: "QA",
      lastName: "Otomasyon",
      phone: "5551234567",
      identityNumber: "11111111110",
      detail: "QA test adresi — otomasyon tarafından oluşturuldu, silinecek.",
    });
    await addr.save();

    // Kaydedildi mi?
    await addr.open();
    expect(await addr.hasAddressTitled(title), `"${title}" listede görünmüyor`).toBe(true);
    const afterCreate = await addr.addressCount();
    expect(afterCreate, "adres sayısı artmadı").toBe(initialCount + 1);

    // TEMİZLİK: kendi oluşturduğu kaydı sil ve ölçerek doğrula
    await addr.deleteAddressTitled(title);
    await addr.open();
    expect(await addr.hasAddressTitled(title), `"${title}" silinemedi`).toBe(false);
    expect(await addr.addressCount(), "silme sonrası sayı başlangıca dönmedi").toBe(initialCount);
  });
});
