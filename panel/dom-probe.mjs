/**
 * SAYFA KEŞFİ — modelin uydurmasını bitiren katman.
 *
 * Sorun ölçüldü (2026-09-16, canlı): aynı test case'inden üretilen spec bir
 * makinede geçti, diğerinde düştü. Sebep kod değil, TAHMİN: model sayfayı hiç
 * görmediği için seçiciyi case metninden uyduruyordu —
 *   `getByPlaceholder('E-posta')`  → gerçek placeholder: `ornek@mail.com`
 *   `getByRole('link', {name:'Tüm Ürünler'})` → gerçek metin: `TÜMÜNÜ GÖR`
 * İkisi de 20 sn timeout. İstem kuralları "nasıl yazacağını" söylüyordu,
 * "sayfada ne olduğunu" değil.
 *
 * Bu modül sayfayı gerçekten açıp görünür öğeleri çıkarır; çıktı isteme girer.
 *
 * ⚠️ PANELİN SIFIR BAĞIMLILIK KURALI KORUNUR: Playwright DİNAMİK import edilir
 * ve yoksa/başlatılamazsa `null` döner — özellik kapanmaz, üretim eskisi gibi
 * (tahminle) devam eder. Panel Playwright kurulu olmayan bir makinede de açılır.
 *
 * ⚠️ readonly BAYRAĞI TAŞINIR: giriş alanları otomatik doldurmayı engellemek
 * için readonly başlayabiliyor ve `fill()` o alanda 20 sn bekliyor (ölçüldü).
 * Model bunu görürse önce `click()` yazar.
 */
const CACHE = new Map();               // url -> { at, data }
const TTL_MS = Number(process.env.DOM_PROBE_TTL_MS ?? 10 * 60 * 1000);
const TIMEOUT_MS = Number(process.env.DOM_PROBE_TIMEOUT_MS ?? 25000);

/** Tarayıcıda koşan toplayıcı — sayfa bağlamında çalışır, dışarıdan değişken almaz. */
function topla() {
  const gorunur = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const kirp = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const tekil = (liste, anahtar) => {
    const g = new Set(); const out = [];
    for (const x of liste) { const k = anahtar(x); if (!k || g.has(k)) continue; g.add(k); out.push(x); }
    return out;
  };

  const basliklar = tekil([...document.querySelectorAll("h1,h2,h3")].filter(gorunur)
    .map((e) => ({ etiket: e.tagName.toLowerCase(), metin: kirp(e.innerText, 60) })).filter((x) => x.metin), (x) => x.metin).slice(0, 20);

  const baglar = tekil([...document.querySelectorAll("a[href]")].filter(gorunur).map((a) => ({
    metin: kirp(a.innerText || a.getAttribute("aria-label"), 40),
    href: kirp(a.getAttribute("href"), 60),
  })).filter((x) => x.metin || x.href), (x) => x.metin + "|" + x.href).slice(0, 40);

  const dugmeler = tekil([...document.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(gorunur)
    .map((b) => ({ ad: kirp(b.getAttribute("aria-label") || b.innerText || b.value, 40) })).filter((x) => x.ad), (x) => x.ad).slice(0, 25);

  const alanlar = [...document.querySelectorAll("input,textarea,select")].filter(gorunur).map((i) => ({
    tip: kirp(i.type || i.tagName.toLowerCase(), 16),
    id: kirp(i.id, 40),
    ad: kirp(i.getAttribute("name"), 40),
    placeholder: kirp(i.getAttribute("placeholder"), 40),
    aria: kirp(i.getAttribute("aria-label"), 40),
    readonly: i.hasAttribute("readonly"),
  })).slice(0, 20);

  return { title: document.title, url: location.href, basliklar, baglar, dugmeler, alanlar };
}

/**
 * Sayfayı açar ve görünür öğeleri döndürür. Hata durumunda `null`.
 * @param {string} url tam adres
 */
export async function probePage(url, { fresh = false } = {}) {
  const adres = String(url ?? "").trim();
  if (!/^https?:\/\//.test(adres)) return null;

  const onbellek = CACHE.get(adres);
  if (!fresh && onbellek && Date.now() - onbellek.at < TTL_MS) return onbellek.data;

  let chromium;
  try { ({ chromium } = await import("@playwright/test")); }
  catch { return null; }   // Playwright yok — ozellik kapanmaz, tahmine duser

  let browser = null;
  try {
    const kanal = process.env.PW_CHANNEL ?? "chrome";
    browser = await chromium.launch(kanal && kanal !== "chromium" ? { channel: kanal } : {});
    const page = await browser.newPage();
    await page.goto(adres, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(1200);
    // Lazy bölümler kaydırmadan DOM'a girmiyor (ölçüldü: anasayfa başlıkları).
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(250); }
    await page.waitForTimeout(600);
    const data = await page.evaluate(topla);
    CACHE.set(adres, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  } finally {
    try { await browser?.close(); } catch { /* kapanmayan tarayici uretimi dusurmesin */ }
  }
}

/** Keşfi isteme girecek KOMPAKT metne çevirir (saf — birim testli). */
export function renderProbe(d, { limit = 2600 } = {}) {
  if (!d) return "";
  const sat = [];
  sat.push(`SAYFADA GERÇEKTEN OLANLAR (${d.url} — otomatik keşif, UYDURMA, buradan seç)`);
  if (d.title) sat.push(`sekme başlığı: ${d.title}`);
  if (d.basliklar?.length) sat.push(`başlıklar: ${d.basliklar.map((h) => `${h.etiket}:"${h.metin}"`).join(" · ")}`);
  if (d.dugmeler?.length) sat.push(`düğmeler: ${d.dugmeler.map((b) => `"${b.ad}"`).join(" · ")}`);
  if (d.baglar?.length) sat.push(`bağlantılar: ${d.baglar.map((a) => `"${a.metin}"→${a.href}`).join(" · ")}`);
  if (d.alanlar?.length) {
    sat.push("form alanları:");
    for (const f of d.alanlar) {
      const p = [f.id && `#${f.id}`, f.ad && `name=${f.ad}`, f.placeholder && `placeholder="${f.placeholder}"`,
        f.aria && `aria-label="${f.aria}"`, f.readonly && "READONLY (fill'den önce click şart)"].filter(Boolean);
      sat.push(`  - ${f.tip}: ${p.join(" · ") || "(işaretsiz)"}`);
    }
  }
  const metin = sat.join("\n");
  return metin.length > limit ? `${metin.slice(0, limit)}\n…(kısaltıldı)` : metin;
}

/**
 * Case adımlarında geçen site içi ROTALARI çıkarır.
 *
 * Neden gerekli: keşif düğümün kendi rotasını açıyor, ama case başka bir
 * sayfaya gidiyor olabilir — ölçüldü 2026-09-16: login case'i ağacın KÖK
 * düğümüne bağlıydı, keşif anasayfayı açıyordu ve giriş formunu hiç
 * göstermiyordu; model gene placeholder uydurdu. Adımda `/giris` yazıyorsa o
 * sayfa da keşfedilir.
 *
 * Yalnız site içi yollar (`/` ile başlayan). Dosya uzantılı ve çok uzun olanlar
 * elenir; en fazla `limit` tane döner.
 */
export function pathsInSteps(cases, { limit = 2 } = {}) {
  const out = [];
  const gor = new Set();
  for (const c of cases ?? []) {
    const metin = [c?.title, ...(c?.steps ?? []).flatMap((st) => [st?.action, st?.expected])].filter(Boolean).join(" ");
    for (const m of String(metin).matchAll(/(?<![\w@.])\/[a-z0-9][a-z0-9\-/]{1,60}/gi)) {
      const yol = m[0].replace(/[.,;:)\]]+$/, "");
      if (/\.(png|jpe?g|svg|css|js|json|webp|ico)$/i.test(yol)) continue;
      if (gor.has(yol)) continue;
      gor.add(yol);
      out.push(yol);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
