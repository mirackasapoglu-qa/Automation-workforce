/**
 * Homee rota envanteri — 2026-08-18 keşif taramasıyla doğrulandı.
 * Rota davranışı değiştiğinde burayı güncelle; 02-navigation bu listeleri kullanır.
 */

/** Ürün listeleyen ve GERÇEKTEN ürün dönen rotalar — liste testleri bunları kullanır. */
export const LISTING_WITH_PRODUCTS = [
  "/tum-urunler",
  "/tum-urunler/oturma-odasi",
  "/bahce",
];

/**
 * Açılıyor (404 değil) ama "0 ürün / Ürün bulunamadı" dönen kategori rotaları.
 * Test ortamı verisi eksik olabilir ya da kategori eşlemesi bozuk olabilir — takipte.
 */
export const LISTING_EMPTY = [
  "/tum-urunler/dekoratif-obje-figur",
  "/oturma-odasi/tamamlayici-mobilya",
  "/mutfak",
  "/banyo",
  "/yeni-urunler",
];

/** Kampanya/landing sayfaları — ürün kartı beklenmez, içerik beklenir. */
export const CONTENT_PAGES = ["/kucuk-mekanlar-1", "/Tepe-Home-Bahce"];

/** Menüde/footer'da linki olan ama 404 dönen rotalar (2026-08-18). */
export const KNOWN_BROKEN_ROUTES = [
  "/oturma-odasi",
  "/yasam",
  "/yatak-odasi",
  "/indirimli-urunler",
  "/cerez-politikasi",
  "/sozlesme-ve-bilgilendirme",
];

/** 404 dönmemesi gereken tüm rotalar. */
export const MENU_ROUTES = [...LISTING_WITH_PRODUCTS, ...LISTING_EMPTY, ...CONTENT_PAGES];

export const STATIC_ROUTES = [
  { path: "/magazalar", heading: "Mağazalarımız" },
  { path: "/iletisim", heading: "Sizden Haber Almak İsteriz" },
  { path: "/blogs", heading: "İlham Veren Fikirler" },
  { path: "/sikca-sorulan-sorular", heading: "Size Nasıl Yardımcı Olabiliriz?" },
  { path: "/hakkimizda", heading: "Tasarımın yaratıcılıkla buluştuğu yer" },
  { path: "/bilkent-holding", heading: "Bilkent Holding" },
  { path: "/etik-politikamiz", heading: "Etik Politikamız" },
  { path: "/insan-kaynaklari", heading: "İnsan Kaynakları" },
  { path: "/kvkk-aydinlatma-metni", heading: "KVKK Aydınlatma Metni" },
  { path: "/privacy", heading: "GİZLİLİK" },
];

/** Üye alanı rotaları (20+ spec'leri). /hesabim/bilgilerim YOK — doğrusu /hesabim/profil. */
export const ACCOUNT_ROUTES = [
  { path: "/hesabim", heading: "Hesabım" },
  { path: "/hesabim/siparislerim", heading: "Siparişlerim" },
  { path: "/hesabim/iadelerim", heading: "İade" },
  { path: "/hesabim/adreslerim", heading: "Adreslerim" },
  { path: "/hesabim/favorilerim", heading: "Favorilerim" },
  { path: "/hesabim/profil", heading: "Profil & Ayarlar" },
];

/** Stabil test ürünleri (SAP test kayıtları). */
export const TEST_PRODUCTS = {
  sapTest: "/tepe-sap-test-yeni-urun-p-1099765",
  deneme: "/test-deneme-urun-test1-p-1099766",
  sehpa: "/anchor-kare-orta-sehpa-p-anc03sh756t763",
};

export const SEARCH_TERMS = { hit: "koltuk", miss: "zzzqwertyyok" };
