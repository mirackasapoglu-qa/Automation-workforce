/**
 * ÜRÜN BAŞINA GİRİŞ BİLGİLERİ — login akışı testleri için.
 *
 * Kullanıcı bir URL tarayıp kapsam kurduğunda, "Login akışı" gibi bir test
 * case'i üretiliyor ama onu koşacak bir kimlik hiçbir yerde yok: repo'nun
 * `.env`'indeki `TEST_EMAIL`/`TEST_PASSWORD` PROFİLİN sitesine ait, taranan
 * yabancı siteye değil. Bu dosya o boşluğu kapatıyor: her ürünün kendi giriş
 * bilgisi, panelin veri dizininde.
 *
 * ⚠️ PAROLA HİÇBİR YANITTA DÖNMEZ. Okuma uçları yalnızca "var mı" bilgisini ve
 * kullanıcı adını verir; parola yalnızca koşum sürecine ORTAM DEĞİŞKENİ olarak
 * geçer. Panelin kendi Claude token'ında da aynı kural var (bkz. CLAUDE.md →
 * "Claude hesapları": token hiçbir yanıtta ve denetim kaydında geçmez).
 *
 * ⚠️ ÜRETİLEN KODA GÖMÜLMEZ. Spec üreticinin istemi modele parolayı VERMEZ;
 * `process.env.QA_PASSWORD` okumasını söyler. Aksi halde parola `tests/` altına
 * düz metin olarak yazılır ve oradan git'e sızma riski doğardı.
 *
 * Dosya: `panel-data/scope/product-credentials.json` (0600)
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "panel-data", "scope");
const FILE = path.join(DIR, "product-credentials.json");

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) ?? {}; } catch { return {}; }
}

function writeAll(obj) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 1), { mode: 0o600 });
  // Dosya zaten varsa `writeFileSync` izni değiştirmez — açıkça daralt.
  try { fs.chmodSync(FILE, 0o600); } catch { /* bazi dosya sistemlerinde desteklenmez */ }
}

/**
 * Kaydı diskten okur — PAROLA DAHİL. Yalnızca koşum ortamını kuran sunucu
 * kodu çağırmalı; HTTP yanıtına bu nesne KONULMAZ (bkz. `publicView`).
 */
export function readSecret(productKey) {
  const k = String(productKey ?? "").trim();
  if (!k) return null;
  return readAll()[k] ?? null;
}

/** Dışarıya gösterilebilir hâli: parola yerine yalnızca "var mı". */
export function publicView(rec) {
  if (!rec) return null;
  return {
    loginUrl: rec.loginUrl ?? "",
    username: rec.username ?? "",
    hasPassword: Boolean(rec.password),
    note: rec.note ?? "",
    updatedAt: rec.updatedAt ?? null,
  };
}

export function list() {
  const all = readAll();
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, publicView(v)]));
}

export function get(productKey) {
  return publicView(readSecret(productKey));
}

/**
 * Kaydeder/günceller.
 *
 * ⚠️ PAROLA BOŞ GELİRSE ESKİSİ KORUNUR. Arayüz parolayı hiç göstermiyor; her
 * kaydetmede boş gelen alanı "sil" saymak, kullanıcının yalnızca kullanıcı
 * adını düzelttiği durumda parolayı sessizce uçururdu. Silmek için ayrı uç var.
 */
export function save(productKey, { loginUrl, username, password, note } = {}) {
  const k = String(productKey ?? "").trim();
  if (!k) throw new Error("ürün anahtarı zorunlu");

  const ad = String(username ?? "").trim();
  if (!ad) throw new Error("Kullanıcı adı boş olamaz");

  const url = String(loginUrl ?? "").trim();
  if (url && !/^https?:\/\/|^\//.test(url)) {
    throw new Error("Giriş adresi ya tam adres (https://…) ya da site içi yol (/giris) olmalı");
  }

  const all = readAll();
  const eski = all[k] ?? {};
  const parola = String(password ?? "");
  all[k] = {
    loginUrl: url,
    username: ad,
    password: parola || eski.password || "",
    note: String(note ?? "").slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  if (!all[k].password) throw new Error("Parola boş olamaz");
  writeAll(all);
  return publicView(all[k]);
}

export function remove(productKey) {
  const k = String(productKey ?? "").trim();
  const all = readAll();
  if (!(k in all)) return { removed: false };
  delete all[k];
  writeAll(all);
  return { removed: true };
}

/**
 * Koşum sürecine geçecek ortam değişkenleri.
 *
 * Adlar üretilen spec'in istemiyle AYNI olmak zorunda (bkz. spec-gen.mjs →
 * renderUser): model `process.env.QA_USERNAME` / `QA_PASSWORD` / `QA_LOGIN_URL`
 * okuyacak şekilde yönlendiriliyor. Kayıt yoksa boş nesne döner — test o zaman
 * "kimlik verilmemiş" diye atlanır, sessizce yanlış parolayla denenmez.
 */
export function runEnv(productKey) {
  const rec = readSecret(productKey);
  if (!rec?.username || !rec?.password) return {};
  return {
    QA_LOGIN_URL: rec.loginUrl ?? "",
    QA_USERNAME: rec.username,
    QA_PASSWORD: rec.password,
  };
}
