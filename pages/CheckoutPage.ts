import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";
import { ORDERS_ALLOWED } from "./authState";

/**
 * /odeme — Teslimat ve Ödeme.
 *
 * ⚠️ payButton GERÇEK SİPARİŞ AÇAR. `submitOrder()` sadece ALLOW_HOMEE_ORDERS=1
 * ile çalışır; varsayılan koşumda çağrılsa bile hata fırlatır.
 *
 * Bölüm başlıkları (ölçüldü 2026-08-22, `.checkout-probe.mjs`): dördü de h2 —
 * "İletişim Bilgileri", "Teslimat Adresi Bilgileri", "Ödeme Bilgileri",
 * "Sipariş Özeti". Sayfada "Ödeme yöntemi" diye bir başlık YOK.
 */
export class CheckoutPage extends BasePage {
  readonly contactSection: Locator;
  readonly addressSection: Locator;
  readonly paymentSection: Locator;
  readonly summarySection: Locator;
  readonly addressBookButton: Locator;
  readonly newAddressButton: Locator;
  readonly creditCardOption: Locator;
  readonly transferOption: Locator;
  readonly billingSameCheckbox: Locator;
  readonly contractsCheckbox: Locator;
  readonly distanceSalesContract: Locator;
  readonly preInfoForm: Locator;

  // Havale / EFT — banka hesabı bloğu
  readonly copyRecipientButton: Locator;
  readonly copyIbanButton: Locator;

  // Kredi kartı formu (id'ler ölçüldü: checkout-card-*)
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCvcInput: Locator;
  readonly cardHolderInput: Locator;
  readonly installmentsHeading: Locator;

  /** ⚠️ GERÇEK SİPARİŞ — doğrudan tıklanmaz */
  readonly payButton: Locator;

  constructor(page: Page) {
    super(page);
    this.contactSection = page.locator('h2:visible:has-text("İletişim Bilgileri")').first();
    this.addressSection = page.locator('h2:visible:has-text("Teslimat Adresi")').first();
    // Ölçülen başlık "Ödeme Bilgileri". ESKİ HALİ "Ödeme yöntemi" arıyordu →
    // hiç eşleşmiyordu (POM-1, 2026-08-21 checkout denetimi).
    this.paymentSection = page.locator('h2:visible:has-text("Ödeme Bilgileri")').first();
    this.summarySection = page.locator('h2:visible:has-text("Sipariş Özeti")').first();
    this.addressBookButton = page.locator('button:visible:has-text("ADRES DEFTERİM")').first();
    this.newAddressButton = page.locator('button:visible:has-text("YENİ ADRES EKLE")').first();
    this.creditCardOption = page.locator('button:visible:has-text("KREDİ KARTI")').first();
    this.transferOption = page.locator('button:visible:has-text("HAVALE / EFT")').first();

    /*
     * Sayfadaki İKİ checkbox'ın da `name` niteliği YOK (ölçüldü 2026-08-22:
     * #checkout-billing-same ve #checkout-contracts-accepted, ikisi de name'siz —
     * sözleşmeler düzgün yüklenmiş koşumda bile). Bu yüzden ikisi de ID ile bağlı.
     *
     * ESKİ HALİ `input[name="checkout-contracts-accepted"], input[type="checkbox"]`
     * idi: name eşleşmediği için ikinci seçeneğe düşüp sayfadaki İLK checkbox'ı
     * ("Fatura adresim teslimat adresimle aynı") buluyordu. Sonuç: sözleşme kutusu
     * hiç işaretlenmiyor, ÖDEME YAP disabled kalıyor, sebebi görünmüyordu.
     */
    this.billingSameCheckbox = page.locator("#checkout-billing-same");
    this.contractsCheckbox = page.locator("#checkout-contracts-accepted");

    this.distanceSalesContract = page
      .locator('button:visible:has-text("Mesafeli Satış Sözleşmesi")')
      .first();
    this.preInfoForm = page.locator('button:visible:has-text("Ön Bilgilendirme Formu")').first();

    this.copyRecipientButton = page.locator('button[aria-label="Alıcı adını kopyala"]:visible').first();
    this.copyIbanButton = page.locator('button[aria-label="IBAN\'ı kopyala"]:visible').first();

    this.cardNumberInput = page.locator("#checkout-card-number");
    this.cardExpiryInput = page.locator("#checkout-card-expiry");
    this.cardCvcInput = page.locator("#checkout-card-cvc");
    this.cardHolderInput = page.locator("#checkout-card-holder");
    this.installmentsHeading = page.locator(':visible:has-text("Taksit Seçenekleri")').first();

    this.payButton = page.locator('button:visible:has-text("ÖDEME YAP")').first();
  }

  /**
   * ⚠️ `/odeme` adresine DOĞRUDAN gidilemiyor — sepette ürün olsa bile uygulama
   * `/sepet`e geri yönlendiriyor (checkout oturumu sepetteki butonla açılıyor).
   * Bu yüzden giriş her zaman sepetten yapılır.
   */
  async open() {
    await this.goto("/sepet");
    const cta = this.page.locator('button:visible:has-text("ÖDEME ADIMINA GEÇİN")').first();
    await expect(cta, "sepet boş — ödeme adımına geçilemez").toBeVisible({ timeout: 20_000 });
    await cta.click({ timeout: 15_000 });
    await this.settle(3000);
    expect(this.page.url(), "ödeme sayfasına geçilemedi").toContain("/odeme");
  }

  /** "₺4.200 - ÖDEME YAP" → 4200. Yerleşim ters de olabilir (bkz. moneyIn). */
  async payButtonAmount(): Promise<number | null> {
    const t = await this.payButton.innerText({ timeout: 10_000 }).catch(() => "");
    return BasePage.moneyIn(t);
  }

  async payButtonEnabled(): Promise<boolean> {
    return this.payButton.isEnabled({ timeout: 10_000 }).catch(() => false);
  }

  /**
   * Sipariş özetindeki "Toplam" satırı (etiketin hemen altındaki ₺ değeri).
   * POLL EDİYOR — `CartPage.moneyNear()` ile aynı gerekçe: özet basket
   * yenilemesinde yeniden mount oluyor, tek seferlik okuma null dönebiliyor.
   */
  async summaryTotal(timeoutMs = 10_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const lines = (await this.page.locator("body").innerText().catch(() => ""))
        .split("\n")
        .map((s) => s.trim());
      const idx = lines.findIndex((l) => /^Toplam$/i.test(l));
      if (idx > -1) {
        for (let i = idx; i < Math.min(idx + 3, lines.length); i++) {
          const v = BasePage.moneyIn(lines[i]);
          if (v !== null) return v;
        }
      }
      await this.page.waitForTimeout(400);
    }
    return null;
  }

  async selectPaymentMethod(method: "kredi" | "havale") {
    const btn = method === "kredi" ? this.creditCardOption : this.transferOption;
    await btn.click({ timeout: 15_000 });
    await this.page.waitForTimeout(2500);
  }

  /**
   * Havale bloğundaki banka hesabı bilgileri (etiketli satırlardan okunur).
   * Ölçüm 2026-08-22: "Banka: Türkiye İş Bankası", "Alıcı: TEPE HOME ...",
   * "IBAN: TR1000012345678901234567890" + iki kopyala butonu.
   */
  async bankTransferDetails(): Promise<{ banka: string | null; alici: string | null; iban: string | null }> {
    const lines = (await this.page.locator("body").innerText())
      .split("\n")
      .map((s) => s.trim());
    const pick = (re: RegExp) => {
      const hit = lines.find((l) => re.test(l));
      return hit ? hit.split(":").slice(1).join(":").trim() || null : null;
    };
    return {
      banka: pick(/^Banka\s*:/),
      alici: pick(/^Alıcı\s*:/),
      iban: pick(/^IBAN\s*:/),
    };
  }

  /**
   * Sozlesme onayini isaretler ve ISARETLENDIGINI DOGRULAR.
   *
   * Eski hali `click({ force: true })` yapip hicbir sey assert etmiyordu —
   * yanlis ogeye tiklasa bile sessizce geciyordu. Yikici akista bu, "neden
   * ODEME YAP disabled" sorusunu ekranin arkasina saklıyor.
   *
   * Neden Space: gercek input `sr-only`, 1x1 ve position:absolute — tiklanabilir
   * bir yuzeyi yok, `check()` actionability'de zaman asimina dusuyor
   * (olculdu: elementFromPoint merkezde null donuyor). Klavye yolu gercek bir
   * kullanici etkilesimi ve calisiyor.
   */
  async acceptContracts() {
    await this.dismissOverlays().catch(() => {});
    if (!(await this.contractsCheckbox.isChecked())) {
      try {
        await this.contractsCheckbox.check({ timeout: 4000 });
      } catch {
        await this.contractsCheckbox.focus({ timeout: 8000 });
        await this.page.keyboard.press("Space");
      }
      await this.page.waitForTimeout(600);
    }
    await expect(
      this.contractsCheckbox,
      "sozlesme onay kutusu isaretlenemedi — ODEME YAP disabled kalir",
    ).toBeChecked({ timeout: 8000 });
  }

  /** Onayı geri alır (matris testi için) ve kaldırıldığını doğrular. */
  async revokeContracts() {
    if (await this.contractsCheckbox.isChecked()) {
      try {
        await this.contractsCheckbox.uncheck({ timeout: 4000 });
      } catch {
        await this.contractsCheckbox.focus({ timeout: 8000 });
        await this.page.keyboard.press("Space");
      }
      await this.page.waitForTimeout(600);
    }
    await expect(this.contractsCheckbox, "sozlesme onayi kaldirilamadi").not.toBeChecked({
      timeout: 8000,
    });
  }

  async hasSavedAddress(): Promise<boolean> {
    const body = await this.page.locator("body").innerText();
    return !/Kayıtlı teslimat adresiniz yok/.test(body);
  }

  /** Sözleşme metinleri gerçekten yüklendi mi (bilinen hata: "yüklenemedi"). */
  async contractsLoaded(): Promise<{ ok: boolean; errors: string[] }> {
    const body = await this.page.locator("body").innerText();
    const errors = body
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => /yüklenemedi/i.test(l));
    return { ok: errors.length === 0, errors };
  }

  /** ⚠️ GERÇEK SİPARİŞ AÇAR. Guard olmadan çalışmaz. */
  async submitOrder() {
    if (!ORDERS_ALLOWED) {
      throw new Error(
        "🚫 submitOrder() çağrıldı ama ALLOW_HOMEE_ORDERS=1 değil. Bu koşum sipariş açmaz.",
      );
    }
    await expect(this.payButton).toBeEnabled({ timeout: 15_000 });
    await this.payButton.click({ timeout: 20_000 });
    await this.settle(8000);
  }
}
