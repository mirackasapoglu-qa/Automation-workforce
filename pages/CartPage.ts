import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export class CartPage extends BasePage {
  readonly heading: Locator;
  readonly itemCountText: Locator;
  readonly increaseButtons: Locator;
  readonly decreaseButtons: Locator;
  readonly removeButtons: Locator;
  readonly moveToFavoritesButtons: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly couponApplyButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1:visible:has-text("Sepetim")').first();
    this.itemCountText = page.locator("text=/^\\d+ ürün$/").first();
    /**
     * Adet stepper'i — SEÇİCİ İKİ LABEL BİÇİMİNİ DE KABUL EDER.
     *
     * Uygulama azalt butonunu "Azalt" → "Adet azalt" olarak değiştirdi, artır
     * butonu "Artır" kaldı (yarım yapılmış değişiklik, 2026-08-24'te 4 test
     * kırdı). Tam eşleşme yerine DEĞİŞMEYEN EK kullanılıyor; `i` bayrağına
     * güvenilmiyor çünkü Türkçe büyük/küçük harf katlaması (I/ı) tutarsız:
     *   "zalt" → Azalt, Adet azalt   ·   "rtır" → Artır, Adet artır
     */
    this.increaseButtons = page.locator('button[aria-label*="rtır"]:visible');
    this.decreaseButtons = page.locator('button[aria-label*="zalt"]:visible');
    this.removeButtons = page.locator('button[aria-label="Ürünü kaldır"]:visible');
    this.moveToFavoritesButtons = page.locator('button[aria-label="Favorilere ekle"]:visible');
    this.checkoutButton = page.locator('button:visible:has-text("ÖDEME ADIMINA GEÇİN")').first();
    this.continueShoppingButton = page
      .locator('button:visible:has-text("ALIŞVERİŞ YAPMAYA DEVAM EDİN")')
      .first();
    this.couponApplyButton = page.locator('button:visible:has-text("Uygula")').first();
  }

  /**
   * Sepet API'sinin son söylediği satır sayısını izler.
   *
   * NEDEN GEREKLİ: "sepet boş mu" sorusunun tek güvenilir cevabı uygulamanın
   * kendi yanıtı. DOM'a bakmak yanıltıyor — /sepet, basket yanıtı GELDİKTEN
   * SONRA bile saniyelerce boş durumu gösterebiliyor (ölçüldü 2026-08-22:
   * 12 turun 2'sinde API iki kez adet=1 döndü, sayfa yine "Sepetiniz boş"
   * gösterdi, satır ~15 sn içinde navigasyon olmadan geldi).
   */
  private watchBasket() {
    let son: number | null = null;
    const handler = async (r: import("@playwright/test").Response) => {
      if (!/\/v1\/baskets/.test(r.url())) return;
      if (r.status() === 404) {
        son = 0; // "Sepet bulunamadı" = son ürün de çıkmış
        return;
      }
      try {
        const j: any = await r.json();
        const d = j?.data ?? j;
        const items = d?.items ?? d?.basketItems ?? d?.lines;
        if (Array.isArray(items)) son = items.length;
      } catch {
        /* JSON değil, yoksay */
      }
    };
    this.page.on("response", handler);
    return {
      sonAdet: () => son,
      kapat: () => this.page.off("response", handler),
    };
  }

  /**
   * Sepet sayfası bazen BAYAT render dönüyor: header badge'inde ürün görünürken
   * liste boş geliyor. Dinleyici navigasyondan ÖNCE kurulur, yoksa ilk basket
   * yanıtı kaçar.
   */
  async open() {
    const izle = this.watchBasket();
    try {
      await this.goto("/sepet");
      await this.waitForRendered(izle);
    } finally {
      izle.kapat();
    }
  }

  /**
   * Sepetin GERÇEKTEN boyandığını bekler ve "boş" kararını API'ye dayandırır.
   *
   * ESKİ HALİ iki kez yanıldı:
   *  1) yalnızca `badge === 0` görünce "boş" deyip dönüyordu,
   *  2) sonra eklenen `/Sepetiniz boş/` kontrolü de aynı tuzağa düştü — çünkü o
   *     metin SAYFA YÜKLENIRKEN de ekranda duruyor.
   * Sonuç: sepette ürün varken `lineCount() === 0` dönüyor ve test alakasız
   * yerde patlıyordu (2026-08-22 tanı koşumu: 12 turda 2 kez).
   *
   * Yeni kural: API "0 satır" demedikçe boşluğa inanma. API ürün olduğunu
   * söylüyorsa satır boyanana kadar bekle; süre dolarsa SESSİZ GEÇME, hata fırlat.
   */
  private async waitForRendered(
    izle: { sonAdet: () => number | null },
    timeoutMs = 20_000,
  ) {
    const t0 = Date.now();
    const deadline = t0 + timeoutMs;
    /**
     * GERÇEKTEN BOŞ SEPET için tolerans penceresi. Sepet hiç oluşmamışsa uygulama
     * `items` içeren bir yanıt döndürmüyor — dinleyici `null` kalıyor. İlk sürüm
     * bu durumda 30 sn boşa bekliyordu ve "boş sepette ödeme butonu yok" testi
     * 45 sn'lik test limitini aşıp düştü (ölçüldü 2026-08-22). Bu yüzden API hiç
     * konuşmadıysa, kısa bir bekleyişten sonra ekrandaki boş duruma inanıyoruz.
     */
    const SESSIZ_API_TOLERANSI = 5000;
    let reloads = 0;
    let sonRows = 0;
    while (Date.now() < deadline) {
      sonRows = await this.removeButtons.count();
      const apiAdet = izle.sonAdet();
      const body = await this.page.locator("body").innerText().catch(() => "");
      const bos = /Sepetiniz boş/i.test(body);

      if (sonRows > 0 && /Ara toplam/i.test(body)) return; // satırlar + özet hazır
      if (apiAdet === 0 && bos) return; // API de boş diyor → kesin
      if (apiAdet === null && bos && Date.now() - t0 > SESSIZ_API_TOLERANSI) return; // sepet hiç yok

      // API ürün var diyor ama ekran boş: bekle, gerekirse bir kez yenile
      if (sonRows === 0 && (apiAdet ?? 0) > 0 && reloads < 1 && Date.now() - t0 > 10_000) {
        reloads++;
        await this.page.reload({ waitUntil: "domcontentloaded" });
        await this.settle(3000);
        continue;
      }
      await this.page.waitForTimeout(600);
    }

    const apiAdet = izle.sonAdet();
    if (sonRows === 0 && (apiAdet ?? 0) > 0) {
      throw new Error(
        `Sepet API'si ${apiAdet} satır bildiriyor ama sayfa ${timeoutMs / 1000} sn içinde ` +
          `hiç satır boyamadı. Bu gerçek bir ürün hatası olabilir — sessizce "boş sepet" ` +
          `sayılmadı.`,
      );
    }
  }

  async isEmpty(): Promise<boolean> {
    return (await this.removeButtons.count()) === 0;
  }

  async lineCount(): Promise<number> {
    return this.removeButtons.count();
  }

  async headerItemCount(): Promise<number | null> {
    const body = await this.page.locator("body").innerText();
    const m = body.match(/(\d+)\s*ürün/);
    return m ? Number(m[1]) : null;
  }

  /**
   * Etiketin hemen altındaki ₺ değerini okur (sipariş özeti satırları).
   *
   * POLL EDİYOR, tek sefer okumuyor. Uygulama sepet özetini basket yenilemesinde
   * yeniden MOUNT ediyor: "Ara toplam"/"Toplam" satırı bir an DOM'dan çıkıyor.
   * Tek seferlik `innerText` tam o ana denk gelirse null dönüyor ve test alakasız
   * bir yerde patlıyor. Ölçüldü 2026-08-22: 5 tam koşumda 4 farklı test bu yüzden
   * düştü ("ara toplam okunamadı", "ödeme tutarı sepet toplamıyla uyuşmuyor" —
   * beklenen null, gelen doğru tutar).
   */
  private async moneyNear(label: RegExp, timeoutMs = 10_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const lines = (await this.page.locator("body").innerText().catch(() => ""))
        .split("\n")
        .map((s) => s.trim());
      const idx = lines.findIndex((l) => label.test(l));
      if (idx > -1) {
        for (let i = idx; i < Math.min(idx + 3, lines.length); i++) {
          // BasePage.moneyIn: ₺ hem önde hem arkada olabilir ("4.000,00 ₺")
          const v = BasePage.moneyIn(lines[i]);
          if (v !== null) return v;
        }
      }
      await this.page.waitForTimeout(400);
    }
    return null;
  }

  subtotal = () => this.moneyNear(/Ara toplam/);
  shipping = () => this.moneyNear(/Teslimat ve Kurulum/);
  total = () => this.moneyNear(/^Toplam$/);

  /**
   * İlk satırın adet göstergesi.
   *
   * Adet, azalt/artır butonlarının ARASINDA duran çıplak bir text node:
   *   button "Adet azalt" · text "1" · button "Artır"
   * Eskiden `xpath=../..` ile satır konteynerinden okunuyordu; DOM değişince o
   * konteynere birim fiyat da girdi ve regex adet yerine fiyatın ilk hanesini
   * ya da hiçbir şeyi yakaladı (ölçüm 2026-08-24: `adet=null`, 3 test kırdı).
   *
   * Bu yüzden konteyner tahmin etmek yerine artır butonundan geriye doğru ilk
   * dolu kardeş düğüm okunuyor — satır düzeni değişse de adet burada kalır.
   */
  async firstLineQuantity(): Promise<number | null> {
    const raw = await this.increaseButtons
      .first()
      .evaluate((el) => {
        for (let n = el.previousSibling; n; n = n.previousSibling) {
          const t = (n.textContent ?? "").trim();
          if (t) return t;
        }
        return "";
      })
      .catch(() => "");
    const m = raw.match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  async increaseFirstLine() {
    await this.increaseButtons.first().click({ timeout: 15_000 });
    await this.page.waitForTimeout(3500);
  }

  /**
   * Adet artırır ve varsa KAYBOLAN TOAST mesajını poll ederek yakalar.
   *
   * Ölçüm 2026-08-22: satın alma limiti dolu üründe (deneme, max 1) API
   * `PUT /v1/baskets/<id>` → 406 dönüyor ve "Bu üründen en fazla 1 adet
   * ekleyebilirsiniz." mesajı çıkıp kayboluyor. Sabit bekleyip gövdeye bakan
   * test mesajı KAÇIRIR — 2026-08-21 denetimi bu yüzden "sessiz hata" sandı.
   */
  async increaseAndCatchMessage(pattern: RegExp, timeoutMs = 10_000): Promise<string | null> {
    await this.increaseButtons.first().click({ timeout: 15_000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.page.locator("body").innerText().catch(() => "");
      const hit = body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => pattern.test(l));
      if (hit) return hit;
      await this.page.waitForTimeout(250);
    }
    return null;
  }

  async decreaseFirstLine() {
    await this.decreaseButtons.first().click({ timeout: 15_000 });
    await this.page.waitForTimeout(3500);
  }

  /**
   * Yıkıcı işlem: seçici satır index'ine kilitli, global .last() KULLANILMAZ.
   * Silmeden önce satır sayısını assert eder (liste yeniden render olursa yanlış
   * ürünü silme riski gerçek).
   */
  async removeLineByIndex(index: number): Promise<{ before: number; after: number }> {
    const before = await this.lineCount();
    expect(index, `sepette ${before} satır var, index ${index} geçersiz`).toBeLessThan(before);
    await this.removeButtons.nth(index).click({ timeout: 15_000 });
    await this.page.waitForTimeout(4000);
    await this.dismissOverlays();
    return { before, after: await this.lineCount() };
  }

  /**
   * Test hijyeni: sepeti tamamen boşalt (afterEach/teardown).
   *
   * Boşaldığını API'den doğrular. ESKİ HALİ yalnızca "görünür kaldır butonu
   * kalmadı"a bakıyordu; sayfa geçici olarak boş render ettiğinde döngü hemen
   * çıkıyor ve sepette ÜRÜN KALIYORDU — sonraki test "sepette zaten 1 ürün var"
   * diye patlıyordu (ölçüldü 2026-08-21/22).
   */
  async clear() {
    const izle = this.watchBasket();
    try {
      for (let i = 0; i < 15; i++) {
        const n = await this.removeButtons.count();
        if (n === 0) {
          /*
           * Görünür kaldır butonu kalmadı. API "0" veya "hiç sepet yok" diyorsa
           * bitti; API hâlâ ürün bildiriyorsa ekran geride kalmış olabilir —
           * kısa bir doğrulama penceresiyle tekrar bak.
           */
          const apiAdet = izle.sonAdet();
          if (apiAdet === 0 || apiAdet === null) break;
          await this.page.waitForTimeout(1200);
          if ((await this.removeButtons.count()) === 0) break;
          continue;
        }
        await this.removeButtons.first().click({ timeout: 15_000 }).catch(() => {});
        await this.page.waitForTimeout(3000);
        await this.dismissOverlays();
      }
    } finally {
      izle.kapat();
    }
  }

  async proceedToCheckout() {
    await expect(this.checkoutButton).toBeVisible({ timeout: 20_000 });
    await this.checkoutButton.click({ timeout: 15_000 });
    await this.settle(3000);
  }
}
