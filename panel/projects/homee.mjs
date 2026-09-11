/**
 * Proje profili: Homee (Tepe Home redesign).
 *
 * Panel çekirdeğinde (panel/*.mjs) proje adı, Jira anahtarı, Figma dosyası ya da
 * rota bilgisi GEÇMEZ — hepsi bu dosyada toplanır. Paneli başka bir projeye
 * taşımak = bu dizine ikinci bir profil koymak. Çekirdek profili
 * `panel/project.mjs` üzerinden okur.
 *
 * Değişmezi `npm run panel:check` doğrular: çekirdekte proje referansı kalırsa kırar.
 */

/** Panel başlığı ve localStorage/log ayrımı için kimlik. */
export const id = "homee";
export const title = "Homee QA Paneli";
/** Test edilen ürünün adı (panelin adı değil) — kapsam ağacının kök düğümü. */
export const product = "Homee";

/**
 * Ortam değişkeni adları. Suite ve `.env` bu adları kullanıyor; çekirdek
 * bunları profilden okur, kendi içinde sabit ad taşımaz.
 */
export const env = {
  /** Aktif ortamı seçen değişken. */
  var: "HOMEE_ENV",
  default: "test",
  /**
   * ⚠️ Gerçek sipariş açan koşumların guard'ı. Panel bunu yalnızca OKUR ve
   * gösterir; guard'ın kendisi suite tarafında (`26-order-transfer.spec.ts`).
   * Adını burada değiştirmek guard'ı bozar.
   */
  ordersVar: "ALLOW_HOMEE_ORDERS",
};

/**
 * Kanıt/dayanak kodu önekleri. Sırası önemli değil; case envanterinde ve
 * senaryo öneride hangi kodların "dayanak" sayıldığını belirler.
 *  - HOMEE-00X → repo içi bilinen ürün hatası (`tests/known-issues.ts`)
 *  - MAC-0000  → Jira kartı
 */
/**
 * Hangi yeteneği hangi servis karşılıyor.
 *
 * Panel çekirdeği "Jira" demez, "tracker" der (bkz. panel/connectors/index.mjs).
 * Bu proje Jira kullanıyor; Linear'a geçmek için tek satır: tracker: "linear".
 * `null` bırakılan yetenek kapalıdır — connector listesinde "kullanılmıyor"
 * görünür ve panelin genel durumunu etkilemez.
 */
export const connectors = {
  tracker: "jira",
  design: "figma",
  ai: "claude-code",
  device: "mobai",
  chat: null, // Slack bildirimi henüz yok
};

/**
 * Oturumun kimlik cookie'si. Kasa oturum sağlığını YALNIZCA buna bakarak
 * ölçer; verilmezse "dolmuşları yok say" sezgisine düşer (bkz. sessions.mjs).
 * Bu ortamda "Geçici Erişim" kapısı bu cookie'yi veriyor, ömrü ~24 saat.
 */
export const authCookies = ["temporary_auth_verified"];

export const issuePrefixes = ["HOMEE", "MAC"];

/** `tests/known-issues.ts` içindeki id öneki (senaryo önericinin oracle kaynağı). */
export const knownIssuePrefix = "HOMEE";

/** Sitenin kendi API host'u — perf ölçümünde "bizim API'miz 4xx/5xx döndü" filtresi. */
export const apiHostMatch = "tepehome";

/**
 * Jira: machinarium.atlassian.net / MAC projesi / `MAC-7035 Tepe - Redesign` epic'i.
 *
 * ⚠️ Bu Jira TÜRKÇE. Hata tipinin adı "Hata", id'si 10009. OLUŞTURMA ile
 * SORGULAMA farklı ad ister:
 *   - POST /issue  → issuetype: { id: "10009" }   ("Bug" adı REDDEDİLİR)
 *   - JQL          → issuetype = Bug              (Hata → 0 sonuç)
 * Bu yüzden id kullanılıyor; ada güvenmek iki yönden de kırılgan.
 *
 * customfield_10072 ("Project") ZORUNLU bir select; değerimiz TEPEHOME (10136).
 * Verilmezse oluşturma 400 "Project: Project gerekiyor." ile düşer.
 */
export const jira = {
  host: "https://machinarium.atlassian.net",
  project: "MAC",
  epic: "MAC-7035",
  bugTypeId: "10009",
  projectFieldId: "customfield_10072",
  projectFieldValueId: "10136",
  /** Sprint alanı — kart listesinde ve detayında gösterilir. */
  sprintFieldId: "customfield_10020",
  /**
   * Statü geçiş id'leri bu projede ortak (bilgi amaçlı; kod her zaman
   * `/transitions`'ı okuyup ada göre eşler, id'ye güvenmez):
   * 11 Yapılacaklar · 21 Devam Ediyor · 31 Tamam · 41 Test · 51 Ready For Deploy ·
   * 61 Ready For Release · 71 Blocked · 81 Failed · 91 Test Blocked ·
   * 5 Move to Release for Stage
   *
   * Kart açarken isim kalıbı ekibin biçimine uyar:
   * "TEPE - Redesign > <Alan> > <problem>"
   *
   * ⚠️ Sabit "views" listesi KALDIRILDI (2026-09-11) — bkz. CLAUDE.md → "Jira:
   * Sorter". Panel artık tek sabit sorter'ı (Tümü) bağlı projeden kendisi
   * türetiyor; profilde statik bir görünüm tanımına gerek/yer yok.
   */
};

/**
 * Rota → Figma frame eşlemesi.
 *
 * node id'leri Jira kart açıklamalarındaki Figma linklerinden çıkarıldı
 * (MAC-7035 epic'i, 15 kart). Dosya: Tepe Home UI/UX Design.
 *
 * `frameId` doldurulmuşsa render için düğüm ağacı çağrısı YAPILMAZ — doğrudan
 * `/v1/images` istenir. İlk beşi Figma MCP `get_metadata` ile çözüldü (2026-08-20),
 * kalan beşi `figma-prewarm.mjs`in sığ dosya ağacından (2026-08-24, Dev seat).
 *
 * Burada kalıcı tutulmalarının sebebi ağ çağrısını tamamen atlamak: hepsi doluysa
 * prewarm 1. adımı (sığ dosya ağacı, 719 KB) hiç yapmaz.
 */
export const figma = {
  file: "WRyAE2K87JyYZHJlH18OfD",
  routes: [
    { test: (p) => p === "/" , node: "140:2705", frame: "Home", frameId: "355:8323", w: 1440, h: 5681, page: "Main Page", cards: ["MAC-7037", "MAC-7040"] },
    { test: (p) => /-p-[^/]+$/.test(p), node: "539:9969", frame: "Product Detail Page", frameId: "539:10109", w: 1440, h: 6518, page: "Product Detail Page_PDP", cards: ["MAC-7073"],
      alts: [{ id: "1193:43734", name: "Product Detail Page_Modüler", w: 1440, h: 6366 }, { id: "820:6855", name: "Product Detail Page", w: 1440, h: 5841 }] },
    { test: (p) => p.startsWith("/tum-urunler") || ["/mutfak","/bahce","/banyo","/yeni-urunler"].includes(p), node: "449:25502", frame: "Product Listing Page", frameId: "465:28973", w: 1440, h: 3298, page: "Product Listing Page_PLP", cards: ["MAC-7039", "MAC-7072"],
      alts: [{ id: "904:42146", name: "Product Listing Page_SM", w: 1440, h: 3127 }, { id: "1172:36450", name: "Kategori Landing — Desktop Web", w: 1440, h: 5091 }, { id: "1172:36548", name: "Arama Sonuçları - Desktop Web", w: 1440, h: 3238 }] },
    { test: (p) => p === "/sepet", node: "684:43086", frame: "My Cart — Desktop Web", frameId: "684:43397", w: 1440, h: 2060, page: "My Cart", cards: ["MAC-7074"] },
    // `auth: "member"` → diff canlı tarafı ÜYE oturumuyla açar. Olmadan bu iki
    // rota /giris'e yönlenir ve sayfanın tüm metinleri "canlıda yok" raporlanır
    // (29 uydurma bulgu, 2026-08-24). Guard `figma-diff.mjs`te: login'e düşerse durur.
    { test: (p) => p === "/odeme", node: "630:187", frame: "Checkout — Desktop Web", frameId: "619:8332", w: 1440, h: 1968, page: "Checkout", cards: ["MAC-7075"], auth: "member" },
    { test: (p) => p.startsWith("/hesabim"), node: "1013:192", frame: "Hesabım — Desktop Web", frameId: "1015:192", w: 1440, h: 1132, page: "Hesap", cards: ["MAC-7077"], auth: "member" },
    { test: (p) => p === "/magazalar", node: "1082:192", frame: "Mağazalar — Desktop Web", frameId: "1082:193", w: 1440, h: 1263, page: "Mağazalar", cards: ["MAC-7078"] },
    { test: (p) => p === "/iletisim" || p === "/hakkimizda", node: "1103:2391", frame: "İletişim — Desktop Web", frameId: "1103:2391", w: 1440, h: 1138, page: "Hakkımızda / İletişim", cards: ["MAC-7071", "MAC-7080"] },
    { test: (p) => p.startsWith("/blogs"), node: "1120:1520", frame: "Journal Listesi — Desktop Web", frameId: "1120:1520", w: 1440, h: 2688, page: "Bloglar", cards: ["MAC-7116"] },
    { test: (p) => p.startsWith("/giris") || p.startsWith("/kayit-ol"), node: "494:30265", frame: "Login_Mail", frameId: "494:30712", w: 1440, h: 1024, page: "Sign Up - Login", cards: ["MAC-7038", "MAC-7043"] },
  ],
};

/**
 * "Site (canlı)" sekmesindeki hızlı gidiş butonları. Panelde iframe'de açılan
 * rotalar; sıra ekranda göründüğü sıra.
 */
export const quickRoutes = [
  ["Anasayfa", "/"],
  ["Tum urunler", "/tum-urunler"],
  ["Urun", "/tepe-sap-test-yeni-urun-p-1099765"],
  ["Arama", "/arama?q=koltuk"],
  ["Sepet", "/sepet"],
  ["Giris", "/giris"],
  ["Hesabim", "/hesabim"],
  ["Magazalar", "/magazalar"],
  ["Iletisim", "/iletisim"],
];

/** Senaryo önericinin hazır istemleri — projenin zayıf noktalarına göre yazılır. */
export const scenarioPresets = [
  ["Zayıf spec'ler", "En az case içeren spec'leri güçlendiren senaryolar öner: 07-stores, 08-static-pages, 23-favorites."],
  ["Tasarım açıkları", "Figma tasarımıyla canlı arasındaki farkları kapatan senaryolar öner (mağazalar, ürün kartları, arama katmanı)."],
  ["Erişilebilirlik", "Dokunma hedefi, erişilebilir ad ve odak sırası sorunlarını yakalayan senaryolar öner."],
  ["Üye akışı", "Üye oturumundaki hesap ve sepet akışları için senaryolar öner; yıkıcı olmayan, mutasyonu geri alan."],
  ["Bilinen hatalar", "HOMEE-00X kayıtlarındaki bilinen hataları regresyon altına alan senaryolar öner."],
];

/**
 * Rota → koşum eşlemesi. `runId` değerleri panel/runs.json whitelist'indeki
 * id'ler olmalı — whitelist dışı komut çalışmaz.
 *
 * Jira kartları tests/jira-map.ts ile aynı bilgiyi taşır (orası kaynak; burada
 * hızlı erişim için tekrarlanır). jira-map.ts değişirse burayı da güncelle.
 */
export const routes = {
  rules: [
    { test: (p) => /-p-[^/]+$/.test(p), runId: "test-urun", label: "05 Ürün detay", specs: ["05-product-detail.spec.ts"], cards: ["MAC-7073"] },
    { test: (p) => p === "/" || p === "", runId: "test-anasayfa", label: "01 Anasayfa", specs: ["01-homepage.spec.ts"], cards: ["MAC-7037", "MAC-7040", "MAC-7041"] },
    { test: (p) => p.startsWith("/arama"), runId: "test-arama", label: "04 Arama", specs: ["04-search.spec.ts"], cards: ["MAC-7040"] },
    { test: (p) => p === "/sepet", runId: "test-sepet", label: "06 Sepet", specs: ["06-cart.spec.ts"], cards: ["MAC-7074"] },
    { test: (p) => p === "/odeme", runId: "test-odeme", label: "25 Ödeme adımı", specs: ["25-checkout-to-payment.spec.ts"], cards: ["MAC-7075"] },
    { test: (p) => p === "/magazalar", runId: "test-magaza", label: "07 Mağazalar", specs: ["07-stores.spec.ts"], cards: ["MAC-7078"] },
    { test: (p) => p.startsWith("/giris"), runId: "test-login", label: "20 Giriş", specs: ["20-login.spec.ts"], cards: ["MAC-7043"] },
    { test: (p) => p.startsWith("/hesabim/adreslerim"), runId: "test-adres", label: "22 Adres yönetimi", specs: ["22-addresses.spec.ts"], cards: ["MAC-7077"] },
    { test: (p) => p.startsWith("/hesabim/favorilerim"), runId: "test-favori", label: "23 Favoriler", specs: ["23-favorites.spec.ts"], cards: ["MAC-7077"] },
    { test: (p) => /^\/hesabim\/(siparislerim|iadelerim)/.test(p), runId: "test-siparis", label: "24 Siparişler/iadeler", specs: ["24-orders.spec.ts"], cards: ["MAC-7077"] },
    { test: (p) => p.startsWith("/hesabim"), runId: "test-hesabim", label: "21 Hesabım özeti", specs: ["21-account-overview.spec.ts"], cards: ["MAC-7077"] },
    { test: (p) => p === "/iletisim", runId: "test-form", label: "09 Formlar", specs: ["09-forms.spec.ts"], cards: ["MAC-7080"] },
    {
      test: (p) =>
        ["/blogs", "/hakkimizda", "/bilkent-holding", "/etik-politikamiz", "/insan-kaynaklari", "/kvkk-aydinlatma-metni", "/privacy", "/sikca-sorulan-sorular"].includes(p),
      runId: "test-statik",
      label: "08 Statik sayfalar",
      specs: ["08-static-pages.spec.ts"],
      cards: ["MAC-7071", "MAC-7079", "MAC-7116"],
    },
    // liste/kategori: en sonda, çünkü en geniş kural
    { test: (p) => p.startsWith("/tum-urunler") || ["/mutfak", "/bahce", "/banyo", "/yeni-urunler"].includes(p) || /^\/[^/]+\/[^/]+$/.test(p), runId: "test-liste", label: "03 Kategori/liste", specs: ["03-category-listing.spec.ts"], cards: ["MAC-7039", "MAC-7072"] },
  ],

  /** Spec dosyası → whitelist koşum id'si. */
  specRuns: {
    "01-homepage.spec.ts": "test-anasayfa",
    "02-navigation.spec.ts": "test-menu",
    "03-category-listing.spec.ts": "test-liste",
    "04-search.spec.ts": "test-arama",
    "05-product-detail.spec.ts": "test-urun",
    "06-cart.spec.ts": "test-sepet",
    "07-stores.spec.ts": "test-magaza",
    "08-static-pages.spec.ts": "test-statik",
    "09-forms.spec.ts": "test-form",
    "20-login.spec.ts": "test-login",
    "21-account-overview.spec.ts": "test-hesabim",
    "22-addresses.spec.ts": "test-adres",
    "23-favorites.spec.ts": "test-favori",
    "24-orders.spec.ts": "test-siparis",
    "25-checkout-to-payment.spec.ts": "test-odeme",
    /*
     * ⚠️ GERÇEK SİPARİŞ açan spec. Panelden tetiklenebilir olması güvenli:
     * `test-havale` koşumu `npm run test:havale` çağırıyor, sipariş guard'ı
     * (`env.ordersVar`) ise `.env`'de 0 — yani flag bilinçli olarak verilmedikçe
     * spec komple SKIP ediliyor. Kart detayında kapsamın görünmesi için eşleme
     * burada duruyor.
     */
    "26-order-transfer.spec.ts": "test-havale",
  },

  /** Jira kartı → spec'ler. Kaynak: tests/jira-map.ts (CARD_MAP). */
  cardSpecs: {
    "MAC-7037": ["01-homepage.spec.ts"],
    "MAC-7040": ["01-homepage.spec.ts", "02-navigation.spec.ts", "04-search.spec.ts"],
    "MAC-7041": ["01-homepage.spec.ts", "08-static-pages.spec.ts", "09-forms.spec.ts"],
    "MAC-7039": ["03-category-listing.spec.ts"],
    "MAC-7072": ["03-category-listing.spec.ts", "02-navigation.spec.ts"],
    "MAC-7073": ["05-product-detail.spec.ts"],
    "MAC-7074": ["06-cart.spec.ts"],
    "MAC-7075": ["25-checkout-to-payment.spec.ts"],
    "MAC-7077": [
      "21-account-overview.spec.ts",
      "22-addresses.spec.ts",
      "23-favorites.spec.ts",
      "24-orders.spec.ts",
    ],
    "MAC-7078": ["07-stores.spec.ts"],
    "MAC-7080": ["09-forms.spec.ts"],
    "MAC-7071": ["08-static-pages.spec.ts"],
    "MAC-7079": ["08-static-pages.spec.ts"],
    "MAC-7116": ["08-static-pages.spec.ts"],
    "MAC-7043": ["20-login.spec.ts"],
    "MAC-7038": [],
    "MAC-7053": [],
    "MAC-7036": [],
    // Havale ile sipariş tamamlama. ⚠️ Koşum GERÇEK SİPARİŞ açar; sipariş
    // guard'ı verilmedikçe skip eder (bkz. specRuns'taki not).
    "MAC-7076": ["26-order-transfer.spec.ts"],
  },
};
