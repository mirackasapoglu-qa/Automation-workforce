/**
 * AKTİF ÜRÜN — panelin hangi siteye baktığını belirleyen tek karar.
 *
 * SORUN (ölçüldü 2026-09-15, canlıda): kapsam ağacında 151 düğüm ve İKİ AYRI
 * KÖK vardı — "Promptfoo" (15 link → www.promptfoo.dev) ve "Tepe Home" (15 link
 * → redesign-prod...). Panel ise üçüncü bir gerçeğe, proje profiline bakıyordu:
 * Site (canlı) profilin sitesini açıyor, perf onu ölçüyor, rota eşleşmesi onun
 * kartlarını gösteriyordu — kullanıcı başka bir siteyi taramış olsa bile.
 * Kullanıcının tarifiyle "her şey iç içe girmiş" durumu buydu.
 *
 * MODEL: **ağacın her KÖKÜ bir üründür.** Biri "aktif" seçilir; panelin siteye
 * bakan bütün yüzeyleri (Site canlı/proxy, perf hedefleri, rota eşleşmesi,
 * kapsam sayaçları, tasarım diff) yalnız o kökün alt ağacından beslenir.
 *
 * ⚠️ Repo'nun Playwright suite'i (koşumlar, bilinen hatalar) ÜRÜNE GÖRE
 * DEĞİŞMEZ — o testler bu repoda duruyor ve profilin sitesini test ediyor.
 * Başka bir ürün seçiliyken gizlenmiyor ama "başka ürüne ait" diye
 * İŞARETLENİYOR (kullanıcı kararı): koşturmak serbest, ama neyin ne olduğu
 * görünür.
 *
 * Seçim `panel-data/scope/active-product.json`'da; ağaç dosyasına YAZILMIYOR
 * çünkü bu bir görüntüleme tercihi, ürünün verisi değil.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "panel-data", "scope");
const FILE = path.join(DIR, "active-product.json");

const HTTP_RE = /^https?:\/\//i;

/** Bir düğüm ve altındaki her şeydeki site adreslerini (origin) sayar. */
function countOrigins(node, sayac = new Map()) {
  for (const rl of node?.resourceLinks ?? []) {
    const u = String(rl?.url ?? "").trim();
    if (!HTTP_RE.test(u)) continue;
    let o;
    try { o = new URL(u); } catch { continue; }
    const host = o.hostname.toLowerCase();
    // Tasarım/dokümantasyon linkleri ürünün adresi DEĞİL — eledikten sonra say.
    if (host.includes("figma.com") || host.includes("atlassian.net") || host.includes("confluence")) continue;
    const origin = `${o.protocol}//${o.host}`;
    sayac.set(origin, (sayac.get(origin) ?? 0) + 1);
  }
  for (const c of node?.children ?? []) countOrigins(c, sayac);
  return sayac;
}

function countNodes(node) {
  let n = 1;
  for (const c of node?.children ?? []) n += countNodes(c);
  return n;
}

/** Aynı origin'e ait mi (www farkı yok sayılır). */
function sameSite(a, b) {
  const norm = (x) => { try { return new URL(x).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
  const A = norm(a), B = norm(b);
  return Boolean(A && B && A === B);
}

/**
 * Ağacın kökleri → ürün listesi.
 *
 * Her kökün adresi, alt ağacındaki EN ÇOK GEÇEN origin'den çıkarılır: tarayıcı
 * her düğüme gezdiği adresi yazıyor, dolayısıyla çoğunluk ürünün kendi sitesi
 * olur (dış linkler azınlıkta kalır). Hiç adres yoksa (profilden tohumlanmış
 * ağaç — düğümler göreli `route` taşır) profilin adresi kullanılır.
 *
 * @param {object[]} tree
 * @param {{profileBaseUrl?: string|null}} [opts]
 */
export function listProducts(tree, { profileBaseUrl = null } = {}) {
  return (tree ?? []).map((kok) => {
    const sayac = countOrigins(kok);
    const sirali = [...sayac.entries()].sort((a, b) => b[1] - a[1]);
    const baseUrl = sirali[0]?.[0] ?? profileBaseUrl ?? null;
    return {
      nodeId: kok.id,
      name: kok.name ?? "(isimsiz)",
      baseUrl,
      links: sirali[0]?.[1] ?? 0,
      nodes: countNodes(kok),
      /** Repo'nun kendi ürünü mü — Playwright suite'i bununla ilgili. */
      isProfile: Boolean(profileBaseUrl && baseUrl && sameSite(baseUrl, profileBaseUrl)),
    };
  });
}

export function readActiveId() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8"))?.nodeId ?? null; } catch { return null; }
}

export function writeActiveId(nodeId) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ nodeId: nodeId ?? null, savedAt: new Date().toISOString() }, null, 1));
  return { nodeId: nodeId ?? null };
}

/**
 * Aktif ürünü çözer.
 *
 * Sıra: kayıtlı seçim → profilin sitesiyle eşleşen kök → ilk kök → yok.
 * Kayıtlı seçim ağaçtan silinmişse SESSİZCE düşülür (kullanıcı kökü silmiş
 * olabilir); panelin tamamen boş kalması gerileme olurdu.
 *
 * @returns {{active: object|null, products: object[]}}
 */
export function resolveActive(tree, { profileBaseUrl = null } = {}) {
  const products = listProducts(tree, { profileBaseUrl });
  if (!products.length) return { active: null, products };
  const kayitli = readActiveId();
  const active = products.find((p) => p.nodeId === kayitli)
    ?? products.find((p) => p.isProfile)
    ?? products[0];
  return { active, products };
}

/** Aktif ürünün alt ağacı — panelin siteye bakan her türetmesi bunu kullanır. */
export function activeSubtree(tree, active) {
  if (!active) return tree ?? [];
  const kok = (tree ?? []).find((n) => n.id === active.nodeId);
  return kok ? [kok] : (tree ?? []);
}

/**
 * Ürünün dosya sisteminde kullanılacak kısa adı.
 *
 * Perf ölçümü gibi ÜRÜNE AİT çıktılar bununla ayrılıyor: tek bir klasöre
 * yazınca panel, aktif ürün değişse bile önceki ürünün ölçümünü gösteriyordu
 * (ölçüldü 2026-09-15: aktif ürün Promptfoo iken perf sekmesinde `/tum-urunler`,
 * `/bahce` yazıyordu).
 *
 * Adres host'undan türetilir (insan okuyabilsin); adres yoksa düğüm id'sine
 * düşülür. Dosya adı olacağı için harf/rakam dışındaki her şey `-` olur.
 */
export function productSlug(active) {
  const ham = (() => {
    try { return new URL(active?.baseUrl).hostname.replace(/^www\./, ""); }
    catch { return String(active?.nodeId ?? ""); }
  })();
  return ham.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "varsayilan";
}
