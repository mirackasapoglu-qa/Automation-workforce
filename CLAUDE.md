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
   `CartPage.open()` çelişkiyi görürse reload eder (bkz. madde 12); kendi başına `/sepet`e gitme.

8. **Hata mesajları kaybolan TOAST.** Yanlış şifre → "Lütfen e-posta adresinizi ya da şifrenizi
   kontrol edin." mesajı ~1.2 sn sonra çıkıp kayboluyor. Sabit bekleyip gövdeye bakan test mesajı
   KAÇIRIR — `LoginPage.submitAndCatchMessage()` gibi **poll eden** yardımcı kullan.

9. **Geçici script'i repo kökünde yaz** (`.probe.mjs`), scratchpad'de değil —
   `@playwright/test` modül çözümlemesi dosya konumuna göre çalışır. İş bitince sil.

10. **`/odeme` bölüm başlıkları:** h2 olarak "İletişim Bilgileri", "Teslimat Adresi
    Bilgileri", **"Ödeme Bilgileri"**, "Sipariş Özeti". "Ödeme yöntemi" diye bir başlık
    YOK — POM 2026-08-22'ye kadar onu arıyordu ve hiç eşleşmiyordu.

11. **Checkout checkbox'larının `name`'i yok, ID ile bağla:** `#checkout-billing-same`
    (fatura adresi, varsayılan işaretli) ve `#checkout-contracts-accepted` (sözleşme onayı).
    `input[type="checkbox"]`'a düşen seçici İLK kutuyu (fatura) yakalar → sözleşme hiç
    işaretlenmez, "ÖDEME YAP" disabled kalır ve sebebi görünmez. Sözleşme input'u `sr-only`
    1x1 olduğu için `check()` timeout'a düşebilir; `focus()` + `Space` çalışıyor
    (`CheckoutPage.acceptContracts()` bunu zaten yapıyor).
    Kart alanları: `#checkout-card-number` / `-expiry` / `-cvc` / `-holder`.

12. **`/sepet`'te "boş sepet" kararını ASLA DOM'dan verme — API'ye sor.**
    Sayfa, basket yanıtı `items: 1` döndükten SONRA bile saniyelerce (ölçüm: ~15 sn'ye kadar)
    `badge 0` + "Sepetiniz boş" gösterebiliyor; satır sonradan, navigasyon olmadan geliyor.
    Bu yüzden `badge === 0` veya "Sepetiniz boş" metni **boşluk kanıtı değildir** — suite
    2026-08-22'ye kadar tam bu yüzden her koşumda 1-2 case kaybediyordu.
    `CartPage` artık navigasyondan önce bir response dinleyicisi kuruyor (`watchBasket()`)
    ve boşluğa yalnızca API 0 satır bildirirse inanıyor; API ürün derken satır gelmezse
    sessizce geçmiyor, hata fırlatıyor. `clear()` de aynı doğrulamayı yapıyor (yoksa sepette
    ürün bırakıp SONRAKİ testi düşürüyordu). Kendi başına `/sepet`e gitme, `CartPage.open()` kullan.
    Ayrıca sipariş özeti ("Ara toplam") satırlardan sonra boyanıyor; para okuyucuları
    (`moneyNear`, `summaryTotal`) bu yüzden poll ediyor.

13. **Sepette adet kontrolleri:** adet 1'de "Azalt" **kasıtlı disabled**; satın alma limiti
    dolu üründe artırma `PUT /v1/baskets/<id>` → **406** alır ve kaybolan bir toast
    ("Bu üründen en fazla 1 adet ekleyebilirsiniz.") gösterilir. İkisi de doğru davranış —
    hata sanılmasın. `deneme` (1099766) ürününün limiti 1, `sapTest` (1099765) limitsiz.

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

## Koşum sonucunu case defterine işlemek

Panelin "Case'ler" sekmesi case listesini **spec dosyalarını parse ederek** kurar —
yeni test yazınca elle kayıt gerekmez, otomatik görünür. Ama koşum geçmişi
(`panel-data/case-history.json`) ayrı: eskiden yalnızca **panelden** tetiklenen koşumlar
deftere işleniyordu, CLI koşumları kaybediliyordu. Artık:

```bash
npx playwright test tests/06-cart.spec.ts --project=chromium   # --reporter VERME
npm run history:merge                                          # koşumdan HEMEN SONRA
```

⚠️ İki tuzak (ikisi de ölçüldü 2026-08-22):
1. **`--reporter=line` config'deki json reporter'ı devre dışı bırakır** →
   `test-results/results.json` hiç yazılmaz, işlenecek sonuç kalmaz.
   `--reporter=line,json` de yetmez: `outputFile` ayarı da düştüğü için JSON stdout'a akar.
   Defter işlenecekse **`--reporter` bayrağını hiç kullanma.**
2. **`playwright test --list` de `results.json`'ı EZER** ve testleri sonuçsuz yazar.
   `mergeHistory()` artık bu satırları atlıyor (`status === "unknown"`), ama `--list`
   sonrası gerçek sonuç kaybolur — merge'i koşumun hemen ardından çalıştır.

Defter mantığı `panel/case-history.mjs` içinde (panel ve CLI aynı fonksiyonu çağırır);
case başına son `HISTORY_KEEP=20` koşum saklanır, `0ms + hatasız failed` kayıtları
"ölçüm değil" sayılıp orana katılmaz.

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

## Ayağa kaldırma

**"Panel ayağa kaldır" = `npm run up`** — panel ve landing/onboarding sitesi BİRLİKTE kalkar.
Sadece paneli isteyen özel bir durum yoksa `npm run panel` tek başına kullanılmaz.

| Adres | Ne |
|---|---|
| `http://localhost:4646` | QA Paneli |
| `http://localhost:4647` | site proxy (iframe) |
| `http://localhost:4321/` | Landing |
| `http://localhost:4321/onboarding` | Başlangıç rehberi |

`scripts/up.mjs` detayları: landing kaynağı `../homee-panel-site` (`LANDING_DIR` ile
değişir), **dev sunucusu değil `vite preview`** kullanılır — gösterime giden şey
production build'i olsun diye; `dist/` yoksa önce build alınır. Dolu portta o servis
başlatılmaz (çalışan süreci öldürmez). Ctrl-C ikisini birden kapatır.

⚠️ Port kontrolü IPv4 **ve** IPv6'yı birlikte dener: `vite preview` yalnızca `::1`'e
bağlanabiliyor, sadece `127.0.0.1` denemek "açılmadı" diye yanlış uyarı basıyordu.

### Kotasız tasarım diff'i

`npm run figma:diff -- --list` → önbellekteki **26 ekran frame'i** (font/punto/metin katmanlarıyla).
`npm run figma:diff -- --frame 1082:193 --route /magazalar` → canlıyı yakalar, diff'i basar.
**Figma API'sine hiç çağrı yapmaz** — `panel-data/figma-cache/` içindeki düğüm ağaçlarını okur.

Script'e üç ders gömülü, çıkarma:
1. **Türkçe normalizasyon**: `"İ".toLowerCase()` → `i` + birleşik nokta verir; naif karşılaştırma
   "SİPARİŞLERİM"i eşleştiremez. Tek koşumda **12 yanlış pozitif** üretti. Çözüm: NFD + `\p{Mn}` at, sonra küçült.
2. **Durum eşitleme**: boş sepet ile ürünlü tasarım frame'ini karşılaştırmak 14 uydurma "eksik" üretir.
   `--state member` ile üye oturumu kullanılır.
3. **Dinamik içerik**: tasarımda örnek veri var (ürün adı, fiyat, mağaza adı). Fiyat/sayı içerenler
   otomatik ayıklanır, kalanlar için `--ignore <regex>`.

Etkisi ölçüldü: aynı frame'de elle yapılan diff 32–36 "eksik" verirken script **6** veriyor.

## QA Paneli

**Panel SIFIR çalışma-zamanı bağımlılığıyla açılır — `node_modules` hiç olmasa bile.**
(Doğrulandı 2026-08-22: panel boş bir dizine kopyalanıp `node panel/server.mjs` ile
açıldı, `/api/specs` → 200.) İki değişiklik bunu sağlıyor:

1. **`dotenv` kaldırıldı** → `env.mjs` içindeki `loadEnv()`; altında Node'un yerleşik
   `process.loadEnvFile()`'ı var. Ölçülen iki davranış: (a) mevcut ortam değişkenini
   **ezmiyor**, yani `ALLOW_HOMEE_ORDERS=1 npx playwright test …` çalışmaya devam eder
   (guard buna bağlı olduğu için ölçmeden dokunulmadı); (b) `.env` yoksa dotenv'in
   aksine **ENOENT fırlatıyor** — bu yüzden çağrı guard'lı, dosya yoksa uygulama açılır.
   Yeni bir dosya env okuyacaksa `import { loadEnv } from "./env.mjs"` kullan, dotenv ekleme.
2. **Model çağrısı tamamen kalktı** — panel artık AI için **hiçbir bağımlılık ve
   kimlik istemiyor.** Eskiden `@anthropic-ai/sdk` `optionalDependencies`'te durur ve
   tembel yüklenirdi (statik import, paket kurulu olmayan bir projede paneli
   **açılışta** düşürüyordu — bozulan tek bir buton değil panelin tamamıydı). Şimdi
   paket de yok: `npm uninstall @anthropic-ai/sdk` ile kaldırıldı. Aynı tuzak `dotenv`
   için de vardı — `devDependencies`'te durduğu hâlde çalışma zamanında import ediliyordu.

### Jira: kart → doğrulama hattı

Kart detayı (`/api/jira/card/<KEY>`) dört şeyi tek ekrana getiriyor: kartın metni,
**kartı doğrulayan koşumlar** (tek tıkla tetiklenir), yorumlar, statü geçişleri.
Üstüne eklenen dört yetenek:

| Ne | Uç | Not |
|---|---|---|
| Kart → test case üretimi (**tek tık**) | `POST /api/jira/testcases/generate` | Kartın özeti + açıklaması + son 5 yorumu + hedef düğümün bağlamı tek isteme girer; yazma yine `/api/scope/testcases/apply` (tek yazma yolu). Üretilen case'e `jiraKey` işlenir. |
| Koşum sonucu → yorum taslağı | `GET /api/jira/comment-draft?key=` | Satırlar **kartın spec'lerine göre süzülür**; süzgeç boşsa "bu kartın spec'lerinden test yok" uyarısı basar. |
| Verdict → yorum taslağı | `GET /api/jira/verdict-draft?verdict=` | Verdict kaydına `card` alanı eklendi; Verdict tablosundaki kart düğmesi Jira sekmesine geçip taslağı doldurur. |
| Kart ↔ spec eşleme editörü | `GET/POST /api/jira/map` | Profil kaynak; panelden yapılan düzenleme `panel-data/card-specs.json`'a düşer ve profille **birleşir**. `snippet()` profile yapıştırılacak metni üretir. |

**Tek tık üretim nasıl çalışıyor:** panel istemi kurar ve **makinede kurulu Claude
Code CLI'sini** çağırır (`claude -p --output-format json --allowedTools ""`,
`panel/claude-cli.mjs`) — API anahtarı gerekmez, CLI kullanıcının oturumuyla
kimliklidir. Araçlar KAPALI (modelin repoda dolaşmasına gerek yok, yan etki riski
var) ve cwd geçici dizin: repo kökünde çağrılınca CLI proje CLAUDE.md'sini yükleyip
her isteğe ~11k token ekliyor. Ölçüm: 3 case ≈ 24–27 sn, ≈ $0.13–0.16.

Kopyala-yapıştır ucu (`/prompt` + `/apply`) **kaldırılmadı**: CLI yoksa (501 + kurulum
ipucu), kimlik düşmüşse ya da çağrı zaman aşımına uğrarsa geri dönülecek yol kalmalı.

⚠️ Model **aralıklı olarak bozuk JSON** üretiyor (metin içinde kaçışlı çift tırnak;
aynı istem bir kere geçerli bir kere bozuk çıktı). İki katman: istemde "metin içinde
çift tırnak kullanma" kuralı + ayrıştırma patlarsa **bir kez düzeltici tekrar**
(`<olay>-retry` olarak denetim kaydına düşer).

**⚠️ Taslak üretimi göndermeden AYRI.** Hiçbiri Jira'ya yazmaz; metin `#jComment`e
dolar, gönderme tek yerden (`POST /api/jira/comment`) ve onayla olur. Gerekçe: yorum
kalıcı ve geri alınamaz bir iz — yanlış ortamda/yanlış filtreyle koşulmuş bir sonucu
otomatik yazmak kartın altına çöp bırakır.

`route-map.mjs → CARD_SPECS` artık **sabit değil fonksiyon**: eşleme düzenlemesi
panel yeniden başlatılmadan etkili olsun diye. Sabit nesne olduğu sürece düzenleme
sessizce eski eşlemeyle koşum tetikliyordu.

### AI özellikleri: anahtarsız yol (Claude Code'a kopyala-yapıştır)

Panelin üç AI özelliği de (**Senaryo öner**, **perf AI yorumu**, **kapsam ağacında test
case üretimi**) modeli KENDİSİ çağırmaz. Gerekçe: kullanıcı modeli zaten Claude Code'da
çalıştırıyor, panele ikinci bir kimlik (`ANTHROPIC_API_KEY` ya da `ant auth login`
profili) koymanın anlamı yok — anahtar yoksa üç özellik birden kapalı kalıyordu.

Desen her üçünde aynı, iki uçlu:

| Özellik | İstem ucu | Uygulama ucu | Kapı |
|---|---|---|---|
| Senaryo öner | `POST /api/scenarios/prompt` | `POST /api/scenarios/apply` | `scenario-suggest.mjs → gate()` (3 katman) |
| Perf yorumu | `POST /api/perf/prompt` | `POST /api/perf/apply` | `perf-analyze.mjs → gate()` (uydurma rota eler) |
| Test case üretimi | `POST /api/scope/testcases/prompt` | `.../apply` | `testcase-gen.mjs → applyCases()` (taslak işareti) |

İstemcide tek yardımcı var: `index.html → promptFlow()` (kopyala + yapıştır + uygula),
kapsam ağacında karşılığı `scope/js/testcase-request.js`.

**⚠️ Kapı VERİ yolunda, çağrı yolunda değil.** Yanıt elle yapıştırıldığı için bu daha da
kritik: `apply` uçları bağlamı (paket listesi, dayanak kaynakları, perf ölçümü)
**istemciden almaz, sunucuda yeniden okur** — yoksa uydurma bir paket/rota listesi
göndererek kapı geçilebilirdi. Ölçüldü: 4 senaryoluk yapıştırmada 1 kabul, 3 elendi
(boş oracleRef · bilinmeyen kaynak · bağlam dışı suiteId).

`/api/scenarios/context` artık tek önkoşul raporluyor: `ready` (bağlamda dayanak kaynağı
var mı). Eski `sdkReady`/`authReady` alanları ve `NO_SDK`/`NO_CREDENTIALS` kodları kalktı;
kaynak yoksa istem ucu `NO_ORACLE` döner — Kural 1 uygulanamıyorsa öneri hiç üretilmez.

Connector tarafında `ai` yeteneği `connectors/claude-code.mjs`'e bağlı (eski
`anthropic.mjs` silindi): kimlik yoklamaz, durumu koşulsuz `ok`.

### Proje profili (panel çekirdeği proje adı bilmez)

**Değişmez:** `panel/*.mjs` ve `panel/public/index.html` içinde proje adı, Jira anahtarı,
Figma dosyası, host ya da rota/kart eşlemesi **geçmez**. Hepsi tek yerde:

```
panel/projects/homee.mjs   # proje profili — tüm proje bilgisi burada
panel/project.mjs          # yükleyici (çekirdek profili buradan okur)
panel/runs.json            # koşum whitelist'i — .env gibi proje başına değişir
```

`npm run panel:check` bunu **ölçerek** doğrular: profilden proje işaretlerini çıkarır
(profil adı, Jira anahtarı, host, dayanak önekleri) ve çekirdekte arar; bulursa çıkış
kodu 1. Yeni bir proje sabiti eklerken çekirdeğe değil profile yaz.

Profilde ne var: `id` · `title` · `env` (hangi ortam değişkeni, sipariş guard'ının adı) ·
`issuePrefixes` / `knownIssuePrefix` · `apiHostMatch` · `jira` (host, proje, epic, tip id,
özel alanlar, `views` JQL'leri) · `figma` (dosya + rota→frame) · `routes`
(`rules`, `specRuns`, `cardSpecs`) · `quickRoutes` · `scenarioPresets`.

Başka projeye taşıma: `panel/` + `env.mjs`'i kopyala, `panel/projects/<yeni>.mjs` yaz,
`panel/runs.json`'ı o suite'in komutlarıyla değiştir. Profil dizininde tek dosya varsa
otomatik seçilir; birden fazlaysa `PANEL_PROJECT` şart (tahmin edilmez).

Ortam değişkeni adları da profilden: çekirdek `HOMEE_ENV` / `ALLOW_HOMEE_ORDERS`
adlarını bilmez, `env.var` / `env.ordersVar` üzerinden okur. `PANEL_ENV` ve
`ALLOW_ORDERS` her zaman ezer. ⚠️ Sipariş guard'ının kendisi suite tarafında
(`26-order-transfer.spec.ts`); panel yalnızca **gösterir**, profilde adı değiştirmek
guard'ı bozar.

Panel ↔ iframe `postMessage` protokolü de projeden bağımsız: `qa-nav`, `qa-scroll`,
`qa-rec*`, `data-qa-assert-hover` (eski `homee-*` adları 2026-08-24'te değişti).
localStorage anahtarları `qa-panel-*` — tema/headless tercihi bir kez sıfırlandı.

`npm run panel` → `http://localhost:4646` (`PANEL_PORT` ile değişir).

**"Case'ler" sekmesi:** 15 spec, her biri açılır kapanır dropdown; içinde case başlıkları,
son bilinen durumu (geçti / bilinen hata / başarısız / koşulmadı), hata mesajının ilk satırı,
işaretler (veri değiştirir · HOMEE-00X · koşullu · parametrik), spec'in Jira kartları ve her
case'in yanında **"kos"** butonu (parametreli koşumu `-g "<başlık>"` ile o tek case'e kilitler).
Arama kutusu başlık/spec/HOMEE kodu/kart üzerinden filtreler; durum filtresi de var.

Case durumları `panel-data/case-history.json`'da **birleşerek** tutulur — tek bir case'i koşmak
diğerlerinin durumunu silmez (`results.json` her koşumda sıfırlanır, geçmiş sıfırlanmaz).
Envanter `tests/*.spec.ts` dosyalarından parse edilir; elle liste tutulmaz.

Her butonun yanında bir **ⓘ** var: tıklanınca butonun ne yaptığını, yan etkisini
(veri değiştirir mi, sipariş açar mı) ve tahmini süresini gösterir. Koşum açıklamaları
`panel/runs.json` içindeki `tip` alanından gelir — komutun yanında dursun diye orada tutulur;
statik butonların açıklamaları `panel/public/index.html` içindeki `TIPS` sözlüğünde.

⚠️ Arayüzde `hidden` bayrağı kullanan bir öğeye **inline `display:` verme** — `hidden`
UA stilindeki `display:none` ile çalışır, inline stil onu ezer ve öğe gizlenmez
(`#dShots` bu yüzden boş görsel kolonları gösteriyordu; kural CSS'e taşındı).

### Güvenlik modeli (panel yerel bir HTTP sunucusu — gezdiğin her sayfa ona istek atabilir)

- **Serbest komut YOK.** Ya `panel/runs.json` whitelist'indeki koşum, ya da **parametreli koşum**:
  spec adları `tests/` altındaki dosyalarla doğrulanır, `-g` filtresi ayrı argv elemanı olarak
  geçer, `--repeat-each` 1–10, `--timeout` 10.000–300.000 ms ile sınırlı, `workers=1` sabit.
  `spawn(..., { shell: false })` → kabuk hiç devreye girmez, `;` `&&` `$( )` etkisiz
  (ölçüldü: `shell:false` → `"$(whoami)"` literal kalır, `shell:true` → `macbookair`).
- **Yazma uçları token'lı.** Panel açılışta oturum token'ı üretip `index.html`'e enjekte eder;
  `/api/run`, `/api/stop`, `/api/verdicts`, `/api/jira/*`, `/api/figma/diff` `x-panel-token` ister.
  Başka origin token'ı okuyamaz (HTML'i okuyamaz) → CSRF kapanır. `Origin` verilmişse
  `localhost:<port>` olmak zorunda.
- **Denetim kaydı:** her koşum/durdurma ve her Jira yazması `panel-data/command-log.jsonl`'a
  tam argv ile yazılır.
- **Önizleme:** parametreli koşum, çalıştırmadan önce üretilecek tam komutu gösterir
  (`POST /api/run/preview`, token gerektirmez çünkü yan etkisi yok).

⚠️ **Koşum argümanlarına `--reporter` EKLEME** (ne `runs.json`'da ne parametreli koşumda):
CLI reporter'ı config'i ezer ve `test-results/results.json` yazılmaz → "Son sonuçlar" sekmesi
ve rapor üreticileri boş kalır.

Sağladıkları: whitelist'li koşum tetikleme (`panel/runs.json` — whitelist dışı komut çalışmaz),
SSE canlı log, son koşum sonuçları (bilinen hata ayrımıyla), verdict kaydı
(`panel-data/verdicts/<anahtar>.json`), kanıt görselleri, bilinen hata listesi,
Playwright HTML raporuna bağlantı.

NadirGold'daki Jira/Confluence katmanı **kasıtlı olarak yok**. Eklenecekse `/api/cards` ve
`/api/comment` uçları NadirGold panelindeki desenle yazılır (REST v3, ADF gövde).

## Panel içinde canlı site (iframe) ve rotadan tetikleme

Site `x-frame-options: SAMEORIGIN` gönderdiği için panele doğrudan iframe olarak gömülemez.
Bu yüzden panel kendi **proxy'sini** açar (`panel/proxy.mjs`, varsayılan port `PANEL_PORT + 1` = 4647):

- frame engelleyen başlıkları söker (`x-frame-options`, `content-security-policy`)
- "Geçici Erişim" cookie'sini enjekte eder → kapı ekranı çıkmaz
- `Set-Cookie`'den `Domain=` ve `Secure` bayraklarını temizler → localhost/http'de tutunur
- redirect `Location`'ını proxy'ye çevirir
- HTML yanıtlarına küçük bir script enjekte eder: iframe içindeki her navigasyonu
  `postMessage` ile panele bildirir (panel 4646 / proxy 4647 farklı origin olduğu için
  `contentWindow.location` okunamaz)

Sitenin API'si (`ecom-api.test.tepehome.com.tr`) `access-control-allow-origin: *` döndüğü için
iframe içinden sepet/login çağrıları da çalışır — ölçüldü.

**Rotadan tetikleme:** `panel/route-map.mjs` iframe'deki yolu bir whitelist koşumuna eşler
(`/sepet` → `test-sepet`, `*-p-*` → `test-urun`, `/hesabim/adreslerim` → `test-adres` …) ve
ilgili Jira kartlarını gösterir. "Bu sayfayı test et" butonu **yalnızca whitelist'teki**
koşumu başlatır; serbest komut çalıştırılamaz.

⚠️ iframe, **testin tarayıcısı değildir** — ayrı bir oturumdur. Koşum sırasında iframe testin
adımlarını aynalamaz; testin kendi tarayıcısını görmek için `--headed` koşum (npm script'leri
zaten headed) ya da CDP screencast aynası gerekir.

## Tasarım diff (Figma)

Kimlik: `~/.figma-credentials` → `FIGMA_TOKEN`. Dosya: **Tepe Home UI/UX Design**
(`WRyAE2K87JyYZHJlH18OfD`). Kart→frame `node-id`'leri Jira açıklamalarından çıkarıldı,
rota eşlemesi `panel/figma-map.mjs`.

```bash
node scripts/figma-diff.mjs --node 140:2705 --route / --frame "Home"   --out figma-diff-main.html --json figma-diff-main.json
```

Panelden: **Tasarım diff** sekmesi ya da **Site (canlı)** sekmesindeki "Tasarim diff" butonu
(açık rotanın frame'ini kullanır). Koşum ~45 sn; canlı log SSE ile akar, rapor panelde gömülü açılır.

**Piksel diff YAPILMIYOR** (tasarım↔kod arasında gürültü: font hinting, gerçek ürün görselleri,
dinamik fiyat). Üç ölçüm: metin varlığı · spec (font/boyut/kalınlık/renk) · yan yana + saydamlık.

### Figma rate limit: istek SAYISI, payload değil

Kullandığımız üç uç (`GET /v1/files`, `/v1/files/:key/nodes`, `/v1/images`) hepsi **Tier 1**
ve **tek sayaç** paylaşıyor. Limit **koltuk tipine** bağlı:

| Koltuk | Tier 1 REST | MCP |
|---|---|---|
| View / Collab | **6 / ay** | 6 / ay |
| Dev / Full (Professional) | **10-20 / dakika** | 200/gün, 15/dk |

⚠️ **7,2 MB'lık çağrı da 33 KB'lık çağrı da 1 istek.** Bu yüzden eski doktrin
("payload pahalı, sığ sorgu ucuz, iki adımda git") **yanlıştı** — 1 istek yerine 2
harcıyordu. 19 Ağustos'ta bütçeyi yakan şey dosya boyutu değil, çağrı sayısıydı.
Aynı sebeple **panelin preflight yoklaması** başlı başına bir sızıntıydı: 15 dakika
önbellekli canlı probe, ayda 6 istekte panel açık dururken 90 dakikada bütçeyi bitirir.
Kaldırıldı (bkz. `panel/figma-quota.mjs`).

**Doğru strateji — istek sayısını düşür:**
1. `frameId` profilde varsa canvas çözme yok, doğrudan frame ağacı → **1 istek**
   (`figma-diff.mjs` bunu otomatik yapıyor: "profilden: ... — sığ sorgu atlandı")
2. Önbellekte varsa → **0 istek**
3. Çoklu rota → `figma-prewarm.mjs`: `ids=f1,...,f10` ile **10 rota 3 istekte**
   (rota başına ayrı koşum 20+ istek eder)

```bash
node scripts/figma-prewarm.mjs                 # 10 rota, 3 istek, bekleme yok
node scripts/figma-prewarm.mjs --delay 6       # View/Collab koltukta yavaşlat
node scripts/figma-prewarm.mjs --renders-only  # yalnız PNG, ağaç çağrısı yok
```

Önbellek `panel-data/figma-cache/` içinde **1 yıl** (`FIGMA_CACHE_TTL_MS`). Süre kasıtlı
olarak uzun: kota kapalıyken bayatlayan önbellek yenilenemiyor ve diff komple durur.
**Tasarım değişince elle sil** — `GET /v1/files/:key?depth=1` ile `lastModified`e bak
(1 istek). 23 Ağustos'taki değişikliği 24'üne kadar fark etmedik, iki diff bayat ağaca
karşı ölçülmüştü; bayat dosyalar `figma-cache/bayat-2026-08-19/` altında arşivde.

⚠️ **Rate limit HESAP başına, token başına değil** (ölçüldü: aynı hesabın ikinci token'ı da
aynı `retry-after` ile 429 verdi). Yeni token üretmek işe yaramaz; koltuğu yükselt.

**429 durumu nereden okunur:** `panel-data/quota-notes.json`. Yoklama YOK — gerçek çağrı
yapan her yer sonucu not ediyor (`panel/figma-quota.mjs -> noteResponse`), panel nottan
okuyor. Üst şeritte `Figma /files` ve `Figma /images` satırları.

```bash
node -e "import('./panel/preflight.mjs').then(async m=>{for(const c of await m.preflight())console.log(c.state,c.label,c.detail)})"
```

**API'siz çare — elle export:** bütçe tükendiğinde yan yana görünümü PNG ile besle:
```bash
node scripts/figma-import-render.mjs --list                                # rotalar ve durum
node scripts/figma-import-render.mjs --route /sepet --png ~/Downloads/x.png
```
Figma arayüzünde frame'i seç → Export → PNG 1x. `figma-render` API'den önce bu PNG'ye bakar.
Sınır: yalnızca **görsel** karşılaştırmayı açar; spec/metin diff'i düğüm ağacı gerektirir.

**Bütçe açıldığında tek seferde hazırla:**
```bash
node scripts/figma-prewarm.mjs                    # tüm rotalar, 6 sn aralıkla
node scripts/figma-prewarm.mjs --only "My Cart"   # tek sayfa
```
Tamamlananı atlar, 429 görünce durur ve kaldığı yerden devam edebilir.
`GET /api/figma/cache` hangi rotanın hazır olduğunu söyler; panel hata mesajında da listeler.

⚠️ **429 cezası uzun.** `retry-after` gün mertebesinde dönüyor (ölçüldü: 396.900 ve 372.976 sn).
View/Collab koltukta ayda 6 istek olduğu için pencere neredeyse aylık. Bu yüzden:
- `/v1/files/:key?ids=<node>` ucu kullanılıyor (`/nodes` ile aynı sayaç, aynı tier)
- `--refresh` önbelleği atlar — **istek harcar, tasarım gerçekten değiştiyse kullan**

**İşaretli snapshot (kırmızı kutu):** diff, farkları kutulayıp numaralandırarak iki PNG üretir —
`<slug>-tasarim-isaretli.png` (canlıda **bulunamayan** metinlerin Figma'daki yeri) ve
`<slug>-canli-isaretli.png` (spec farkı olan öğelerin canlıdaki yeri). Numaralar rapordaki
1. ve 2. tablonun `#` kolonuyla eşleşir. Doğrudan Jira'ya kanıt olarak eklenebilir.
Panelde **Tasarım diff** sekmesinde yan yana, kaydırılabilir kolonlarda gösterilir.

Eşleştirme tuzakları ve çözümleri:
- Aynı metin sayfada birden çok yerde geçiyor → **göreli dikey konuma en yakın** eşleşme seçilir
  (yoksa mega menüdeki "SALON" ile hero'daki karışıyordu)
- Mega menü/drawer içeriği kapalıyken DOM'da yok → menü **gerçekten açılıp** metinleri toplanır
- Dinamik/temsili içerik (fiyat, ürün adı, "Hint message goes here") katman adı ve metin
  kalıbıyla ayıklanır ve "gürültü" kovasına konur

## Jira

⚠️ **Kimlik dosyasındaki host YANLIŞ Jira'yı gösterir.** `~/.jira-credentials` içinde
`JIRA_HOST=https://nadirgold.atlassian.net` yazıyor — o NadirGold projesinin host'u.
Homee/MAC işleri **`https://machinarium.atlassian.net`** üzerinde; `panel/jira.mjs` host'u
kendi içinde sabitliyor. Elle REST çağrısı yazarken kimlik dosyasının host'unu kullanma,
sessizce 0 sonuç alırsın (ölçüldü 2026-08-22: `key = MAC-7268` bile boş döndü).

⚠️ **Statü geçişine iliştirilen yorum sessizce kaybolur.** `POST /transitions` gövdesine
`update.comment[].add` koymak hata vermez ama geçiş ekranında yorum alanı tanımlı
değilse yorum hiç yazılmaz (ölçüldü 2026-08-22: MAC-7248/7251 geçti, gerekçe kayboldu).
`panel/jira.mjs → transition()` artık yorumu **ayrı** `postComment` çağrısıyla yazıyor.

⚠️ **Panelin "Test kolonu" görünümü alt görevleri kaçırıyor.** `VIEWS.test` JQL'i
`parent = <epic>` diyor; Test statüsündeki alt görevler epic'in değil hikâyelerin çocuğu
oluyor (ör. MAC-7248/7251 → üst kart MAC-7074) ve panelde hiç görünmüyor.



Kimlik: `~/.jira-credentials` (`JIRA_EMAIL`, `JIRA_TOKEN`). **Host NadirGold'dan farklı:**
`https://machinarium.atlassian.net` (nadirgold.atlassian.net'te Tepe projesi YOK).

**Kapsam:** `MAC` projesi → **`MAC-7035 "Tepe - Redesign"`** epic'i, 19 alt kart.
`TEP` (TepeHome) projesi ayrıca var ama redesign işleri MAC'te izleniyor.
Kartlarda `Project` özel alanı (`customfield_10072`) = `TEPEHOME`, sprint alanı `customfield_10020`.

- Issue okuma/yorum/geçiş: REST **v3**. Yorum gövdesi **ADF** olmalı (`panel/jira.mjs` → `textToAdf`).
- **JQL'de issue type adı İNGİLİZCE**: `issuetype = Bug` çalışır, `issuetype = "Hata"` **0 sonuç döner**
  (arayüz Türkçe gösteriyor: Görev / Hata / Epik).
- Arama: `/rest/api/3/search/jql`, sayfalama `nextPageToken` (`isLast` bitişi belirtir); **`total` alanı yok**.
- Statü geçiş id'leri projede ortak:
  `11` Yapılacaklar · `21` Devam Ediyor · `31` Tamam · `41` Test · `51` Ready For Deploy ·
  `61` Ready For Release · `71` Blocked · `81` Failed · `91` Test Blocked · `5` Move to Release for Stage
- Bug isim kalıbı (ekibin kullandığı): **`TEPE - Redesign > <Alan> > <problem>`**
- Kart ↔ spec eşlemesi: **`tests/jira-map.ts`** (`CARD_MAP`). Yeni kart geldiğinde buraya ekle.

### Kart açma (2026-08-20'de 14 kart açarken öğrenilenler)

**Oluşturma ile sorgulama farklı ad ister — en can sıkıcı tuzak bu:**

| İşlem | Doğru | Yanlış |
|---|---|---|
| `POST /rest/api/3/issue` | `issuetype: { id: "10009" }` | `{ name: "Bug" }` → 400 |
| JQL | `issuetype = Bug` | `issuetype = Hata` → **0 sonuç** |

`10009` = "Hata" tipinin id'si. Ada güvenmek iki yönden de kırılgan; `panel/jira.mjs` → `JIRA.bugTypeId`.

**`customfield_10072` ("Project") ZORUNLU.** Verilmezse oluşturma
`400 "Project: Project gerekiyor."` ile düşer — hata mesajı `project` alanını suçluyor gibi görünür
ama kastettiği bu özel alandır. Değerimiz **TEPEHOME**, id **`10136`**.

**`assignee` görünen adla ÇALIŞMAZ**, accountId şart — hem JQL'de hem API'de:
`assignee = "Ahmet Baş"` → 0 sonuç. Ahmet Baş = `712020:599f45e8-6b35-4b92-91cf-e60095e05d77`.
Atanabilir kullanıcılar: `/rest/api/3/user/assignable/search?project=MAC`
(`/user/search` bu instance'ta boş dönüyor). Dikkat: listede **Ahmet Ertuğral** da var, karıştırma.
Atamayı oluşturma gövdesinde göndermek yerine ayrı uçtan yap: `PUT /issue/<KEY>/assignee`.

**Ek yükleme** multipart + `X-Atlassian-Token: no-check` ister (`panel/jira.mjs` → `attachFile`).
⚠️ Görseli açıklamanın **içine gömmek çalışmıyor**: ADF `mediaSingle`/`media` düğümü ek id'siyle
`ATTACHMENT_VALIDATION_ERROR`, `collection` olmadan `INVALID_INPUT` veriyor. Bunun yerine
`/rest/api/3/attachment/content/<id>` adresine **tıklanabilir link** olarak yorumla.

**⚠️ Konu SİLME izni yok (403).** Doğrulama için kart açıp sonra silmeyi planlama — silemezsin.
Smoke test gerekiyorsa başlığa `[GEÇERSİZ - OTOMASYON TEST KAYDI]` yaz, atamayı kaldır,
`31` (Tamam) geçişine al ve yorumla açıkla.

**Yazma kuralı:** `postComment`, `transition`, `createBug` uçları panelde **onay diyaloğu arkasında**;
otomatik yazma yok. Bir koşum sonucunu Jira'ya yazmadan önce kullanıcıya göster.

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

Panel Jira uçları: `/api/jira/cards?view=test|blocked|epic|bugs`, `/api/jira/card/<KEY>`,
`POST /api/jira/comment|transition|bug`.

Agent dosyaları repo bilgisini prompt'a gömer — keşifle zaman harcamasınlar diye.
Yeni bir konvansiyon eklersen ilgili agent'ı da güncelle.
