import { Page, Locator, expect } from "@playwright/test";

/**
 * Homee'ye özgü iki tuzak bu sınıfta çözülür:
 *
 * 1) TÜRKÇE 'İ' + regex /i FLAG'İ ÇALIŞMAZ.
 *    JS'de /KATEGORİLER/i, aria-label="Kategoriler" ile EŞLEŞMEZ (U+0130 case-fold edilmez).
 *    Bu yüzden Türkçe metinlerde TAM STRING kullanıyoruz, /i regex'i değil.
 *
 * 2) HEADER'IN GÖRÜNMEZ İKİZİ VAR.
 *    Her header butonu/linki DOM'da iki kez var (sticky + normal varyant); biri hep
 *    display:none. `.first()` görünmez olanı yakalayıp click timeout'una düşer.
 *    Çözüm: her seçicide `:visible` kullan.
 */
export class BasePage {
  readonly page: Page;

  // Header — hepsi aria-label ile, :visible filtreli
  readonly categoriesButton: Locator;
  readonly searchButton: Locator;
  readonly cartButton: Locator;
  readonly loginLink: Locator;
  readonly favoritesLink: Locator;
  readonly storesLink: Locator;
  readonly logo: Locator;
  readonly searchInput: Locator;
  readonly mainNavLinks: Locator;

  // Footer
  readonly newsletterInput: Locator;
  readonly newsletterSubmit: Locator;
  readonly backToTop: Locator;

  constructor(page: Page) {
    this.page = page;
    this.categoriesButton = page.locator('button[aria-label="Kategoriler"]:visible').first();
    this.searchButton = page.locator('button[aria-label="Ara"]:visible').first();
    this.cartButton = page.locator('button[aria-label="Sepet"]:visible').first();
    this.loginLink = page.locator('a[aria-label="Giriş yap"]:visible').first();
    this.favoritesLink = page.locator('a[aria-label="Favorilerim"]:visible').first();
    this.storesLink = page.locator('a[aria-label="Mağazalar"]:visible').first();
    this.logo = page.locator('a[aria-label="Tepe Home ana sayfa"]:visible').first();
    // Placeholder: "Kategori veya ürün ara" — CSS attribute eşleşmesi
    // büyük/küçük harf duyarlı, bu yüzden [i] flag'i şart
    this.searchInput = page
      .locator(
        'input[placeholder="Kategori veya ürün ara"]:visible, input[placeholder*="ara" i]:visible, input[type="search"]:visible',
      )
      .first();
    this.mainNavLinks = page.locator("header a:visible");
    this.newsletterInput = page.locator('footer input[type="email"]:visible').first();
    this.newsletterSubmit = page.locator("footer button:visible", { hasText: "ABONE OL" }).first();
    this.backToTop = page.locator('button[aria-label="Sayfanın başına dön"]:visible').first();
  }

  /**
   * Client-render tamamlanana kadar bekle. Sabit uzun bekleme yerine gerçek sinyal:
   * footer her sayfada var → footer görününce sayfa boyanmış demektir.
   */
  async settle(extra = 600) {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator("footer")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 })
      .catch(() => {});
    await this.page.waitForTimeout(extra);
    await this.dismissOverlays();
  }

  /**
   * Gecikmeli açılan kampanya/öneri modal'larını kapatır; yoksa sessizce geçer.
   *
   * ⚠️ Adres formu gibi drawer'ların BACKDROP'u da `button[aria-label="Kapat"]`
   * (`class="absolute inset-0 bg-black/40"`). Ona basmak açık formu kapatır —
   * bu yüzden `inset-0` sınıfı taşıyan kapatıcılar HARİÇ tutulur.
   */
  async dismissOverlays() {
    const closers = [
      'button[aria-label="Kapat"]:not([class*="inset-0"]):visible',
      'button[aria-label="Close"]:not([class*="inset-0"]):visible',
      'button:visible:has-text("KAPAT")',
    ];
    for (const sel of closers) {
      const loc = this.page.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 2); i++) {
        await loc.nth(i).click({ timeout: 2000 }).catch(() => {});
      }
    }
  }

  /**
   * Homee'de ürün karuselleri ve alt bölümler LAZY yükleniyor — scroll etmeden
   * DOM'a girmiyorlar. Kart sayan her test bunu önce çağırmalı.
   */
  async loadLazyContent(steps = 5) {
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, 1400);
      await this.page.waitForTimeout(600);
    }
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
  }

  /**
   * Test ortamından PROD domain'ine giden linkleri döner.
   * (PersonaClick önerileri prod.tepehome.com.tr'ye link veriyor — bilinen sorun.)
   */
  async externalProdLinks(): Promise<string[]> {
    return this.page.$$eval("a[href]", (as) =>
      [
        ...new Set(
          as
            .map((a) => a.getAttribute("href") ?? "")
            .filter((h) => /^https?:\/\//.test(h))
            .filter((h) => /\/\/prod\.tepehome\.com\.tr/.test(h)),
        ),
      ].slice(0, 20),
    );
  }

  async goto(path: string) {
    await this.page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.settle();
  }

  /** Homee 404'te de HTTP 200 dönebiliyor — içerikten anlamak zorunlu. */
  async isNotFound(): Promise<boolean> {
    return this.page
      .getByText("Sayfa Bulunamadı", { exact: true })
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);
  }

  async assertNotNotFound() {
    expect(await this.isNotFound(), `${this.page.url()} → "Sayfa Bulunamadı" döndü`).toBe(false);
  }

  async openSearch() {
    if (!(await this.searchInput.isVisible({ timeout: 1200 }).catch(() => false))) {
      await this.searchButton.click({ timeout: 12_000 });
      await this.searchInput.waitFor({ state: "visible", timeout: 12_000 });
    }
  }

  async search(term: string) {
    await this.openSearch();
    await this.searchInput.fill(term);
    await this.searchInput.press("Enter");
    await this.settle(2500);
  }

  /** Header sepet butonundaki adet badge'i; yoksa null. */
  async cartBadgeCount(): Promise<number | null> {
    const txt = await this.cartButton.innerText({ timeout: 3000 }).catch(() => "");
    const m = txt.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  async openCart() {
    await this.cartButton.click({ timeout: 12_000 });
    await this.settle(2000);
  }

  static collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
    return errors;
  }

  /** 3P script gürültüsünü ayıklar (personaclick, analytics, pixel...). */
  static appErrorsOnly(errors: string[]): string[] {
    return errors.filter(
      (e) =>
        !/personaclick|gtag|google|analytics|facebook|hotjar|favicon|clarity|mobildev|ERR_BLOCKED|ERR_CONNECTION|Failed to load resource/i.test(
          e,
        ),
    );
  }
}
