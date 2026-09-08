/**
 * Gizli veri maskeleme — RAG corpus'una ve isteme giren her metin buradan geçer.
 *
 * NEDEN (ölçüldü 2026-09-08): indeks CLAUDE.md'yi de alıyordu ve o dosyada kapı
 * şifresi yazıyordu; `password123` sorgusu şifreli parçayı döndürdü. Aynı parça
 * isteme girip modele de gidebilirdi. Üç katman:
 *   1) ORTAM DEĞERLERİ: `*PASSWORD/*TOKEN/*SECRET/*KEY` adlı değişkenlerin
 *      DEĞERLERİ (≥6 karakter) metinde nerede geçerse geçsin maskelenir. En
 *      kesin katman — gerçek şifre ne ise onu bilir, tahmin etmez.
 *   2) BİÇİM: bilinen token kalıpları (sk-ant-, figd_, xox?-, ATATT, Bearer/Basic,
 *      AKIA, PEM blokları).
 *   3) SATIR: `X_PASSWORD=değer` biçimindeki satırlarda değer; şifre/parola/token
 *      geçen satırlarda parantezli `kullanıcı / şifre` çiftleri.
 *
 * Fazla maskelemek az maskelemekten iyidir: birkaç doküman satırı bulanıklaşır,
 * ama gerçek bir kimlik modele ya da kimliksiz arama ucuna gitmez.
 */
export const MASK = "[gizli]";

const SECRET_KEY_RE = /(PASS(WORD)?|PAROLA|SIFRE|ŞİFRE|SECRET|TOKEN|API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY)$/i;

/** Süreç ortamındaki gizli DEĞERLER (adlar değil). */
export function secretValuesFromEnv(env = process.env) {
  const out = new Set();
  for (const [k, v] of Object.entries(env)) {
    if (!SECRET_KEY_RE.test(k)) continue;
    const s = String(v ?? "").trim();
    if (s.length >= 6) out.add(s);
  }
  return out;
}

const FORMAT_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bfigd_[A-Za-z0-9_-]{8,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{8,}/g,
  /\blin_api_[A-Za-z0-9]{8,}/g,
  /\bATATT[A-Za-z0-9_-]{10,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** `GATE_PASSWORD=deger`, `token: deger` gibi satırlar — yalnız DEĞER maskelenir. */
const ENV_LINE_RE = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?:PASS(?:WORD)?|PAROLA|SIFRE|SECRET|TOKEN|API_?KEY)\s*[=:]\s*)(["'`]?)([^\s"'`#]{4,})(\2)/gim;

const PROSE_LINE_RE = /(password|parola|şifre|sifre|secret|token|api key|api anahtar)/i;
/** `(admin / password123)` ya da (`admin` / `password123`) çifti. */
const PAIR_RE = /\(\s*`?[^`()\/\s]{2,}`?\s*\/\s*`?[^`()\s]{3,}`?\s*\)/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} text
 * @param {{values?: Set<string>}} [opt] ortam değerleri (varsayılan: süreç ortamı)
 * @returns {{text: string, redactions: number}}
 */
export function redactText(text, { values = secretValuesFromEnv() } = {}) {
  let out = String(text ?? "");
  let n = 0;
  for (const v of values) {
    out = out.replace(new RegExp(escapeRe(v), "g"), () => { n++; return MASK; });
  }
  for (const re of FORMAT_PATTERNS) {
    out = out.replace(re, () => { n++; return MASK; });
  }
  out = out.replace(ENV_LINE_RE, (m, head, q, _val, q2) => { n++; return `${head}${q}${MASK}${q2}`; });
  out = out
    .split("\n")
    .map((line) => (PROSE_LINE_RE.test(line) ? line.replace(PAIR_RE, () => { n++; return `(${MASK})`; }) : line))
    .join("\n");
  return { text: out, redactions: n };
}
