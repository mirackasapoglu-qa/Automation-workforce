/**
 * Jira kartı ↔ test spec eşlemesi.
 *
 * Kaynak: machinarium.atlassian.net, MAC projesi, `MAC-7035 Tepe - Redesign` epic'i
 * (19 alt kart, 2026-08-18 itibarıyla).
 *
 * Panel bunu "bu kart hangi spec'lerle test edilir" göstermek ve verdict'i doğru
 * karta yazmak için kullanır. Yeni kart geldiğinde buraya ekle.
 */

export type JiraCardMapping = {
  key: string;
  title: string;
  /** Kartı doğrulayan spec dosyaları (tests/ altında) */
  specs: string[];
  /** Kapsam durumu */
  coverage: "full" | "partial" | "none";
  note?: string;
};

export const JIRA_EPIC = "MAC-7035";
export const JIRA_PROJECT = "MAC";
export const JIRA_HOST = "https://machinarium.atlassian.net";

export const CARD_MAP: JiraCardMapping[] = [
  {
    key: "MAC-7037",
    title: "Tepe - Main Page",
    specs: ["01-homepage.spec.ts"],
    coverage: "full",
  },
  {
    key: "MAC-7040",
    title: "Tepe - Header",
    specs: ["01-homepage.spec.ts", "02-navigation.spec.ts", "04-search.spec.ts"],
    coverage: "full",
    note: "Header öğeleri, mega menü, arama girişi, sepet butonu",
  },
  {
    key: "MAC-7041",
    title: "Tepe - Footer",
    specs: ["01-homepage.spec.ts", "08-static-pages.spec.ts", "09-forms.spec.ts"],
    coverage: "full",
    note: "Footer linkleri, bülten formu, başa dön",
  },
  {
    key: "MAC-7039",
    title: "Tepe - Product Listing Page_PLP",
    specs: ["03-category-listing.spec.ts"],
    coverage: "full",
  },
  {
    key: "MAC-7072",
    title: "Tepe - Product Listing Page (PLP) - Redesign",
    specs: ["03-category-listing.spec.ts", "02-navigation.spec.ts"],
    coverage: "partial",
    note: "5 kategori rotası '0 ürün' dönüyor — routes.ts LISTING_EMPTY",
  },
  {
    key: "MAC-7073",
    title: "Tepe - Product Detail Page (PDP) - Redesign",
    specs: ["05-product-detail.spec.ts"],
    coverage: "full",
    note: "HOMEE-001 (konsol hatası) ve HOMEE-007 (kırık öneri görselleri) bu kartta",
  },
  {
    key: "MAC-7074",
    title: "Tepe - Sepetim - Redesign",
    specs: ["06-cart.spec.ts"],
    coverage: "full",
  },
  {
    key: "MAC-7075",
    title: "Tepe - Checkout - Redesign",
    specs: ["25-checkout-to-payment.spec.ts"],
    coverage: "partial",
    note:
      "Ödeme adımına kadar; sipariş tamamlanmıyor. Kapsam (2026-08-22): bölümler, " +
      "havale banka bloğu, kredi kartı formu, sözleşme↔ÖDEME YAP matrisi, tutar tutarlılığı. " +
      "HOMEE-004 → MAC-7268, HOMEE-011 → MAC-7303 (2026-08-22'de açıldı). " +
      "İndirim kodu adımı kapsam dışı",
  },
  {
    key: "MAC-7076",
    title: "Tepe - Order Confirmation Page - Redesign",
    specs: ["26-order-transfer.spec.ts"],
    coverage: "partial",
    note:
      "HAVALE akışı kapsandı, yeşil koşum 2026-08-22 (ORD-20260821-122521; sipariş no UTC " +
      "tarihli. İlk gerçek sipariş 2026-08-21: ORD-20260821-896094). " +
      "'Ödemeniz bekleniyor' + banka/IBAN ekranı doğrulandı. ⚠️ Spec GERÇEK SİPARİŞ AÇAR, " +
      "ALLOW_HOMEE_ORDERS=1 olmadan skip. KREDİ KARTI ile tamamlama hâlâ kapsam dışı — " +
      "test kartı bilgisi gerekiyor",
  },
  {
    key: "MAC-7077",
    title: "Tepe - Hesabım - Redesign",
    specs: [
      "21-account-overview.spec.ts",
      "22-addresses.spec.ts",
      "23-favorites.spec.ts",
      "24-orders.spec.ts",
    ],
    coverage: "full",
    note: "Kart Test Blocked; suite hazır ve geçiyor",
  },
  {
    key: "MAC-7078",
    title: "Tepe - Mağazalar - Redesign",
    specs: ["07-stores.spec.ts"],
    coverage: "full",
    note: "HOMEE-002 (kırık görsel, aralıklı) bu kartta",
  },
  {
    key: "MAC-7080",
    title: "Tepe - İletişim",
    specs: ["09-forms.spec.ts"],
    coverage: "full",
    note: "HOMEE-003 (boş gönderimde validasyon yok) bu kartta",
  },
  {
    key: "MAC-7071",
    title: "Tepe - Hakkımızda",
    specs: ["08-static-pages.spec.ts"],
    coverage: "full",
  },
  {
    key: "MAC-7079",
    title: "Tepe - Yardım Merkezi - Create",
    specs: ["08-static-pages.spec.ts"],
    coverage: "partial",
    note: "/sikca-sorulan-sorular doğrulanıyor; ayrı bir yardım merkezi rotası varsa eklenmeli",
  },
  {
    key: "MAC-7116",
    title: "Tepe - Bloglar",
    specs: ["08-static-pages.spec.ts"],
    coverage: "partial",
    note: "/blogs açılışı doğrulanıyor; blog detay/kategori akışı kapsamda değil",
  },
  {
    key: "MAC-7043",
    title: "Tepe - Login",
    specs: ["20-login.spec.ts"],
    coverage: "full",
    note: "Kart 'Yapılacaklar' ama akış canlı ve testler geçiyor",
  },
  {
    key: "MAC-7038",
    title: "Tepe - Sign up",
    specs: [],
    coverage: "none",
    note: "Kart 'Yapılacaklar' — /kayit-ol 404. Bu bir hata DEĞİL, henüz geliştirilmedi",
  },
  {
    key: "MAC-7053",
    title: "Tepe - Componentlerin oluşturulması",
    specs: [],
    coverage: "none",
    note: "Altyapı kartı; dolaylı olarak tüm spec'ler tarafından doğrulanıyor",
  },
  {
    key: "MAC-7036",
    title: "Tepe - Splash Ekranı",
    specs: [],
    coverage: "none",
    note: "Mobil uygulama kartı — web suite kapsamı dışında",
  },
];

/** Bir spec'i doğrulayan kartları döner. */
export function cardsForSpec(spec: string): JiraCardMapping[] {
  return CARD_MAP.filter((c) => c.specs.includes(spec));
}

/** Bir kartın spec'lerini döner. */
export function specsForCard(key: string): string[] {
  return CARD_MAP.find((c) => c.key === key)?.specs ?? [];
}
