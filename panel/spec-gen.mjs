/**
 * ADIMLARDAN PLAYWRIGHT SPEC'İ — elle case'leri otomatiğe çeviren köprü.
 *
 * Flowscope'ta "Test Case'leri Koştur (Claude Code)" düğmesi bir İSTEM üretiyor;
 * kullanıcı onu kopyalayıp kendi terminalinde Claude Code'a veriyor, test orada
 * yazılıp koşuluyor ve sonuç panele hiç dönmüyordu. Bu dosya aynı işi sunucuda
 * yapar: adımları koda çevirir, dosyayı yazar, panel onu kendi whitelist'li
 * koşum yolundan çalıştırır ve sonuç ağaca düşer.
 *
 * ⚠️ ÜRETİLEN KOD `tests/` KÖKÜNE yazılır (`gen-<slug>.spec.ts`).
 * Sebep: Playwright'ın `testDir`i ve panelin spec doğrulaması (`listSpecs` →
 * `buildCustomArgs`) yalnız o dizinin KÖKÜNÜ tarıyor. Alt klasöre yazılan dosya
 * "Bilinmeyen spec" diye reddedilirdi. `gen-` öneki elle yazılmış suite'ten
 * ayırır; dosya başlığı da nereden geldiğini söyler.
 *
 * ⚠️ MODELİN ÇIKTISI KAPIDAN GEÇER (`gate`): dosya adı biçimi, gerçekten
 * Playwright testi olması, istenen case başlıklarının dışına çıkmaması ve
 * tehlikeli kalıp içermemesi kontrol edilir. Kapı VERİ yolunda — model ne
 * derse desin, kapıdan geçmeyen kod diske YAZILMAZ.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");
/**
 * ⚠️ ÜRETİLEN SPEC'İN ASIL YERİ BURASI — `panel-data` VOLUME'Ü.
 *
 * Dosya `tests/` altına yazılmak ZORUNDA (Playwright'ın testDir'i ve panelin
 * spec doğrulaması orayı tarıyor), ama orası İMAJIN İÇİ: her deploy imajı
 * git'ten yeniden kuruyor ve `tests/gen-*.spec.ts` gitignore'da olduğu için
 * dosyalar siliniyor. Referans (`runRef.specs`) volume'de kaldığı için koşum
 * "Bilinmeyen spec" diye düşüyordu (ölçüldü 2026-09-15 canlıda: ağaç 2 gen
 * spec istiyor, sunucu 0 görüyor).
 *
 * Çözüm: ASIL KOPYA volume'de; `tests/` altındaki onun çalışma kopyası.
 */
const STORE = path.join(ROOT, "panel-data", "generated");

/** Dosya adı: ürün/düğüm adından türetilir, çakışırsa sayı eklenir. */
export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[ıİ]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "kapsam";
}

/**
 * Modelden istenecek metin. Adımlar VERİ olarak veriliyor; model onları
 * yorumlamıyor, koda çeviriyor.
 *
 * ⚠️ `baseURL` istemde VERİLİR ve koda yazılmaması söylenir: Playwright config
 * zaten ortamdan çözüyor, koda gömülen adres ortam değişince sessizce yanlış
 * siteyi test eder.
 */
export function renderUser({ product, baseUrl, node, cases, credentials = null }) {
  const adimlar = cases.map((c, i) => {
    const satirlar = (c.steps ?? []).map((st, j) =>
      `     ${j + 1}. ${st.action ?? "(adım yok)"}${st.expected ? `  →  beklenen: ${st.expected}` : ""}`);
    return `  ${i + 1}. ${c.title}\n${satirlar.join("\n") || "     (yazılı adım yok — başlığa göre yaz)"}`;
  }).join("\n\n");

  return `Ürün: ${product}
Site: ${baseUrl}
Sayfa/düğüm: ${node.name}${node.path ? `  (rota: ${node.path})` : ""}

Aşağıdaki test case'lerini ÇALIŞAN bir Playwright spec dosyasına çevir.

${adimlar}

KURALLAR
1. TypeScript, Playwright test API'si: import { test, expect } from "@playwright/test".
2. Her case AYRI bir test() olsun ve başlığı YUKARIDAKİ BAŞLIĞIN AYNISI olsun — birebir kopyala.
3. Adres KODA GÖMME: sayfaya göreli git (page.goto("${node.path || "/"}")). baseURL config'ten gelir.
4. Seçici sırası: getByRole → getByText (tam metin) → CSS. data-testid YOKSA uydurma.
5. Göremediğin bir şeyi VARSAYMA: adımda olmayan bir buton/alan icat etme.
6. Yalnızca OKUYAN adımlar yaz; form gönderme, silme, sipariş verme gibi yan etkili
   adım varsa o testi test.skip ile işaretle ve sebebini yorumda yaz.
7. Beklenen yoksa en azından sayfanın yüklendiğini doğrula (expect(page).toHaveURL / locator görünür).
8. Kod DIŞINDA açıklama yazma; yanıt yalnızca istenen JSON olsun.${credentials ? `

GİRİŞ GEREKTİREN ADIMLAR
Bu ürün için giriş bilgisi TANIMLI (kullanıcı: ${credentials.username}).
- PAROLAYI KODA YAZMA. Kullanıcı adı ve parola koşum sırasında ortam
  değişkeninden gelir: process.env.QA_USERNAME ve process.env.QA_PASSWORD.
  Giriş sayfası: ${credentials.loginUrl || "(verilmedi — adımlardaki yola git)"}${credentials.loginUrl ? " (process.env.QA_LOGIN_URL ile de okunabilir)" : ""}.
- Giriş gerektiren testin başında bu değişkenler yoksa test.skip ile atla:
  test.skip(!process.env.QA_USERNAME, "giriş bilgisi tanımlı değil").
- Giriş adımlarını case'de yazdığı gibi uygula; formu doldurup gönder.` : `

GİRİŞ BİLGİSİ YOK
Bu ürün için kayıtlı giriş bilgisi YOK. Giriş gerektiren bir case varsa onu
test.skip ile atla ve sebebini yorumda yaz ("giriş bilgisi tanımlı değil") —
kullanıcı adı/parola UYDURMA.`}`;
}

export const SYSTEM = `Sen bir QA otomasyon mühendisisin. Verilen test case adımlarını
çalışan Playwright TypeScript koduna çeviriyorsun. Uydurmuyorsun: adımlarda olmayan
bir öğeyi, seçiciyi ya da akışı koda koymuyorsun. Yan etkili (veri değiştiren) adımları
test.skip ile işaretliyorsun.`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", description: "Tam spec dosyası içeriği" },
    notes: { type: "string", description: "Atlanan ya da eksik bırakılan adımlar" },
  },
  required: ["code"],
};

/**
 * Model çıktısının kapısı.
 *
 * @param {{code: string}} out
 * @param {{titles: string[]}} p  istenen case başlıkları
 * @returns {{ok: boolean, error?: string, missing?: string[]}}
 */
/**
 * Kodu çıktının içinden bulur.
 *
 * ⚠️ CLI yolunda modelin biçimi ARALIKLI sapıyor (dokümante edilmiş davranış):
 * aynı istem bir kez `{file, code}`, bir kez `{file, language, code}` döndürdü;
 * bir denemede de `code` hiç gelmedi ve üretim "model kod üretmedi" ile düştü
 * (ölçüldü 2026-09-15, 0.39 $ boşa gitti). Bu yüzden önce `code` aranır,
 * yoksa Playwright import'u içeren İLK uzun metin alanı kabul edilir — kapının
 * geri kalanı onu yine de doğrular, yani gevşeklik güvenliği azaltmıyor.
 */
export function pickCode(out) {
  if (typeof out?.code === "string" && out.code.trim()) return out.code;
  for (const v of Object.values(out ?? {})) {
    if (typeof v === "string" && v.length > 80 && /@playwright\/test/.test(v)) return v;
  }
  return "";
}

export function gate(out, { titles = [], secret = null } = {}) {
  const kod = String(pickCode(out) ?? "");
  if (!kod.trim()) return { ok: false, error: "model kod üretmedi" };
  if (!/from\s+["']@playwright\/test["']/.test(kod)) return { ok: false, error: "Playwright import'u yok — bu bir spec dosyası değil" };
  if (!/\btest\s*\(/.test(kod)) return { ok: false, error: "hiç test() yok" };

  /*
   * ⚠️ TEHLİKELİ KALIPLAR: üretilen dosya panelin koşum motorunda çalışacak.
   * Dosya sistemi/süreç çağrısı bir test spec'inde işi yok; modelin "yardımcı
   * olmak" için eklediği böyle bir satır sessizce çalışırdı.
   */
  for (const [re, ad] of [
    [/\brequire\s*\(/, "require()"],
    [/child_process|execSync|spawnSync/, "süreç çağrısı"],
    [/\bfs\s*\.\s*(rm|unlink|writeFile|rmdir)/, "dosya yazma/silme"],
    [/process\s*\.\s*env\s*\[/, "dinamik env erişimi"],
  ]) {
    if (re.test(kod)) return { ok: false, error: `üretilen kodda ${ad} var — reddedildi` };
  }

  /*
   * ⚠️ PAROLA SIZINTISI. Model "yardımcı olmak" için parolayı koda gömerse o
   * dosya `tests/` altına düz metin olarak yazılır ve oradan git'e sızabilir.
   * İstem zaten `process.env` demesini söylüyor; bu kapı onu DOĞRULUYOR.
   */
  if (secret && kod.includes(secret)) {
    return { ok: false, error: "üretilen kodda parola düz metin geçiyor — reddedildi" };
  }

  // İstenen başlıklar gerçekten var mı (model kendi testini uydurmasın).
  const eksik = titles.filter((t) => !kod.includes(t.slice(0, 40)));
  if (titles.length && eksik.length === titles.length) {
    return { ok: false, error: "üretilen kod istenen case'lerin hiçbirini içermiyor" };
  }
  return { ok: true, missing: eksik };
}

/**
 * `tests/` altinda bu spec dosyasi VAR MI?
 *
 * Agacta bir case'in `spec` alani dolu olabilir ama dosya kaybolmus olabilir
 * (deploy `tests/`i yeniden kurar — bkz. STORE yorumu). O durumda case
 * "otomatik" gorunuyor ama kosulamiyor: panel "otomatige cevir" dugmesini
 * gizliyor ve kullanicinin elinde HICBIR yol kalmiyordu (olculdu 2026-09-15:
 * gen-salon.spec.ts). Bu yuzden "otomatik mi" sorusu artik dosyaya da bakiyor.
 */
export function specExists(filename) {
  const ad = String(filename ?? "").trim();
  if (!ad || ad.includes("/") || ad.includes("\\")) return false;
  try { return fs.existsSync(path.join(TESTS, ad)); } catch { return false; }
}

/**
 * Verilen spec adlarindan DOSYASI OLMAYANLAR. Yeniden uretimden sonra agactaki
 * olu referanslar bununla temizleniyor; kalsalardi kosum dogrulamasi yeni
 * dosyayi hic denemeden "Bilinmeyen spec" demeye devam ederdi.
 */
export function deadSpecs(list) {
  return [...new Set((list ?? []).filter(Boolean))].filter((sp) => !specExists(sp));
}

/** Çakışmayan dosya adı üretir: `gen-<slug>.spec.ts`, gerekirse `-2`, `-3`… */
export function pickFilename(slug) {
  const temel = `gen-${slug}`;
  for (let i = 0; i < 50; i++) {
    const ad = i === 0 ? `${temel}.spec.ts` : `${temel}-${i + 1}.spec.ts`;
    // Kalici depo da sorulur: deploy sonrasi `tests/` bos gelebiliyor ve
    // yalniz oraya bakmak, volume'de duran bir dosyanin adini YENIDEN verip
    // geri yuklemede onu ezmeye yol acardi.
    if (!fs.existsSync(path.join(TESTS, ad)) && !fs.existsSync(path.join(STORE, ad))) return ad;
  }
  return `${temel}-${Date.now()}.spec.ts`;
}

/**
 * Dosyayı yazar. Başlığa nereden geldiği ve ELLE DÜZENLENEBİLECEĞİ yazılır —
 * üretilen kod kutsal değil, başlangıç noktası.
 */
/**
 * Hazir icerigi İKİ YERE birden yazar: kalici depo (volume) + calisma kopyasi
 * (`tests/`). Kendi basligini tasiyan ureticiler (kayittan spec) bunu kullanir;
 * `writeSpec` de basligi ekledikten sonra buraya duser. Tek yazma yolu olmasi
 * onemli: ikinci bir yol yalniz `tests/`e yazarsa o dosya ilk deploy'da ucar.
 */
export function storeSpec(filename, icerik) {
  fs.mkdirSync(STORE, { recursive: true });
  fs.writeFileSync(path.join(STORE, filename), icerik);
  fs.mkdirSync(TESTS, { recursive: true });
  fs.writeFileSync(path.join(TESTS, filename), icerik);
  return { file: filename, path: path.join("tests", filename) };
}

export function writeSpec(filename, code, { product, node, at = new Date().toISOString() }) {
  const baslik = `/*
 * ÜRETİLMİŞ DOSYA — kapsam ağacındaki test case adımlarından oluşturuldu.
 *   ürün : ${product}
 *   düğüm: ${node?.name ?? "?"}${node?.nodeId ? ` (${node.nodeId})` : ""}
 *   tarih: ${at}
 *
 * Elle düzenleyebilirsin; bir daha üretilirse YENİ dosya açılır, bu ezilmez.
 */
`;
  return storeSpec(filename, baslik + code.replace(/^﻿/, "") + "\n");
}

/**
 * Volume'deki üretilmiş spec'leri `tests/` altına geri koyar.
 *
 * Açılışta ve her koşumdan ÖNCE çağrılır: deploy sonrası `tests/` tertemiz
 * gelir, ağaçtaki referanslar ise durur. Var olan dosyanın ÜZERİNE YAZILMAZ —
 * kullanıcı üretilen kodu elle düzenlemiş olabilir ve o düzenleme kaybolmamalı
 * (dosya başlığı zaten "elle düzenleyebilirsin" diyor).
 *
 * @returns {{restored: string[], skipped: number}}
 */
export function restoreGenerated() {
  const uretilmis = (dir) => {
    try { return fs.readdirSync(dir).filter((f) => /^gen-[\w.-]+\.spec\.ts$/.test(f)); }
    catch { return []; }
  };

  const restored = [];
  const adopted = [];
  let skipped = 0;

  // depo → tests: asil is.
  const depoda = uretilmis(STORE);
  if (depoda.length) fs.mkdirSync(TESTS, { recursive: true });
  for (const f of depoda) {
    const hedef = path.join(TESTS, f);
    if (fs.existsSync(hedef)) { skipped++; continue; }
    try { fs.copyFileSync(path.join(STORE, f), hedef); restored.push(f); }
    catch { /* kopyalanamayan dosya kosumu dusurmesin */ }
  }

  /*
   * tests → depo: SAHİPLENME. Bu depo var olmadan önce üretilmiş ve hâlâ
   * diskte duran dosyalar başka hiçbir yerde yok — ilk deploy'da uçarlardı.
   * Bir kez kopyalanınca kalıcı olurlar. Elle yazılmış bir test bu desene
   * uymadığı için (ad `gen-` ile başlamıyor) sahiplenilmez.
   */
  for (const f of uretilmis(TESTS)) {
    const hedef = path.join(STORE, f);
    if (fs.existsSync(hedef)) continue;
    try {
      fs.mkdirSync(STORE, { recursive: true });
      fs.copyFileSync(path.join(TESTS, f), hedef);
      adopted.push(f);
    } catch { /* sahiplenme basarisizligi kosumu dusurmesin */ }
  }

  return { restored, adopted, skipped };
}
