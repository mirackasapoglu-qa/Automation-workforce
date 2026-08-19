/**
 * Rota → Figma frame eşlemesi.
 *
 * node id'leri Jira kart açıklamalarındaki Figma linklerinden çıkarıldı
 * (MAC-7035 epic'i, 15 kart). Dosya: Tepe Home UI/UX Design.
 */
export const FIGMA_FILE = "WRyAE2K87JyYZHJlH18OfD";

export const FIGMA_ROUTES = [
  { test: (p) => p === "/" , node: "140:2705", frame: "Home", page: "Main Page", cards: ["MAC-7037", "MAC-7040"] },
  { test: (p) => /-p-[^/]+$/.test(p), node: "539:9969", frame: null, page: "Product Detail Page_PDP", cards: ["MAC-7073"] },
  { test: (p) => p.startsWith("/tum-urunler") || ["/mutfak","/bahce","/banyo","/yeni-urunler"].includes(p), node: "449:25502", frame: null, page: "Product Listing Page_PLP", cards: ["MAC-7039", "MAC-7072"] },
  { test: (p) => p === "/sepet", node: "684:43086", frame: null, page: "My Cart", cards: ["MAC-7074"] },
  { test: (p) => p === "/odeme", node: "630:187", frame: null, page: "Checkout", cards: ["MAC-7075"] },
  { test: (p) => p.startsWith("/hesabim"), node: "1013:192", frame: null, page: "Hesap", cards: ["MAC-7077"] },
  { test: (p) => p === "/magazalar", node: "1082:192", frame: null, page: "Mağazalar", cards: ["MAC-7078"] },
  { test: (p) => p === "/iletisim" || p === "/hakkimizda", node: "1103:2391", frame: null, page: "Hakkımızda / İletişim", cards: ["MAC-7071", "MAC-7080"] },
  { test: (p) => p.startsWith("/blogs"), node: "1120:1520", frame: null, page: "Bloglar", cards: ["MAC-7116"] },
  { test: (p) => p.startsWith("/giris") || p.startsWith("/kayit-ol"), node: "494:30265", frame: null, page: "Sign Up - Login", cards: ["MAC-7038", "MAC-7043"] },
];

export function figmaForRoute(pathname = "/") {
  const p = (pathname.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";
  for (const r of FIGMA_ROUTES) {
    if (r.test(p)) return { ...r, test: undefined, matched: p, file: FIGMA_FILE };
  }
  return null;
}
