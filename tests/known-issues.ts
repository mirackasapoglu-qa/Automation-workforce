/**
 * BİLİNEN ÜRÜN HATALARI — 2026-08-18 ilk regresyon taramasında bulundu.
 *
 * Kullanım deseni: bu hataları doğrulayan testler `test.fail()` ile işaretlenir.
 * Playwright bu testin BAŞARISIZ olmasını bekler:
 *   - hata sürüyorsa → test "beklenen şekilde başarısız", suite YEŞİL kalır
 *   - hata düzeldiyse → "beklenmedik şekilde geçti" → suite KIRMIZI olur ve
 *     bu dosyadan kaydı silmeye zorlar.
 * Böylece bilinen hatalar ne gürültü yapar ne de sessizce unutulur.
 */

export const KNOWN_ISSUES = {
  /** Ürün detay sayfasında JS hatası: "parameters is not iterable" */
  productDetailConsoleError: {
    id: "HOMEE-001",
    where: "/tepe-sap-test-yeni-urun-p-1099765 (ürün detay)",
    detail: 'pageerror: "parameters is not iterable"',
  },
  /** /magazalar sayfasında kırık görsel (test CDN) */
  storesBrokenImage: {
    id: "HOMEE-002",
    where: "/magazalar",
    detail:
      "storage.googleapis.com/tepehome-test-cdn/uploads/images/images/1009341-2.jpg yüklenemiyor",
  },
  /** İletişim formu boş gönderimde HİÇBİR geri bildirim vermiyor */
  contactFormNoValidation: {
    id: "HOMEE-003",
    where: "/iletisim",
    detail:
      "Boş form GÖNDER'e basıldığında ne validasyon ne hata ne başarı mesajı çıkıyor; form sessizce hiçbir şey yapmıyor",
  },
  /** Ödeme sayfasında sözleşme metinleri yüklenemiyor */
  checkoutContractsNotLoading: {
    id: "HOMEE-004",
    where: "/odeme",
    detail:
      '"Mesafeli satış sözleşmesi yüklenemedi." + "Ön bilgilendirme formu yüklenemedi."',
  },
  /**
   * Arama sonuçlarının TAMAMI prod domain'ine link veriyor.
   * Ölçüm (2026-08-18): /arama?q=koltuk → 50/50 link, scroll sonrası 100/100 link
   * https://prod.tepehome.com.tr/...?recommended_by=full_search
   * Sonuçsuz aramada da 8 öneri kartı aynı şekilde prod'a gidiyor.
   */
  searchResultsLinkToProd: {
    id: "HOMEE-005",
    where: "/arama?q=<herhangi>",
    detail:
      "Arama sonuc kartlarinin tamami https://prod.tepehome.com.tr/... adresine link veriyor (PersonaClick full_search); kullanici test ortamindan canli siteye cikiyor",
  },
  /** Arama alaka sorunu */
  searchRelevance: {
    id: "HOMEE-006",
    where: "/arama?q=koltuk",
    detail:
      "koltuk aramasi 768 sonuc bildiriyor ama ilk sonuclar kolonya (the-tonka-ve-myrrh-kolonya) donuyor",
  },
} as const;
