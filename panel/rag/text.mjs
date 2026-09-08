/**
 * Metin normalizasyonu + belirteçleme — Türkçe'ye göre.
 *
 * ÖLÇÜLMÜŞ TUZAK (figma-diff'te 12 yanlış pozitif): `"İ".toLowerCase()` → `i`
 * + birleşik nokta; naif karşılaştırma "SİPARİŞLERİM"i eşleştiremiyor. Burada
 * aynı çözüm: NFD → `\p{Mn}` at → `ı`/`I` → `i` → küçült. Böylece
 * "Sepetim", "SEPETİM", "sepetım" tek belirtece iner.
 *
 * Gövdeleme BİLEREK muhafazakâr: yalnızca çok karakterli, sık çekim ekleri ve
 * kalan gövde ≥ 4 harfse. Sorgu ve belge AYNI fonksiyondan geçtiği için
 * tutarlılık doğruluktan önemli; agresif gövdeleme farklı kelimeleri
 * birleştirip yanlış eşleşme üretir.
 */

const STOP = new Set([
  // tr
  "ve", "veya", "ile", "bir", "bu", "su", "o", "da", "de", "ki", "mi", "mu", "ne", "icin", "gibi", "ama", "ise",
  "her", "cok", "daha", "en", "olan", "olarak", "sonra", "once", "kadar", "var", "yok", "ben", "sen", "biz",
  "siz", "onlar", "ya", "hem", "diye", "ancak", "yani", "ayni", "tum", "hic", "sadece", "yine",
  // en
  "the", "a", "an", "of", "to", "in", "on", "is", "are", "and", "or", "for", "with", "at", "by", "it", "as",
  "be", "this", "that", "from", "not", "if", "then", "else", "const", "let", "await", "async", "return",
  "function", "import", "export", "true", "false", "null", "new", "page", "test", "expect",
]);

const SUFFIXES = [
  "lerinin", "larinin", "lerini", "larini", "lerine", "larina", "lerden", "lardan", "lerde", "larda",
  "leri", "lari", "ler", "lar", "inin", "unun", "nin", "nun", "den", "dan", "ten", "tan", "iyor", "uyor",
  "de", "da", "te", "ta", "ye", "ya", "yi", "yu", "in", "un", "si", "su", "ini", "unu", "ing", "ed",
];

/** Türkçe-güvenli küçültme: NFD + aksan at + ı/I → i. */
export function normalizeTr(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/ı/g, "i")
    .replace(/I/g, "i")
    .toLowerCase();
}

/** camelCase / PascalCase / snake ayır: addToCart → add To Cart. */
function splitIdentifiers(s) {
  return String(s ?? "")
    .replace(/([a-z0-9])([A-ZÇĞİÖŞÜ])/g, "$1 $2")
    .replace(/[_\-./\\]+/g, " ");
}

export function stem(t) {
  let w = t;
  for (let round = 0; round < 2; round++) {
    let cut = false;
    for (const suf of SUFFIXES) {
      if (w.length - suf.length >= 4 && w.endsWith(suf)) { w = w.slice(0, -suf.length); cut = true; break; }
    }
    if (!cut) break;
  }
  return w;
}

/**
 * Belirteçler (gövdelenmiş, stopword'süz). Sayılar ve kısa kodlar (406, lcp) kalır.
 *
 * Eklemeli dilde ek listesi hiçbir zaman tam olmaz ("sepete" ile "sepette"
 * ayrımı gibi): bu yüzden 6+ harfli her kelime için 5 harflik ÖNEK de ayrı
 * belirteç olarak eklenir. "sepet", "sepete", "sepetim", "sepette" hepsi
 * `sepet` önekinde buluşur; BM25 gövdeyle öneki birlikte puanlar.
 */
export function tokenize(s) {
  const norm = normalizeTr(splitIdentifiers(s));
  const out = [];
  for (const m of norm.matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    if (t.length < 2 && !/^\d$/.test(t)) continue;
    if (STOP.has(t)) continue;
    if (/^\d+$/.test(t)) { out.push(t); continue; }
    const st = stem(t);
    out.push(st);
    if (t.length >= 6) {
      const pre = t.slice(0, 5);
      if (pre !== st) out.push(pre);
    }
  }
  return out;
}

/** Terim → sayı haritası. */
export function termFreq(tokens) {
  const tf = Object.create(null);
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}
