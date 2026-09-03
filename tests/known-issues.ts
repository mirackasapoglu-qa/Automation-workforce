/**
 * BİLİNEN ÜRÜN HATALARI — 2026-08-18 ilk regresyon taramasında bulundu.
 *
 * Kullanım deseni: bu hataları doğrulayan testler `test.fail()` ile işaretlenir.
 * Playwright bu testin BAŞARISIZ olmasını bekler:
 *   - hata sürüyorsa → test "beklenen şekilde başarısız", suite YEŞİL kalır
 *   - hata düzeldiyse → "beklenmedik şekilde geçti" → suite KIRMIZI olur ve
 *     bu dosyadan kaydı silmeye zorlar.
 * Böylece bilinen hatalar ne gürültü yapar ne de sessizce unutulur.
 *
 * ⚠️ `nodeId` alanı Flowscope'un kapsam ağacındaki (panel-data/scope/tree.json,
 * GITIGNORE'DA — bu dosya git'e girmez) bir düğüme işaret eder; drawer'da
 * "Bilinen hata" uyarısı göstermek için kullanılır (bkz. panel/server.mjs →
 * knownIssues(), panel/public/scope/js/drawer.js). Bu ID'ler panelin ilk
 * açılışında `panel/scope.mjs → seedFromProfile()`'ın ürettiği sıralı `n1,n2,…`
 * kimlikleridir — profildeki (`panel/projects/homee.mjs → routes.rules`) sıra
 * DEĞİŞMEDİĞİ sürece her klonda aynı çıkar. Sıra değişirse ya da ağaç elle
 * düzenlenip düğümler taşınırsa eşleşme sessizce kaybolur (uyarı sadece
 * GÖRÜNMEZ olur, hiçbir şey patlamaz) — panelde `/scope` açıp ilgili sayfanın
 * gerçek id'sini kontrol ederek düzeltilebilir.
 */

export const KNOWN_ISSUES = {
  /** Ürün detay sayfasında JS hatası: "parameters is not iterable" */
  productDetailConsoleError: {
    id: "HOMEE-001",
    nodeId: "n1", // Flowscope: Homee > 05 Ürün detay
    where: "SAP test ürünleri (varyantsız PDP): /tepe-sap-test-yeni-urun-p-1099765, /test-deneme-urun-test1-p-1099766",
    detail:
      'pageerror: "parameters is not iterable" — 2026-08-20 denetimi: 2 SAP test PDP\'sinde 3/3 koşumda çıkıyor, varyantlı /anchor-… PDP\'sinde ÇIKMIYOR',
  },
  /**
   * /magazalar sayfasında kırık görsel (test CDN).
   * ⚠️ ARALIKLI — bazı koşumlarda görsel yükleniyor. test.fail() ile işaretlenmez;
   * 08-static-pages testi doğrudan assert eder.
   */
  storesBrokenImage: {
    id: "HOMEE-002",
    nodeId: "n6", // Flowscope: Homee > 07 Mağazalar
    where: "/magazalar",
    detail:
      "storage.googleapis.com/tepehome-test-cdn/uploads/images/images/1009341-2.jpg yüklenemiyor",
  },
  /** İletişim formu boş gönderimde HİÇBİR geri bildirim vermiyor */
  contactFormNoValidation: {
    id: "HOMEE-003",
    nodeId: "n12", // Flowscope: Homee > 09 Formlar
    where: "/iletisim",
    detail:
      "Boş form GÖNDER'e basıldığında ne validasyon ne hata ne başarı mesajı çıkıyor; form sessizce hiçbir şey yapmıyor",
  },
  /**
   * Ödeme sayfasında sözleşme metinleri yüklenemiyor.
   * ⚠️ ARALIKLI — bazı koşumlarda yükleniyor; test.fail() ile işaretlenmez.
   */
  checkoutContractsNotLoading: {
    id: "HOMEE-004",
    nodeId: "n5", // Flowscope: Homee > 25 Ödeme adımı
    /**
     * ⚠️ MAC-7268 2026-08-22'de "Tamam"a taşındı (Sinem Baysel), ama hata ARALIKLI:
     * son 8 ölçülebilir koşumun 1'inde tekrarladı. Kartın kapanması testin
     * susturulması anlamına GELMEZ — assertion duruyor, tekrar ederse suite
     * kırmızı olur ve kartın yeniden açılması gerekir.
     */
    jira: "MAC-7268",
    where: "/odeme",
    detail:
      '"Mesafeli satış sözleşmesi yüklenemedi." + "Ön bilgilendirme formu yüklenemedi."',
  },
  /**
   * Arama sonuçlarının TAMAMI prod domain'ine link veriyor.
   * Ölçüm (2026-08-18): /arama?q=koltuk → 50/50 link, scroll sonrası 100/100 link
   * Ölçüm (2026-08-20): tam scroll sonrası 350/350 link (%100), site içi link 0
   * https://prod.tepehome.com.tr/...?recommended_by=full_search
   * Sonuçsuz aramada da 8 öneri kartı aynı şekilde prod'a gidiyor.
   */
  searchResultsLinkToProd: {
    id: "HOMEE-005",
    nodeId: "n3", // Flowscope: Homee > 04 Arama
    where: "/arama?q=<herhangi>",
    detail:
      "Arama sonuc kartlarinin tamami https://prod.tepehome.com.tr/... adresine link veriyor (PersonaClick full_search); kullanici test ortamindan canli siteye cikiyor. 2026-08-20: tam scroll sonrasi 350/350 kart, site ici link 0",
  },
  /**
   * Arama alaka sorunu.
   * ⚠️ ARALIKLI — PersonaClick kişiselleştirmesi; test.fail() ile işaretlenmez.
   */
  searchRelevance: {
    id: "HOMEE-006",
    nodeId: "n3", // Flowscope: Homee > 04 Arama
    where: "/arama?q=koltuk",
    detail:
      "koltuk aramasi 768 sonuc bildiriyor ama ilk sonuclar kolonya (the-tonka-ve-myrrh-kolonya) donuyor",
  },
  /**
   * Ürün detay sayfasında öneri kartlarının görselleri kırık geliyor
   * (prod CDN: storage.googleapis.com/tepehome-cdn/product/...).
   * ⚠️ ARALIKLI — CDN kaynaklı; test.fail() ile işaretlenmez.
   */
  productImagesBroken: {
    id: "HOMEE-007",
    nodeId: "n1", // Flowscope: Homee > 05 Ürün detay
    where: "/tepe-sap-test-yeni-urun-p-1099765 (oneri kartlari)",
    detail:
      "5 gorsel naturalWidth=0 donuyor, ornek: tepehome-cdn/product/41/images/1001728-1_400x400.jpg",
  },
  /**
   * Varyantlı ürün detayında null'dan URL kuruluyor: GET /null?v=0.2 → 404.
   * Ölçüm (2026-08-20): 3/3 koşumda deterministik. SAP test ürünlerinde YOK,
   * yalnızca varyantlı üründe — muhtemelen varyant/renk asset'i.
   */
  pdpNullAssetRequest: {
    id: "HOMEE-009",
    nodeId: "n1", // Flowscope: Homee > 05 Ürün detay
    where: "/anchor-kare-orta-sehpa-p-anc03sh756t763 (varyantlı ürün detay)",
    detail:
      "Sayfa https://redesign-prod.test.tepehome.com.tr/null?v=0.2 istegi atiyor ve 404 aliyor; URL null bir degerden kuruluyor",
  },
  /**
   * Sonuçsuz aramada JS crash.
   * Ölçüm (2026-08-20): 3/3 koşumda deterministik. HOMEE-006 (alaka sorunu) ile
   * ilgisi yok — bu ayrı bir çalışma zamanı hatası.
   */
  emptySearchPageError: {
    id: "HOMEE-010",
    nodeId: "n3", // Flowscope: Homee > 04 Arama
    where: "/arama?q=<sonucsuz>",
    detail:
      "pageerror: \"Cannot read properties of null (reading 'getBoundingClientRect')\" — HOMEE-006'dan bagimsiz",
  },
  /**
   * Havale/EFT açıklama bloğunda üç ayrı hata (ölçüm 2026-08-22, /odeme).
   *  1) BOŞ DEĞER: "Havelenizi yaparken gönderen bölümünde mutlaka "" adını
   *     kullanınız." — isim gelmesi gereken yer boş çift tırnak olarak basılıyor,
   *     yani kullanıcıya hangi adı yazacağı söylenmiyor.
   *  2) YAZIM: "Havelenizi" → "Havalenizi".
   *  3) OLMAYAN ARAYÜZ: "Aşağıdaki menüden ... banka IBAN numarasını seçip
   *     'Siparişi Tamamla' tuşuna basınız" deniyor; sayfada seçilebilir banka
   *     menüsü YOK (select 0, combobox/listbox 0 — ölçüldü) ve butonun adı
   *     "ÖDEME YAP".
   */
  transferCopyMismatch: {
    id: "HOMEE-011",
    nodeId: "n5", // Flowscope: Homee > 25 Ödeme adımı
    jira: "MAC-7303",
    where: "/odeme → HAVALE / EFT",
    detail:
      "Havale aciklama blogunda 3 hata: (1) gonderen adi bos cift tirnak olarak basiliyor, (2) 'Havelenizi' yazim hatasi, (3) metin var olmayan banka secim menusune ve 'Siparisi Tamamla' butonuna yonlendiriyor (gercek buton: ODEME YAP)",
  },
  /**
   * Sepet sayfası, basket yanıtı items>0 döndükten SONRA da bir süre boş durumu
   * gösteriyor (badge 0 + "Sepetiniz boş"); satır navigasyon olmadan, kendiliğinden
   * geliyor. Ölçüm 2026-08-22: 12 turun 2'sinde (~%17), ~15 sn içinde toparladı.
   * Veri kaybı YOK. Suite bu yüzden boşluk kararını API'ye soruyor (CartPage).
   */
  cartEmptyStateRace: {
    id: "HOMEE-012",
    nodeId: "n4", // Flowscope: Homee > 06 Sepet
    jira: "MAC-7304",
    where: "/sepet",
    detail:
      "Basket API items:1 dondukten sonra da sayfa bir sure 'Sepetiniz bos' gosteriyor ve badge 0 okuyor; satir navigasyon olmadan sonradan geliyor (12 turda 2)",
  },
} as const;
