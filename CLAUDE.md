# Homee QA — Claude Code çalışma notları

Bu repo **Homee** (Tepe Home redesign, `redesign-prod.test.tepehome.com.tr`) için Playwright E2E
regresyon suite'i ve yerel QA Paneli'ni barındırır. Mimari NadirGold QA suite'inden taşındı;
Homee'ye özgü farklar aşağıda **açıkça işaretli** — bunları bilmeden kod yazma.

## Hızlı komutlar

```bash
npm test                  # tüm testler (chromium, headless)
npm run test:guest        # misafir seti (01–09)
npm run test:member       # üye seti (20–25)
npm run test:sepet        # tek grup örneği (headed)
npm run panel             # QA paneli → http://localhost:4646
npm run report:create     # test-results/results.json → HTML rapor
npx playwright test tests/01-homepage.spec.ts --project=chromium --reporter=line
```

`workers: 1` (paralel yok), timeout 45s (`TEST_TIMEOUT` ile değişir), `trace: on-first-retry`,
`screenshot: only-on-failure`. Uzun rota süpürmeleri spec içinde `test.setTimeout()` ile arttırılır.

⚠️ **Rapor alacaksan `--reporter` FLAG'İ VERME.** CLI'dan verilen reporter listesi config'i ezer;
`--reporter=json` da `outputFile`'ı yoksayıp JSON'u **stdout'a** basar (line çıktısıyla karışır ve
bozulur). `test-results/results.json` isteyen her şey (rapor üreticileri, panel) config'in
reporter'larına ihtiyaç duyar → sadece `npx playwright test --project=chromium` koş.
Zorunlu hâlde: `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json` env'i ile ver.

⚠️ **İki koşumu aynı anda başlatma.** Playwright koşum başında `test-results/` dizinini
temizliyor; paralel iki koşum birbirinin kanıtlarını ve `results.json`'ını siler.
Sıralı koş, ya da ayrı `--output` dizini ver.

⚠️ **Bundled tarayıcı kurulu değil** — sistemdeki Chrome kullanılıyor (`channel: "chrome"`).
Geçici script yazarken de `chromium.launch({ channel: "chrome" })` kullan.

## Ortamlar

`.env` içindeki `HOMEE_ENV` aktif ortamı seçer: `test` | `staging` | `prod` | `local`.
`playwright.config.ts` buradan `BASE_URL_<ENV>` okur, yoksa hata verip durur.

| Ortam | URL | Not |
|---|---|---|
| test | `https://redesign-prod.test.tepehome.com.tr` | **Varsayılan.** Regresyonun koştuğu yer |
| staging / prod | (tanımlı değil) | Doldurulmadan koşulamaz |
| local | `http://localhost:3000` | |

## ⚠️ İKİ KATMANLI KİMLİK (en kritik fark)

Homee'de **iki ayrı giriş** var; karıştırmak en sık yapılan hata:

1. **Machinarium "Geçici Erişim" kapısı** — tüm site bunun arkasında.
   `GATE_USER` / `GATE_PASSWORD` (`admin` / `password123`). Cookie: `temporary_auth_verified` (~24 saat).
   **Paylaşılabilir, rotate olmuyor** → `playwright/.auth/<env>-gate.json`.
   Bu, misafir testlerinin varsayılan `storageState`'i.

2. **Tepe Home üye girişi** — `/giris`, `TEST_EMAIL` / `TEST_PASSWORD`.
   `auth_token` ~60 dk, `refresh_token` ~7 gün, **AMA KULLANIMDA ROTATE OLUYOR.**

### Üye storageState'i paylaşılamaz (ölçülmüş)

Kaydedilmiş bir üye state'ini **ilk açan context çalışır, ikincisi `/giris`'e düşer.**
Ölçüm: 1. context `h1="Hesabım"`, 2. ve 3. context `h1="Giriş Yap"`.

Bu yüzden NadirGold'un "tek state'i tüm testler paylaşır" deseni burada **kullanılamaz**.
Üye testleri `tests/fixtures.ts`'ten import eder ve her test kendi UI login'ini yapar (~8 sn):

```ts
import { test, expect } from "./fixtures";
test("...", async ({ memberPage }) => { /* girişi yapılmış izole sayfa */ });
```

`global-setup.ts` yine de kimlik bilgilerini doğrular (yanlış şifreyle koşum baştan patlar) ve
gerçek doğrulama yapar: sadece "login'e yönlenmedi mi" bakmaz, **sayfada kullanıcının
e-postasının göründüğünü** de assert eder.

## ⚠️ Homee seçici tuzakları (üçü de gerçek, üçü de zaman yakar)

1. **Türkçe `İ` + regex `/i` flag'i ÇALIŞMAZ.**
   `getByRole("button", { name: /KATEGORİLER/i })` → aria-label `"Kategoriler"` ile **eşleşmez**
   (JS `İ` U+0130'u `i`'ye case-fold etmez). Türkçe metinde **tam string** kullan:
   `getByRole("button", { name: "GİRİŞ YAP", exact: true })` veya `:has-text("KATEGORİLER")`.

2. **Header'ın görünmez ikizi var.** Her header butonu/linki DOM'da iki kez (sticky + normal),
   biri `display:none`. `.first()` görünmez olanı yakalar ve click timeout'una düşer.
   **Tüm seçicilerde `:visible` kullan:** `page.locator('button[aria-label="Sepet"]:visible').first()`

3. **`data-testid` HİÇ YOK**, class'lar Tailwind hash'li. Sıra: `aria-label` → `:has-text()` tam
   metin → `input[name=...]`. CSS attribute eşleşmesi harf duyarlı, gerekirse `[... i]` flag'i:
   `input[placeholder*="ara" i]`.

4. **404'te de HTTP 200 dönüyor.** Durum koduna güvenme; `BasePage.isNotFound()` DOM'dan bakar.

5. **Lazy içerik.** Ürün karuselleri scroll etmeden DOM'a girmiyor — kart sayan test önce
   `loadLazyContent()` çağırmalı, yoksa "0 kart" alır.

6. **Sepete ekleme hydration yarışı.** İlk tıklama sessizce kaybolabiliyor;
   `ProductPage.addToCart()` header badge'ini doğrular ve bir kez retry eder. Kendi başına
   `click` yapma.

7. **Sepet bazen bayat render dönüyor** — header badge'inde ürün varken liste boş geliyor.
   `CartPage.open()` çelişkiyi görürse bir kez reload eder; kendi başına `/sepet`e gitme.

8. **Hata mesajları kaybolan TOAST.** Yanlış şifre → "Lütfen e-posta adresinizi ya da şifrenizi
   kontrol edin." mesajı ~1.2 sn sonra çıkıp kayboluyor. Sabit bekleyip gövdeye bakan test mesajı
   KAÇIRIR — `LoginPage.submitAndCatchMessage()` gibi **poll eden** yardımcı kullan.

9. **Geçici script'i repo kökünde yaz** (`.probe.mjs`), scratchpad'de değil —
   `@playwright/test` modül çözümlemesi dosya konumuna göre çalışır. İş bitince sil.

## API katmanı (ileride API testi için)

FE'nin konuştuğu backend: `https://ecom-api.test.tepehome.com.tr` —
`POST /auth/login` yanlış kimlikle **401** döner. Kimlik token'ı FE tarafından
`/api/auth/get-token` (Next.js route) üzerinden alınıyor; `auth_token` / `refresh_token`
cookie olarak tutulur ve **refresh_token kullanımda rotate olur**.

## Repo konvansiyonları

```
tests/NN-shortname.spec.ts   # misafir 01–09, üye 20–25
tests/routes.ts              # rota envanteri (tek doğruluk kaynağı)
tests/known-issues.ts        # bilinen ürün hataları (HOMEE-00X)
tests/fixtures.ts            # memberPage fixture'ı (üye testleri buradan import eder)
pages/BasePage.ts            # header/footer/overlay/lazy/404 — diğer POM'lar bundan türer
pages/XxxPage.ts             # 12 POM (locator'lar readonly, method'lar async)
global-setup.ts              # kapı state'i + üye kimlik doğrulaması
panel/                       # QA paneli (server.mjs + public/index.html + runs.json)
panel-data/                  # verdict + kanıt (gitignore'da)
scripts/create-test-report.cjs
.claude/agents/              # 7 agent
```

**Test grupları:**
- `01–09` **misafir** — login gerektirmez, varsayılan kapı state'i ile koşar
- `20–25` **üye** — `memberPage` fixture'ı, her test kendi login'ini yapar
- `25` checkout — **ödeme adımına kadar gider, siparişi TAMAMLAMAZ**

## Sipariş guard'ı

`ALLOW_HOMEE_ORDERS=1` verilmedikçe `CheckoutPage.submitOrder()` hata fırlatır.
Varsayılan kapsam: checkout formu ve ödeme yöntemleri doğrulanır, **"ÖDEME YAP" butonuna basılmaz.**
Guard'ı kullanıcı açıkça istemeden kaldırma.

## Bilinen ürün hataları ve `test.fail()` deseni

`tests/known-issues.ts` bilinen hataları kaydeder; onları doğrulayan test `test.fail()` ile
işaretlenir. Playwright bu testin **başarısız olmasını bekler**:

- hata sürüyorsa → "beklenen şekilde başarısız", suite **yeşil** kalır
- hata düzeldiyse → "beklenmedik şekilde geçti" → suite **kırmızı** olur ve kaydı silmeye zorlar

Aynı mantığın liste hâli `tests/routes.ts` içinde: `KNOWN_BROKEN_ROUTES` (404 verenler) ve
`LISTING_EMPTY` (0 ürün dönen kategoriler). Bunlar düzelirse ilgili test fail eder — kasıtlı.

Raporlarken **bilinen hatayı gerçek başarısızlıkla karıştırma**: `expectedStatus === "failed"`
olan test "BİLİNEN HATA"dır. `scripts/create-test-report.cjs` bu ayrımı yapar.

## Test hijyeni (zorunlu)

- **Mutasyon yapan her test başlangıç durumunu geri alır** ve geri aldığını **ölçerek** doğrular
  (adres oluştur→sil, favori ekle→çıkar, sepet→boşalt).
- **Yıkıcı işlemde seçici daraltılır.** Onay modalındaki butonu global `.last()` ile arama —
  kart/modal konteynerine kilitle, tıklamadan önce hedefi assert et.
  Örnek: `AddressPage.deleteAddressTitled()`.
- **`/hesabim/profil` üzerindeki `HESABIMI SİL` ve `ŞİFREMİ DEĞİŞTİR` asla tıklanmaz.**
  POM'da locator olarak var (varlık assert'i için), tıklama yok.
- Test verisi oluşturursan ayırt edilebilir isim ver (`QA-ADRES-<timestamp>`) ve sonunda temizle.
- İletişim / bülten formları **gerçek gönderim yapmaz**, sadece validasyon doğrulanır.

## QA Paneli

`npm run panel` → `http://localhost:4646` (`PANEL_PORT` ile değişir).

Sağladıkları: whitelist'li koşum tetikleme (`panel/runs.json` — whitelist dışı komut çalışmaz),
SSE canlı log, son koşum sonuçları (bilinen hata ayrımıyla), verdict kaydı
(`panel-data/verdicts/<anahtar>.json`), kanıt görselleri, bilinen hata listesi,
Playwright HTML raporuna bağlantı.

NadirGold'daki Jira/Confluence katmanı **kasıtlı olarak yok**. Eklenecekse `/api/cards` ve
`/api/comment` uçları NadirGold panelindeki desenle yazılır (REST v3, ADF gövde).

## Agent'lar (`.claude/agents/`)

| Agent | Ne zaman |
|---|---|
| `homee-explorer` | "nerede tanımlı", "hangi dosyalar X kullanıyor" — salt okuma arama |
| `homee-planner` | yeni test/akış/refactor planı |
| `homee-pom-generator` | yeni sayfa için POM iskeleti (sayfayı gerçekten açar) |
| `homee-route-auditor` | rota/link sağlığı denetimi, `routes.ts` baseline hizalama |
| `homee-env-switcher` | ortam geçişi, kapı/üye oturum kurulumu |
| `flaky-analyzer` | kararsız test tespiti, N kez koşum |
| `homee-report-builder` | HTML/PDF koşum raporu |

Agent dosyaları repo bilgisini prompt'a gömer — keşifle zaman harcamasınlar diye.
Yeni bir konvansiyon eklersen ilgili agent'ı da güncelle.
