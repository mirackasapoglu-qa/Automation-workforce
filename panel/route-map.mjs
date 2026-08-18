/**
 * Rota → koşum eşlemesi.
 *
 * Panel'in "Site" sekmesinde iframe'de hangi sayfa açıksa, o sayfanın testini
 * tek tıkla tetiklemek için kullanılır. `runId` değerleri panel/runs.json
 * whitelist'indeki id'ler olmalı — whitelist dışı komut çalışmaz.
 *
 * Jira kartları tests/jira-map.ts ile aynı bilgiyi taşır (orası kaynak; burada
 * hızlı erişim için tekrarlanır).
 */
export const ROUTE_RULES = [
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
];

export function matchRoute(pathname = "/") {
  const p = (pathname.split("#")[0] || "/").replace(/\/+$/, "") || "/";
  const clean = p.split("?")[0];
  for (const r of ROUTE_RULES) {
    if (r.test(clean)) return { ...r, test: undefined, matched: clean };
  }
  return null;
}
