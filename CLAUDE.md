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

14. **₺ sembolü hem önde hem arkada olabiliyor** (`"₺4.200"` vs `"4.000,00 ₺"`).
    `BasePage.moneyIn()` eskiden yalnızca önde varsayıyordu ve fiyat okunamadığında
    sessizce `null==null` ile yeşile dönüyordu (2026-08-24 ölçümü: 3 test yanlış-yeşil
    çıktı). Artık ikisini de deniyor — yeni bir para okuyucu yazarken aynı tuzağa düşme.

15. **Sepette adet artır/azalt aria-label'ı DEĞİŞMEYEN ALT DİZE ile ara.** "Azalt"
    metni "Adet azalt"a yarım geçirilmişti (2026-08-24, 4 test kırmızı çıktı); `CartPage`
    artık tam string yerine `zalt`/`rtır` gibi her iki sürümde de değişmeyen alt diziyi
    arıyor. Adet de artık satır konteynerinden değil, artır butonunun DOM'daki
    `previousSibling` zincirinden okunuyor (`firstLineQuantity()`) — konteyner DOM'u
    değişirse bu okuma da kırılır, önce oradan şüphelen.

16. **Ürün detayında favori butonu birden fazla kez DOM'da var.** İlk favori butonu ana
    ürüne ait, sonrakiler "Diğerleri de sevdi" gibi öneri kartlarına ait —
    `ProductPage.favoriteButton` `.first()` ile kilitli; global bir favori seçici yanlış
    ürünü favoriler.

17. **Şehir/İlçe/Mahalle native `<select>` değil, custom dropdown.** Popup sayfa genelinde
    aranırsa hesap menüsündeki `<li>`'leri yakalıyor; `AddressPage.pickFromDropdown()`
    popup'ı `xpath=following::ul[1]` ile butona göre konumlandırıyor. `StoresPage` da
    benzer bir tuzağı `storeCount()`'ta çözüyor: mağaza kartı yerine "Yol tarifi"
    butonunu sayıyor, çünkü h2/h3 sayımı footer başlıklarını da yakalıyordu.

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
panel/public/scope/          # Flowscope (kapsam ağacı) — ES modülleri
shared/nav/                  # ORTAK üst bar — panel + scope + landing + onboarding
site/                        # landing (statik) + onboarding/landing (React SPA), vite 4321
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

## AI sağlayıcı katmanı · RAG v1 · koşum kapısı (2026-09-08, canlıya hazırlık)

Üç değişiklik birlikte geldi; hepsi ölçülerek doğrulandı (44 birim testi yeşil,
`npm run test:panel`; sunucu 4699'da curl ile uçtan uca; gerçek bir tek tık
üretim CLI yoluyla 3 case yazdı, 6 repo parçası bağlam, 57 sn).

### 1) Panel modeli TEK kapıdan çağırır — `panel/ai/provider.mjs`

Eski doktrin "panel model çağırmaz" idi; sunucuda bu, üç AI özelliğinin (senaryo
· perf yorumu · test case) **kopyala-yapıştıra düşmesi** demekti (imajda `claude`
CLI yok → her `generate` ucu 501). Yeni sıra, `resolveCreds`'in "ortam > dosya"
deseniyle aynı mantıkta:

| Yol | Ne zaman | Kimlik |
|---|---|---|
| `api` | `ANTHROPIC_API_KEY` varsa (**sunucu yolu**) | tek anahtar, başka kurulum yok |
| `cli` | anahtar yok, makinede `claude` var (**geliştirici yolu**) | kullanıcının Claude Code oturumu + MCP'leri |
| `manual` | ikisi de yok | yok — istem üret + yapıştır (hiç kapanmaz) |

`AI_PROVIDER=api|cli|manual` sırayı ezer. Diğer env: `AI_MODEL` (varsayılan
`claude-opus-5`), `AI_EFFORT` (`high`), `AI_MAX_TOKENS` (16000), `AI_TIMEOUT_MS`
(180000), `AI_DAILY_USD` (günlük tavan; aşınca 429), `AI_MAX_CONCURRENCY` (2).

- **SDK YOK, raw `fetch`** (`panel/ai/anthropic.mjs`). Sıfır-bağımlılık kuralı
  korunuyor; `@anthropic-ai/sdk` import'u bir kez paneli açılışta düşürmüştü.
  API sözleşmesi dosya başlığında: `output_config.format={type:"json_schema"}`
  (şemada her nesnede `additionalProperties:false` ŞART), `thinking:{type:"adaptive"}`
  (Haiku'da gönderilmez), `system[].cache_control` 1 saat, prefill yok,
  `stop_reason:"refusal"` HTTP 200 ile gelir.
- **Şema API'de sunucu tarafında zorlanır** → bozuk JSON sorunu o yolda biter.
  CLI yolunda gevşek ayrıştırma + bir kez düzeltici tekrar **provider'da**
  (`viaCli`), çağıranlarda değil.
- **Bütçe + eşzamanlılık + defter** (`panel/ai/budget.mjs`): her çağrı
  `panel-data/ai-usage.jsonl`'e bir satır (başarısız da); gün UTC. Aynı anda en
  çok 2 çağrı + 4 kuyruk, fazlası `BUSY` (429). Tavan `AI_DAILY_USD`.
- **Hata kodu → HTTP tek yerde** (`httpStatusFor`): `NO_PROVIDER/NO_KEY/NO_CLI`
  501 · `BUDGET/BUSY/RATE_LIMIT` 429 · `TIMEOUT` 504 · `REFUSAL` 422 ·
  kapı reddi (`applyFromModel` fırlatırsa) 422 `REJECTED` · diğerleri 502.
  `hintFor` kullanıcıya "şimdi ne yapayım" satırını verir.
- **Kapılar değişmedi.** `gate()`/`applyCases()`/`allowedNodeIds` veri yolunda,
  sağlayıcıdan bağımsız koşulsuz çalışır. `generateAndApply()` (server.mjs) üç
  özelliğin ortak gövdesi: model → kapı → yaz.
- İstem kurucular artık `{prompt, system, user, retrieval}` döner: `prompt`
  kopyala-yapıştır/CLI için tek metin, `system`+`user` API için ayrı (sistem
  bloğu önbelleğe alınır).
- Uçlar: `GET /api/ai/status` (yol, model, bugünkü harcama — ağa çıkmaz),
  `POST /api/scenarios/generate`, `POST /api/perf/generate`, mevcut
  `/api/scope/testcases/generate` ve `/api/jira/testcases/generate`.
  Arayüzde `data-ai-oneclick` düğmeleri yalnızca yol açıkken görünür; 501
  gelirse otomatik istem yoluna düşer. Connector satırı (`claude-code`, ad
  değişmedi) yolu ve harcamayı gösterir; `manual` → amber.
- **Yerelde CLI, sunucuda anahtar.** CLI'nin `model` alanı `modelUsage`'ın ilk
  anahtarı (yanıltıcı olabilir); maliyet CLI oturumunun toplamı (ölçüm: $0.47 /
  3 case). API yolunda `usage` gerçek token sayısı, maliyet liste fiyatından
  **tahmin** (`estimateCost`), fatura Console'da.

### 2) RAG v1 — `panel/rag/` (BM25, tek JSON, sıfır bağımlılık)

Model "repoyu bilsin" diye istemlere repodan parça giriyor. Corpus: `tests/*.ts`,
`pages/*.ts`, `global-setup.ts`, `playwright.config.ts`, kökteki `*.md`,
`docs/*.md`, `panel/runs.json`, `panel-data/scope/tree.json`, varsa
`graphify-out/graph.json` (yalnız dosya komşuluğu). Ölçüm: 46 dosya → 267
parça, 5.372 terim, kurulum 62 ms, indeks 546 KB.

```bash
npm run rag:index                                   # kur + özet
node scripts/rag-index.mjs --query "sepet adet 406" # ne geliyor?
node scripts/rag-index.mjs --context "..."          # isteme girecek blok
curl "localhost:4646/api/rag/search?q=sepet&k=5"    # salt okur
```

- **Türkçe tuzağı burada da**: `İ`/`ı` NFD + `\p{Mn}` at + `ı→i` (figma-diff'te
  12 yanlış pozitif üreten hata). Gövdeleme muhafazakâr (çok karakterli ekler,
  gövde ≥ 4) **ve** 6+ harfli kelimeye 5 harflik önek belirteci eklenir —
  "sepet/sepete/sepette/sepetim" buluşsun diye. Sorgu ve belge aynı fonksiyondan
  geçer; tutarlılık doğruluktan önemli.
- **Bayatlık kendi kendine**: indeks kaynak mtime'larını saklar, `ensureIndex()`
  10 sn'de bir stat turu yapar, değişen varsa yeniden kurar. Sunucuda `panel-data`
  volume olduğu için imaj build'inde kurmak anlamsız — ilk istekte kurulur.
  `POST /api/rag/reindex` "hemen gör" için.
- **Graf genişletme**: ilk isabetlerin dosyalarının graphify komşusu dosyalardan
  sorguyla terim paylaşan en çok 2 parça eklenir (`via:"graf"`). Graf yoksa atlanır.
- İstemlerde: test case (6 parça, ≤6000 kr), kart (6, ≤5000), senaryo (5, ≤4500).
  Perf istemine girmez (ölçüm zaten sayısal). İndeks yoksa blok boş, özellik kapanmaz.
- **Embedding/vektör DB BİLİNÇLİ OLARAK YOK**: ikinci sağlayıcı + ikinci anahtar.
  Ancak ölçüm (gate'ten geçme oranı, uydurma seçici sayısı) açığı gösterirse.

### 3) Koşum kapısı — `panel/run-queue.mjs`

Tek slot korunuyor (Playwright `test-results/`i koşum başında siler). Eklenen:
- **Idempotency**: `POST /api/run {requestId}` — aynı id 60 sn içinde tekrar
  gelirse İLK sonucun aynısı (`deduped:true`); çift tık/iki sekme iki koşum başlatmaz.
- **Kuyruk**: `{queue:true}` slot doluysa sıraya alır (en çok 5, aynı iş iki kez
  giremez), slot boşalınca otomatik başlar (`run-queued` SSE olayı).
  Kapsam koşumu (`/api/scope/run`) sıraya alınmaz — `scopeRun` tek slot.
- **Meşgul → 409 `BUSY`** (eskiden 200 + `ok:false`); `GET /api/run/state`
  süren koşum + sıra. `POST /api/stop` sırayı da temizler (`{all:false}` korur).
- Gövde sınırı 8 MB (`PANEL_BODY_LIMIT_BYTES`) → 413; bozuk JSON → 400.

### Aynı turda kapatılan borçlar

- **Figma sunucuda tak-çalıştır**: `figma-render.mjs`, `scripts/figma-diff.mjs`,
  `scripts/figma-prewarm.mjs` dosyayı DOĞRUDAN okuyordu; env'e konan
  `FIGMA_TOKEN`'ı yalnız connector görüyordu (preflight "ok", render "dosya yok").
  Üçü de `resolveCreds`.
- Flowscope'taki 4 çıplak `confirm/alert` → `scope/js/dialog.js` (`uiToast`/`uiConfirm`,
  panelle aynı API). `generateSpec()`'teki `prompt()` → `uiPrompt()`. Genel
  Bakış'taki ölü `stopRun()` artık tanımlı. `drawer.js`'teki `localhost:8934`
  talimatı sunucu API'sine çevrildi. `site/src/pages/Index.tsx`'teki 4 sabit
  `localhost:4646` linki `HqNav.url("panel")`'dan çözülüyor.
- `npm run panel:check` yeşil: çekirdek yorumlarındaki 20 proje işareti nötrlendi.

## Ayağa kaldırma

**"Panel ayağa kaldır" = `npm run up`** — panel ve landing/onboarding sitesi BİRLİKTE kalkar.
Sadece paneli isteyen özel bir durum yoksa `npm run panel` tek başına kullanılmaz.

| Adres | Ne |
|---|---|
| `http://localhost:4646` | QA Paneli |
| `http://localhost:4647` | site proxy (iframe) |
| `http://localhost:4321/` | Landing |
| `http://localhost:4321/onboarding` | Başlangıç rehberi |

`scripts/up.mjs` detayları: landing kaynağı **artık bu deponun içinde**, `./site`
(React + Vite + Tailwind, `homee-panel-site` paketi, git'e commit edilmiş — eskiden
kardeş dizindi ve versiyon kontrolü yoktu). Çözüm sırası: `LANDING_DIR` env'i elle
verilmişse o → yoksa depo içi `site/` (package.json varsa) → yoksa geriye dönük uyum
için `../homee-panel-site` (taşımayı kaçırmış eski bir kopya için). **Dev sunucusu
değil `vite preview`** kullanılır — gösterime giden şey production build'i olsun diye;
`dist/` yoksa önce build alınır. Dolu portta o servis başlatılmaz (çalışan süreci
öldürmez). Ctrl-C ikisini birden kapatır.

`site/` kendi içinde **iki ayrı giriş** barındırıyor: kökteki `index.html` React'e hiç
dokunmayan, tek dosyalık statik bir landing (Vesper.ai tasarımı, inline CSS); asıl
React SPA `onboarding/index.html`'den giriyor (`/onboarding` — on adımlık başlangıç
rehberi) ve eski çok bölümlü landing `/landing`'de karşılaştırma için hâlâ açık
duruyor (`site/src/pages/Index.tsx`). `vite.config.ts`'teki `dirEntrySlash()` eklentisi
`/onboarding` (sondaki `/` olmadan) isteğini `/onboarding/`'e çeviriyor — yoksa SPA
fallback'i kök `index.html`'e (yeni landing'e) düşüyordu (ölçüldü: başlık yanlış sayfayı
gösteriyordu). `site/` bağımsız bir `npm install` gerektirir (`site/package.json`),
lint aracı ESLint değil **oxlint** (`site/.oxlintrc.json`).

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
2. **Model çağrısı bağımlılıksız** — panel AI için **paket istemiyor**, kimlik
   yalnızca ortam değişkeni (`ANTHROPIC_API_KEY`, isteğe bağlı). Eskiden
   `@anthropic-ai/sdk` `optionalDependencies`'te durur ve tembel yüklenirdi (statik
   import, paket kurulu olmayan bir projede paneli **açılışta** düşürüyordu — bozulan
   tek bir buton değil panelin tamamıydı). Paket kaldırıldı ve GERİ GELMEDİ:
   2026-09-08'den beri sunucu yolu raw `fetch` ile `panel/ai/anthropic.mjs` (bkz.
   "AI sağlayıcı katmanı"). Aynı tuzak `dotenv` için de vardı — `devDependencies`'te
   durduğu hâlde çalışma zamanında import ediliyordu.

### Jira: kart → doğrulama hattı

Kart detayı **3 adımlı akış**: ① KOŞ → ② KARAR → ③ YAZ. Önceki hâli 5 bölümü,
7 düğmeyi, 10 seçenekli statü listesini ve 2000 karakterlik yorumu aynı anda açıyordu
(kart yüksekliği ~2500px). Şimdi 551px: kartın metni ve yorumlar katlanmış, üretim ve
eşleme adım ①'in içinde, yorum alanı hazırlanana kadar gizli.

- ① `card.lastRun` (sunucuda hesaplanır) tek satır: `7/7 geçti · 95 sn · 12:10`.
  Kayıt **kartın koşum id'lerine göre** eşleşir (`<runId>-*`) — ilk hâlinde journal'ın
  en yeni kaydı alınıyordu, kartla ilgisiz bir koşumun süresi kartın sonucu gibi
  görünebiliyordu. `failedTitles` yalnızca o koşum EN SON koşumsa doldurulur
  (`results.json` tek dosya, her koşumda üzerine yazılıyor).
- ② karar → yerel verdict kaydı (`key = kart anahtarı`), Jira'ya gitmez.
- ③ **iki tıklı gönderim**: ilk tık metni hazırlar (koşum özeti + varsa karar) ve
  gösterir, ikinci tık gönderir. Statü düğmesi seçim yapılmadıkça **disabled**.

Kart detayı (`/api/jira/card/<KEY>`) dört şeyi tek ekrana getiriyor: kartın metni,
**kartı doğrulayan koşumlar** (tek tıkla tetiklenir), yorumlar, statü geçişleri.
Üstüne eklenen dört yetenek:

| Ne | Uç | Not |
|---|---|---|
| Kart → test case üretimi (**tek tık**) | `POST /api/jira/testcases/generate` | Kartın özeti + açıklaması + son 5 yorumu + hedef düğümün bağlamı tek isteme girer; yazma yine `/api/scope/testcases/apply` (tek yazma yolu). Üretilen case'e `jiraKey` işlenir. |
| Koşum sonucu → yorum taslağı | `GET /api/jira/comment-draft?key=` | Satırlar **kartın spec'lerine göre süzülür**; süzgeç boşsa "bu kartın spec'lerinden test yok" uyarısı basar. |
| Verdict → yorum taslağı | `GET /api/jira/verdict-draft?verdict=` | Verdict kaydına `card` alanı eklendi; Verdict tablosundaki kart düğmesi Jira sekmesine geçip taslağı doldurur. |
| Kart ↔ spec eşleme editörü | `GET/POST /api/jira/map` | Profil kaynak; panelden yapılan düzenleme `panel-data/card-specs.json`'a düşer ve profille **birleşir**. `snippet()` profile yapıştırılacak metni üretir. |

**Tek tık üretim nasıl çalışıyor (2026-09-08'den beri):** panel istemi kurar ve
`panel/ai/provider.mjs` üzerinden modeli çağırır — sunucuda `ANTHROPIC_API_KEY`
ile Messages API, yerelde anahtar yoksa **makinede kurulu Claude Code CLI**
(`claude -p --output-format json --allowedTools ""`, `panel/claude-cli.mjs`; CLI
kullanıcının oturumuyla kimliklidir). CLI'de araçlar KAPALI (modelin repoda
dolaşmasına gerek yok, yan etki riski var) ve cwd geçici dizin: repo kökünde
çağrılınca CLI proje CLAUDE.md'sini yükleyip her isteğe ~11k token ekliyor.
Ölçüm (CLI): 3 case ≈ 24–57 sn, ≈ $0.13–0.47. Repo bağlamı (RAG v1) her iki
yolda da isteme girer.

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

### Panel bildirimleri: `uiToast` / `uiConfirm`

Tarayıcının `alert`/`confirm` kutuları panelin dilini konuşmuyordu ("localhost:4646
web sitesinin mesajı" başlığı, temasız beyaz kutu, sayfayı kilitliyor). İkisi de
kaldırıldı — **kodda tek `alert(` veya çıplak `confirm(` kalmadı** (13 + 8 çağrı):

- `uiToast(mesaj, { type: 'info|ok|err', title, ms })` — sağ altta yığın.
  **Hata toast'ı kendiliğinden kapanmaz** (`ms: 0`): kullanıcı okumadan kaybolması
  alert'ten daha kötü olurdu. Bilgi/başarı 6 sn.
- `uiConfirm(mesaj, { title, ok, cancel, danger })` → **`Promise<boolean>`**.
  Escape ve dışa tıklama = vazgeç, Enter = onay.

⚠️ `uiConfirm` **asenkron**: çağıran `await` etmeli. `if (!uiConfirm(...))` her zaman
false döner (Promise truthy'dir) ve yıkıcı işlem **onay sormadan** çalışır. Yeni bir
onay eklerken bu tuzağa dikkat.

**Temizlik artık her iki yüzeyde tam (2026-09-08).** 2026-08-29 taramasında
ölçülen iki sapma kapatıldı: `generateSpec()`'teki native `prompt()` →
`uiPrompt()` (aynı dosyada, `uiConfirm`'in yanında); Flowscope'taki çıplak
`confirm()/alert()` çağrıları (`chips.js` sil, `data.js::clearAll`, `shell.js`
bozuk yedek, `testcase-request.js` hata) → `scope/js/dialog.js` (`uiToast`,
`uiConfirm`; ES modül, panelle aynı API ve aynı asenkron tuzak). Yeni bir
onay/uyarı eklerken: ana panelde global `uiToast/uiConfirm/uiPrompt`, scope
tarafında `import { uiToast, uiConfirm } from './dialog.js'`. Ölçüm:
`grep -n "confirm(\|alert(\|prompt('" panel/public/scope/js/*.js panel/public/index.html`
→ 0 çıplak çağrı.

### Perf geçmişi

`panel-data/perf/` her sweep'te **üzerine yazılıyor** — "LCP düzeldi mi" sorusunun
cevabı hiçbir yerde durmuyordu. `panel/perf-history.mjs` her yeni ölçümü tek satırlık
özet olarak `panel-data/perf/history.jsonl`'e ekliyor (anahtar `measuredAt`, aynı ölçüm
iki kez kaydedilmez, en yeni 200 kayıt).

- Yakalama **tembel**: `/api/perf` her okunduğunda çalışıyor, yani sweep'i kim koşarsa
  koşsun (panel, script, elle) geçmişe düşüyor — sweep sürecine kanca gerekmedi.
  Yakalama hatası ölçümü gölgelemiyor (try/catch + audit).
- `GET /api/perf/history` → kayıtlar + son iki ölçümün rota bazlı farkı.
- Karşılaştırma **yalnızca iki ölçümde de bulunan rotalar** üzerinden: rota listesi
  profille değişince "sonsuz kötüleşme" satırları çıkıyordu. Yeni/kayıp rotalar ayrı
  raporlanıyor.
- Perf sekmesinde "Geçmiş" bölümü: ölçüm başına medyan/p95 LCP, bütçe aşan sayısı,
  istek/API toplamı, en yavaş rota + hata sinyali (404 + 4xx/5xx + konsol) ve önceki
  ölçüme göre ▲/▼ farkı. **Perf'te küçük iyidir** — artış kırmızı, düşüş yeşil.

### Koşum kaydı: video, trace, canlı izleme

`playwright.config.ts` içinde **`video` hiç tanımlı değildi** (Playwright varsayılanı
`off`) ve `trace: "on-first-retry"` yerelde retry 0 olduğu için **pratikte hiç trace
üretmiyordu** — panelden koşan biri geriye dönüp izleyecek hiçbir şey bulamıyordu.
Şimdi ikisi de ortamdan okunuyor:

```ts
video: (process.env.PW_VIDEO || "retain-on-failure"),
trace: (process.env.PW_TRACE || "retain-on-failure"),
```

- Varsayılan `retain-on-failure`: **geçen testte kayıt yoktur, bu normaldir.** Panel
  bunu mesajda söylüyor, yoksa "kayıt çalışmıyor" sanılıyor.
- Kart akışı ① altındaki **`⏺ kayıt al`** kutusu `record: true` gönderir → koşum
  süreci `PW_VIDEO=on PW_TRACE=on` ile başlar (her test kaydedilir).
- **`👁 canlı izle`** kutusu headless'ı kapatır: tarayıcı penceresi açılır. Playwright
  canlı akış yayınlamıyor; panel içinde canlı görüntü ancak CDP screencast ile olur,
  o ayrı bir iş.
- `GET /api/artifacts[?spec=]` kayıtları listeler, `/artifact/<yol>` servis eder
  (yol normalize edilir, `test-results` dışına çıkan ve `.webm|.zip|.png` olmayan
  istek 403). Panel videoyu gömülü oynatır; `trace aç` → `npx playwright show-trace`
  (koşum motoruna sokulmadı: bu bir görüntüleyici, "aktif koşum" durumunu kirletmez).
- **Disk:** 5 testlik tek kayıtlı koşum **44 MB** bıraktı. `POST /api/artifacts/clear`
  (panelde `kayıtları sil`) klasörleri siler, `results.json`'a **dokunmaz** — o sonucun
  kendisi, silinse case defteri ve kart özetleri körleşir.

`perf-sweep` koşumu whitelist'e eklendi (`node scripts/perf-sweep.mjs --scroll`).
Perf sekmesindeki "Yeniden ölç" düğmesi bu id'yi çağırıyordu ama `panel/runs.json`'da
**karşılığı yoktu** — düğme "Whitelist'te yok: perf-sweep" hatası veriyordu, yani panelden
perf ölçümü hiç başlatılamıyordu (ölçüldü 2026-08-26).

⚠️ `ordersEnv()` sunucuda tanımlı ama **hiçbir yerde kullanılmıyor**: panelin "sipariş
tamamlama" override'ı koşum sürecine geçmiyor. Kayıt işi sırasında farkedildi;
guard'a dokunmak ayrı bir karar olduğu için bilinçli olarak eklenmedi.

### AI özellikleri: anahtarsız yol (Claude Code'a kopyala-yapıştır)

> 2026-09-08: bu yol artık **geri dönüş yolu**. Sunucuda `ANTHROPIC_API_KEY`
> varsa üç özellik de `generate` uçlarıyla tek tık çalışır (bkz. "AI sağlayıcı
> katmanı"). Aşağıdaki iki uçlu desen olduğu gibi duruyor: anahtar da CLI de
> yoksa, kimlik düşmüşse ya da bütçe dolmuşsa özellik kapanmaz, buraya düşer.

Panelin üç AI özelliği (**Senaryo öner**, **perf AI yorumu**, **kapsam ağacında test
case üretimi**) anahtarsız da çalışır. Gerekçe: kullanıcı modeli zaten Claude Code'da
çalıştırıyor olabilir; anahtar yoksa üç özellik birden kapalı kalmamalı.

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

### ⚠️ Chrome + arm64: build'i düşüren tuzak (2026-09-02)

`playwright install chrome` **Linux arm64'te HATA verir**: Google Chrome'un o
mimaride yapısı yok.

```
ERROR: not supported on Linux Arm64
Failed to install chrome
```

Bu adım `RUN` içinde olduğu için **tüm imaj build'i düşer**. Dokploy başarısız
build'de ESKİ container'ı çalışır bırakır — yani belirti "push oldu, deploy
yansımadı" olur, hata mesajı hiçbir yerde görünmez. Dockerfile artık mimariye
göre ayırıyor: amd64'te gerçek Chrome, arm64'te yalnız chromium.

arm64'te koşum tetiklenecekse **`PW_CHANNEL=chromium`** gerekir:
`playwright.config.ts` varsayılan olarak `channel: "chrome"` istiyor ve o
tarayıcı arm64 container'da yok. `PW_CHANNEL` boş ya da `chromium` verilince
Playwright'in kendi chromium'u kullanılır (ölçüldü: arm64 imajda chromium
açılıp sayfa render etti).

### İmajı lokalde kurup denemek (deploy'u doğrulamanın tek yolu)

```bash
docker build --build-arg WITH_BROWSERS=0 -t homee-panel:ui-only .   # ~35 sn, 983 MB
docker run -d --name homee-test -p 4655:3000 --env-file .env \
  -e PANEL_PROJECT=homee -e PANEL_TOKEN=<32hex> \
  -e PANEL_ORIGIN=https://<domain> -e MOBAI_BRIDGE=off \
  -e JIRA_EMAIL=... -e JIRA_TOKEN=... homee-panel:ui-only
curl -s localhost:4655/api/preflight
```

`WITH_BROWSERS=0` yalnız-arayüz imajı: koşum düğmeleri çalışmaz, panel çalışır.
Ölçüldü 2026-09-02: container'da **hiçbir `~/.*-credentials` dosyası yok** ve Jira
sadece env ile bağlanıyor (`kimlik: ortam değişkeni`) — Dokploy senaryosunun birebir
provası. `PANEL_ORIGIN`'deki domain'den gelen yazma isteği 400 (auth geçti),
yabancı origin 403 `BAD_ORIGIN`.

⚠️ Sunucudaki container'ın hangi commit'te olduğunu **servis edilen dosyadan**
bulabilirsin (deploy gerçekten oldu mu sorusunun kesin cevabı):

```bash
curl -s https://<domain>/scope/js/jira.js -o /tmp/s.js
git hash-object /tmp/s.js        # cikan blob'u git gecmisiyle karsilastir
for c in $(git log --format=%H -12 -- panel/public/scope/js/jira.js); do
  [ "$(git rev-parse $c:panel/public/scope/js/jira.js)" = "<blob>" ] && git log -1 --oneline $c
done
```

### Ortak üst bar (`shared/nav/`) — dört yüzeyin tek kaynağı

Panel (`/`), Flowscope (`/scope`), landing (`4321/`) ve onboarding
(`4321/onboarding`) **aynı üst barı** kullanır. Kaynak repo kökünde, `panel/`
ya da `site/` altında değil:

```
shared/nav/nav.js    # markup + davranış + YAPILANDIRMA (SURFACES)
shared/nav/nav.css   # biçim
```

İki sunucu **aynı dosyayı okur**, kopya yok:
`panel/server.mjs` → `/nav.js` + `/nav.css`; `site/vite.config.ts` →
`sharedNav()` eklentisi (dev + preview middleware, `generateBundle` ile dist'e
de koyar) ve her giriş HTML'ine `transformIndexHtml` ile enjekte eder.

**Bar'ı değiştirmek = yalnızca `shared/nav/` değiştirmek.** Yeni bir geçiş
düğmesi, yeni bir yüzey ya da bir slot'u açıp kapatmak için `SURFACES` bloğu
düzenlenir; dört yüzey birden güncellenir. Panelin `<style>`ında,
Flowscope'un `fw-header`ında ya da site'in `Navbar.tsx`inde üst serit kuralı
**yeniden yazma** — üçünün ayrışması tam olarak bu barın çözdüğü sorun.

**Şerit sabit ve barın ortasında.** `SWITCH = ["landing", "scope", "panel"]` —
her yüzeyde aynı üç hedef, aynı sırada (**Home · Kapsam · Panel**) ve
**bulunduğun yüzey de içinde**: çıkarılmıyor, `hqn-on` ile aktif işaretleniyor
(`aria-current="page"`, link değil span). Şerit sayfa sayfa değişse "sabit
gezinme" hissi olmazdı, ortada durması da mümkün olmazdı — genişliği her
sayfada başka olurdu. Onboarding bilinçli olarak şeridin dışında; landing'in
kendi CTA'ları oraya götürüyor.

⚠️ **Bar üç kolonlu ızgara:** `grid-template-columns: 1fr auto 1fr` —
`.hqn-left` · `.hqn-switch` · `.hqn-right`. Orta kolon yanlardaki içerikten
bağımsız olarak merkezde durur ve yan kolonlar ona yer açmaya **zorunludur**.
Önce `position:absolute; left:50%` denendi: merkez doğruydu ama akıştan çıkınca
panelde komut kutusuna **44px** biniyordu (ölçüldü). Yan kolonlarda
`min-width:0` şart, yoksa uzun bir kırılım şeridi merkezden kaydırır.

**Komut kutusu ortada değil**, sol kolonda kırılımın ardında: `flex:1 1 0` +
`min-width:0` (input dahil) ile kolonun payına göre büyür ve gerekince sıfıra
kadar daralır. `flex:0 1 auto` daralmıyordu ve panelde 1100px altında
72–272px yatay taşma veriyordu. `#cmdMenu` artık `.cmdwrap` içinde ve
kutusunun altına hizalı — barın ortasına değil.

| Yüzey | Açık slot'lar | Kırılım kökü |
|---|---|---|
| panel | `sidebarToggle`, `cmd`, `status` | `/api/meta` (panelin kendi `load()`'u) |
| scope | — | `/api/meta` (bar çeker) |
| landing | — | mount `root` (site verir) |
| onboarding | — | mount `root` (site verir) |

⚠️ **Üretilen id'ler panelin sözleşmesi.** `#cmdInput`, `#cmdMenu`, `#crumbLeaf`,
`#panelTitle`, `#activePill`, `#orderPill`, `#scopeLink`, `#cxWrap`, `#cxBtn`,
`#cxPanel`, `#gatePill`, `#envPill`, `#themeBtn`, `#sbToggle` — 236 KB'lik
`panel/public/index.html` bunlara id ile bakıyor. Ekleme serbest, **yeniden
adlandırma panelin ilgili davranışını sessizce öldürür**.

⚠️ **`<script src="/nav.js">` klasik, `type="module"` DEĞİL** ve `mount()` hemen
altında. Panelin IIFE'leri yüklenirken bar id'lerini arıyor; modül ertelenseydi
hepsi boş DOM bulurdu.

⚠️ **Panel çekirdeğine proje adı sızmaz** (`npm run panel:check`). Global adı bu
yüzden `HqNav` / `window.HQ_NAV`; landing'in kırılım kökü (`Homee QA`)
`shared/nav`ta değil, `site/vite.config.ts`teki mount çağrısında.

**Geçişler AYNI SEKMEDE.** Önce ayrı süreçteki yüzeyler (landing ↔ panel)
`target="_blank"` ile açılıyordu; kullanıcı açısından bu "başka bir sayfaya
atıldım" demekti. Bar dört yüzeyde de aynı dosyadan geldiği ve **aynı
yükseklikte** durduğu için aynı sekmede geçiş "üst şerit sabit, altındaki
değişti" gibi görünür.
⚠️ Yeni sekme isteği geri gelirse `rel="noreferrer noopener"` de geri gelmeli.

**Bar yüksekliği `--hq-nav-h` (70px) ile sabit.** Doğal yükseklikleri 63–70px
arasında oynuyordu (panelde komut kutusu var, landing'de yok) ve geçerken alttaki
içerik zıplıyordu. Panelin sticky yan paneli ve sekme şeridi de bu token'a
dayanır — eskiden `top:53px` sabit yazılıydı ve bar 70px'e çıkınca 17px'lik ölü
bir şerit kalıyordu.

⚠️ **Bar kendi reset'ini taşır, host'un global kuralına güvenmez.** Panel ve
landing `*{box-sizing:border-box}` yazıyor, Flowscope ise yalnızca `.fw *` için —
bar `.fw`nin dışında olduğu için `content-box` kalıyordu ve `min-height:70px`
üzerine padding+kenarlık eklenip **99px** oluyordu (ölçüldü). `font-size` de aynı
sebeple açıkça yazılı: panelin body'si 14px, Flowscope'un 16px.

### Landing sunucuda: panel onu kendisi servis eder

Landing lokalde **ayrı süreçte** (`vite preview`, 4321) ama sunucuda o süreç
yok — dağıtılan tek şey panel konteyneri. Sonuç: üst bardaki **Home** düğmesi
sunucuda hiç basılmıyordu (ölçüldü 2026-09-07: `/onboarding` → 404) ve "sabit
üç öğe" dediğimiz şerit orada ikiye düşüyordu.

Dockerfile `site`'ı **zaten** build ediyor (`npm run build --prefix site`), yani
`site/dist` imajda hazırdı; eksik olan tek şey onu servis etmekti. Panel artık
veriyor (`SITE_DIST` varsa):

| Yol | Dosya |
|---|---|
| `/home` | `site/dist/index.html` (statik landing) |
| `/onboarding` | `site/dist/onboarding/index.html` |
| `/landing` | `site/dist/landing/index.html` (eski React landing) |
| `/assets/*` `/shots/*` `/favicon.svg` `/icons.svg` | `site/dist/…` |

⚠️ **Vite'ın `base`i DEĞİŞMEDİ ve değişmemeli.** Landing'in ürettiği mutlak
referanslar (`/assets`, `/shots`, `/nav.css`, `/onboarding`) panelin sahip
olduğu yollarla çakışmıyor — bu yüzden **aynı `dist` hem 4321'de hem panel
origin'inde çalışıyor**. Yeni bir panel ucu eklerken bu listeyi ezmediğine
dikkat et. Kök `/` panelde kaldı: yer imleri ve deploy adresi bozulmasın.

**Adres tablosu `window.HQ_NAV`.** Sunucu her HTML'e enjekte ediyor
(`navConfigFor(req)`), servis edilen landing dahil — enjeksiyon derlenmiş
HTML'de `<script src="/nav.js">` etiketinin **önüne** yapılıyor (yer tutucu yok).

- **lokal** → `{ landing: "http://localhost:4321" }` (origin). Ayrı süreç HMR
  verdiği için lokalde imajdaki `dist` yerine **hep o** tercih edilir.
- **sunucu** → `{ urls: { landing, onboarding, panel, scope } }`, hepsi tam
  adres. **Dördü de açıkça verilmeli:** landing sayfasındayken `nav.js` panel
  origin'ini yalnızca localhost'ta tahmin edebiliyor (4646 varsayımı);
  sunucuda tahmin boş döner ve landing'in barında Panel/Kapsam **hiç basılmaz**
  (ölçüldü: sunucu taklidi 4700'de ikisi de `localhost:4646`'yı gösteriyordu).
- ikisi de yoksa tablo boş → Home basılmaz, ölü link yok.

**Sayfa içi yüzey bağlantıları: `data-hq`.** `<a data-hq="panel">` yazan her
bağlantının `href`i bardan doldurulur (`HqNav.resolveLinks`), çözülemezse
bağlantı **gizlenir**. Bu, üç yerde bulunan aynı hatanın kalıcı çözümü:
`Navbar.tsx`, onboarding CTA'sı ve statik landing'de **beş** bağlantı
`http://localhost:4646` sabitiyle yazılıydı — sunucuda hepsi ölü.
⚠️ Tarama üç kez yapılır: mount'ta, `DOMContentLoaded`'da ve **MutationObserver
ile** — React ikisinden de sonra boyuyor, gözlemci olmadan `data-hq="landing"`
ham `href="/"` ile kalıyordu (yani sunucuda panelin köküne gidiyordu).

**Palet köprüsü:** `.hq-nav` host'un token'ını miras alır, yoksa kendi değerine
düşer (`var(--fg, var(--text, #e9e9ed))`). Panelde `theme.css` tokenları,
landing'de kendi `--bg/--text`i geçerli; hiçbiri yoksa bar yine de doğru
görünür. Bar kendi `button` tabanını taşır — panelin genel `button{}` kuralına
**güvenmez**, çünkü Flowscope ve landing'de o kural yok.

**Tema anahtarı** bardadır: `qa-panel-theme` anahtarı + `data-theme`. Panel ve
`/scope` aynı origin olduğu için tercihi paylaşır; landing ayrı origin, kendi
tercihini tutar (beklenen). `/scope`'un `<head>`indeki erken tema okuması
KALSIN — bar `body`de mount edildiği için o olmadan sayfa yanlış temada flash
eder.

**Adres çözümü** (`originFor`): panel + scope `panel` origin'inde, landing +
onboarding `landing` origin'inde. Bulunduğun yüzeyin origin'i `location.origin`;
diğeri `window.HQ_NAV` ile verilir, yoksa **yalnızca localhost'ta** porttan
tahmin edilir (4646 / 4321). Çözülemezse **düğme hiç basılmaz** — ölü link yok.

Panel tarafında `HQ_NAV.landing` sunucudan gelir: `landingUrlFor(req)`,
`index.html` ve `scope/index.html`'e `__LANDING_URL__` olarak enjekte edilir.
⚠️ **Varsayılan yalnızca lokal isteklerde verilir** — landing ayrı bir süreç
(`vite preview`, 4321) ve sunucuda o domainde hiç yok; varsayılan konulsa düğme
ölü bir localhost adresine giderdi. Karar **isteğin `Host` başlığına** bakar,
ortam değişkenine değil: ilk hâli "PANEL_ORIGIN verilmemişse lokaldeyiz"
sayıyordu ve sunucuda o değişken de verilmemiş olduğu için ters tepiyordu.
`LANDING_URL` açıkça verilirse her yerde o kullanılır; `off`/boş → düğme hiç
basılmaz.

**Komut kutusu (⌘K):** mekanik barda, **içerik yüzeyden**. Panel kendi
kaynağını `HqNav.registerCommands(q => [...])` ile veriyor (whitelist'teki
koşumlar + sekmeler). Yüzey geçişleri barın kendi kaynağından gelir, kaydetmeye
gerek yok. Flowscope'ta kutu kapalı: onun kendi "Ara..." kutusu var.

⚠️ **`site/` değişikliği `npm run up`ta görünmez** — `up.mjs` `vite preview`
çalıştırıyor, yani `site/dist`i servis ediyor. `site/` altında bir şey
değiştirdiysen önce `cd site && npm run build`.

### Connector'a OAuth ile bağlanmak ("Bağlan" düğmesi)

Kimlik artık üç kaynaktan çözülür — `connectors/credentials.mjs::resolveCreds`,
sıra **ortam > OAuth > dosya**. OAuth dosyanın üstünde: "Bağlan"a basmak bilinçli
ve taze bir eylem, eski bir `~/.<servis>-credentials` onu gölgelememeli.

Akış (`panel/oauth.mjs` + üç uç):

```
GET  /api/oauth/<servis>/start?t=<panel token>   → sağlayıcının izin ekranına 302
GET  /api/oauth/callback                          → code'u token'a çevirir, saklar
POST /api/oauth/<servis>/client                   → tek seferlik client id/secret
POST /api/oauth/<servis>/disconnect               → saklanan token'ı siler
```

Token `panel-data/oauth/<servis>.json` (0600), client kayıtları
`panel-data/oauth/clients.json` — ikisi de `.gitignore`'da. Sunucuda volume
bağlanmazsa deploy'da uçar. Client id/secret ortam değişkeniyle de verilebilir:
`<SERVIS>_CLIENT_ID` / `<SERVIS>_CLIENT_SECRET`.

⚠️ **`/start` token'ı query'de alır** (`?t=`), çünkü tarayıcı NAVIGASYONU başlık
gönderemez. Sebep sadece CSRF değil: panel internete açıksa yabancı biri akışı
başlatıp KENDİ hesabını panele bağlayabilir.

⚠️ **Kartta gösterilen "Callback / Redirect URL" isteğin kendi adresinden türer.**
Sıra: `PANEL_PUBLIC_URL` → `PANEL_ORIGIN`'in ilki → **isteğin Host'u**
(ters vekil arkasında `x-forwarded-proto` / `x-forwarded-host`). Eskiden son
basamak sabit `http://localhost:<port>`'tu ve ikisi de verilmeden deploy edilen
panel, sağlayıcıya yapıştırılacak adres olarak `http://localhost:3000/api/oauth/callback`
gösteriyordu (ölçüldü 2026-09-04, canlıda `/api/preflight` → `linear.oauth.redirectUri`)
— o adresle kurulan OAuth uygulaması hiç çalışmaz. Ortam değişkeni verilmişse
her zaman o kazanır (yabancı bir `Host` başlığı akışı kaydırmasın diye).

⚠️ **OAuth'ta "tek tık" ancak uygulama sağlayıcıda bir kere kaydedilirse mümkün.**
Claude Desktop'ta o kaydı Anthropic yapmış; burada bir kere biz yapıyoruz. Panel
kaydı da kendi içinden ister (kartta "Bağlan…" → TEK SEFERLİK KURULUM kutusu:
redirect URI'yi kopyala, client id/secret'ı yapıştır).

⚠️ **PAT ile OAuth token'ının başlığı bazı serviste farklı.** Linear'da kişisel
API key şema OLMADAN, OAuth token'ı `Bearer` ile gönderilir; `resolveCreds`
hangisi olduğunu `tokenType` ile söyler (`linear.mjs::gql` bunu okuyor). Figma da
farklı (`X-Figma-Token` vs `Bearer`) — Figma OAuth'u eklenirken 4 çağrı yeri
(`panel/figma-render.mjs` ×2, `scripts/figma-prewarm.mjs`, `scripts/figma-diff.mjs`)
buna göre düzeltilmeli. Jira 3LO ise ayrıca `api.atlassian.com/ex/jira/<cloudid>`
taban adresine geçmek demek; ikisi de HENÜZ YOK, Jira/Figma token ile çalışıyor.

Yetenek eşlemesi panelden değiştirilebilir: **"bu projede kullan"** düğmesi
`panel-data/connectors.json`'a yazar (`{"chat":"slack"}`), profil KODU
(`projects/<proje>.mjs`) değişmez; dosya silinince profildeki değere dönülür.

#### Bağlantı şalteri — "kopar" / "geri bağla"

Bağlantılar panelindeki **durum rozeti bir anahtardır**: bağlıyken tıklamak koparır (⏻),
kopukken geri bağlar (↻). Şalter `panel-data/connector-cuts.json` (`{"jira":"<ISO tarih>"}`);
anahtarın varlığı "kopuk" demektir.

**Hiçbir kimlik silinmez.** Kesme noktası bilerek kimlik ÇÖZÜMÜ
(`connectors/credentials.mjs::resolveCreds` → `ok:false`), depo değil: `~/.<servis>-credentials`,
`panel-data/oauth/<servis>.json` ve oturumlar yerinde kalır, geri açmak tek tık. Böylece
registry'yi atlayıp doğrudan kimlik çözen çağıranlar (`panel/jira.mjs`) da aynı sonucu görür.
`capability()` kopuk connector için `null` döner → çağıranlar zaten doğru işliyor
("tracker tanımlı değil"). `figma-render.mjs` kimliği doğrudan okuduğu için orada
ayrıca `isCut("figma")` sorulur.

Kopukken **ağ yoklaması yapılmaz** (Figma kotası) ve şalter her değiştiğinde o connector'ın
`.preflight-cache.json` kaydı düşürülür — geri bağlanınca taze sonuç görünür.

⚠️ Şalter yalnızca `connectors/index.mjs::ALL` içindeki servislerde var (`canCut: true`).
**Kapı ve Oturumlar satırlarında YOK**: onları "koparmak" yerel auth dosyasını silmek
demek olurdu — geri gelmesi 45 sn'lik koşum ya da elle giriş gerektirir, tek tık değil.
OAuth kartlarındaki **`token'ı sil`** ayrı bir şey: o gerçekten OAuth kaydını siler.

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

## Sunucuda (container/Dokploy) çalıştırma — ölçülmüş tuzaklar (2026-09-02)

Panel `localhost`'ta tek kişi varsayımıyla yazıldı; bir domain arkasına konduğunda
**dört ayrı yerde** sessizce kırılıyor. `https://testing-ideal.machinarium.dev`
üzerinde ölçülenler ve karşılıkları:

| Belirti | Gerçek sebep | Çözüm |
|---|---|---|
| Her yazma ucu 403, arayüz "Panel token eskimiş, sayfayı yenile" diyor | `server.mjs` origin whitelist'i yalnız `localhost/127.0.0.1/[::1]`; tarayıcı same-origin POST'ta da `Origin` yolluyor | `PANEL_ORIGIN=https://<domain>` (virgülle birden fazla). Sebep artık `code: "BAD_ORIGIN"` ile ayrı geliyor, arayüz üzerine yazmıyor |
| Her deploy sonrası eski sekmedeki token 403 | Token verilmezse üretilip `panel-data/.panel-token`'a yazılıyor, o dizin volume değilse uçuyor | `PANEL_TOKEN` sabit ver **ve** `/app/panel-data` volume bağla |
| Jira "kapalı", env yazmak işe yaramıyor | `panel/jira.mjs` kimliği YALNIZCA `~/.jira-credentials`'tan okuyordu — container'da home boş | Düzeltildi: `resolveCreds` (env > dosya). `JIRA_EMAIL` / `JIRA_TOKEN` ortam değişkeni yeter |
| Container açılışta düşüyor, deploy sonrası yeni sürüm hiç ayağa kalkmıyor | `panel/projects/` içine ikinci profil (`mto.mjs`) girince `project.mjs` "hangisi?" diye HATA atıyor; imajda CMD `node scripts/up.mjs`, yani package.json'daki `PANEL_PROJECT=homee` varsayılanı devrede değil | Dockerfile'a `ENV PANEL_PROJECT=homee` eklendi (2026-09-04). Deploy'da ezmek serbest: `-e PANEL_PROJECT=<profil>` |
| MobAI her preflight'ta timeout'a kadar bekleyip "köprü kapalı" diyor | Köprü adresi sabit `127.0.0.1:8686`'ydı | `MOBAI_BRIDGE=off` (yoklama yapılmaz, 3 ms) ya da gerçek adres |

**Kimlik konvansiyonu:** her connector `~/.<servis>-credentials` dosyasını okur ama
`connectors/credentials.mjs::resolveCreds` **ortam değişkenini dosyadan önce** dener.
Container'da tek yol env: `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_HOST`, `FIGMA_TOKEN`.
Yeni bir connector yazarken kimliği ASLA doğrudan `fs.readFileSync(homedir())` ile
okuma — `resolveCreds` kullan, yoksa sunucuda açılamaz.

⚠️ **Panelin önünde kimlik doğrulama YOK.** `PANEL_TOKEN` servis edilen HTML'de
duruyor (`meta[name=panel-token]`) ve origin kontrolü CSRF içindir, kimlik değil:
`Origin` başlığı hiç gönderilmeyince (curl) atlanır — ölçüldü 2026-09-02, geçerli
token + `Origin` yok → yazma ucu 400 (yani auth geçti). Yani internete açık bir
domain'de **herkes** koşum tetikleyebilir, kapsam ağacını yazabilir. Sunucuya
gerçek Jira/Figma token'ı koymadan önce panelin önüne proxy basic-auth / SSO gerekir
(Dokploy tarafında Traefik middleware'i; kod değişikliği istemez).

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
Homee/MAC işleri **`https://machinarium.atlassian.net`** üzerinde. Host artık `panel/jira.mjs`
içinde değil, **`panel/projects/homee.mjs`** (proje profili) içinde sabit —
`jira.mjs:42` `process.env.JIRA_HOST || P.host` okuyor, `P.host` profilden geliyor
(profil taşıması sonrası dosya konumu değişti, davranış aynı). Elle REST çağrısı
yazarken kimlik dosyasının host'unu kullanma, sessizce 0 sonuç alırsın (ölçüldü
2026-08-22: `key = MAC-7268` bile boş döndü).

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

## Tam kod taraması notları (2026-08-29)

Proje uçtan uca dosya dosya tarandı (repo kökü, `panel/`, `panel/public/`,
`panel/public/scope/`, `tests/`, `pages/`, `scripts/`, `site/`, `.claude/agents/`).
Yukarıdaki bölümlerin çoğu kodla birebir doğrulandı; aşağıdakiler o taramada
bulunan, önceden belgelenmemiş veya hafifçe yanlış belgelenmiş noktalar.

**Belgelenmemiş iki alt sistem:**
- **`panel/sessions.mjs`** — genel, host-bazlı bir "oturum kasası": insan-destekli
  giriş (`startLogin` → görünür tarayıcı → kullanıcı elle login olur →
  `confirmLogin` → state kasaya yazılır). `health()` **yalnızca**
  `PROJECT.authCookies`'teki cookie'ye bakıyor (3. parti analytics cookie'lerine
  değil) — aksi hâlde yanlış "oturum bitti" alarmı veriyordu (ölçülmüş). Eski
  `playwright/.auth/<env>-gate.json`'a geriye dönük uyumlu. Yukarıdaki "İKİ
  KATMANLI KİMLİK" modelinin panel tarafındaki daha genel karşılığı budur.
- **`panel/proxy.mjs` içindeki kaydedici** (`qa-rec` / İDDİA MODU) — iframe'deki
  tıklama/fill/check/Enter olaylarını role+ad öncelikli locator'a çevirip panele
  `postMessage` ile bildiriyor; İDDİA MODU'nda tıklama `preventDefault` ile
  yutuluyor. "Koşum kaydı: video, trace, canlı izleme" bölümündeki kayıttan
  **ayrı** bir özellik — bu, gezinmeyi Playwright adımına çeviren mekanizma
  (`panel-data/recorded/` + `playwright.draft.config.ts` ile ilişkili).

**Küçük düzeltmeler:**
- `npm run test:gate` **13 test** çalıştırıyor (`panel/scenario-suggest.test.mjs`),
  14 değil.
- `testcase-gen.mjs` (AI ile test case üretimi), `scenario-suggest.mjs` ve
  `perf-analyze.mjs`'nin aksine **uydurma-içerik kapısına (`gate()`) sahip değil** —
  yalnızca yapısal kontrol var (nodeId var mı, başlık tekrarı var mı). Model
  kabul kriteri uydursa hiçbir katman yakalamaz; yeni bir doğrulama katmanı
  eklenecekse önce burası.
- `route-map.mjs`'deki `CARD_SPECS` bir **fonksiyon referansı**
  (`export const CARD_SPECS = cardSpecs;`), sabit değer değil — doğru kullanım
  `CARD_SPECS()`. Gerçek çağıran kod zaten `cardSpecs()`'i doğrudan
  `card-map.mjs`'ten import ediyor.
- `tests/known-issues.ts`'te **HOMEE-008 numarası yok** — o numarayı taşıyan
  bulgu (banner metinlerinin görsele gömülü olması) yalnızca FINDINGS.md'de,
  bir Figma-diff bulgusu olarak duruyor; `test.fail()` ile takip eden bir
  Playwright testi olmadığı için `known-issues.ts`'e hiç girmedi. Kayıt sayısı
  şu an **11** (HOMEE-001…007, 009, 010, 011, 012 — HOMEE-012 sepet boşluk
  yarışı, madde 12'nin kod karşılığı).
- `tests/fixtures.ts`'teki `memberPage` login mantığı `global-setup.ts`'teki
  `memberLogin()` ile **aynı akışı bağımsız olarak yeniden yazıyor** (ortak
  yardımcıya çıkarılmamış). Giriş formu değişirse iki dosyada da güncelle.
- ~~`panel/public/index.html`'de ölü `stopRun()` referansı~~ — **kapatıldı
  2026-09-08**: Genel Bakış'taki "durdur" artık tanımlı bir `stopRun()` çağırıyor
  (`/api/stop`, sıradakileri de temizler).
- ~~Flowscope'un "Test Case'leri Koştur" prompt'undaki `localhost:8934` /
  `flowTool.tree.v2` talimatı~~ — **kapatıldı 2026-09-08**: `drawer.js` artık
  `GET/PUT /api/scope/tree` ile sunucuyu gösteriyor.
- Repo kökünde eski bir koşumdan (2026-08-18, commit `b0297f9`) kalma, artık
  `.gitignore`'a girse de zaten **izlemeye alınmış** olduğu için hâlâ duran
  dosyalar var: `.results-final.json`, `.results-fix.json`, `.run-final3.log`,
  `.run-fix.log`, `homee-qa-raporu.html` (`scripts/create-full-report.cjs`'in
  ürettiği erken bir rapor). Temizlik adayı; silinecekse kullanıcıya sorulmadan
  silinmez.
- `git remote -v` şu an tek remote gösteriyor: `origin` →
  `github.com/themachinarium/testing-ideal.git`. `homee-release-gate` agent'ının
  betimlediği ayrı `origin` (Automation-workforce) / `ideal` remote çifti bu
  klonda yok — agent talimatı güncel olmayabilir, push hedefini varsaymadan önce
  `git remote -v` ile doğrula.

## Flowscope: Jira durumu → otomatik "Hatalı" (2026-09-01)

Bir düğüme (yaprak, alt öğesi olmayan) Jira Task ID eklendiğinde ya da mevcut
Task ID'lerin durumu ~60 sn'lik canlı poll ile yenilendiğinde (`panel/public/scope/js/jira.js
→ autoFlagFromJiraStatus()`): eklenen Task ID'lerden **bilinen** (Jira'da gerçekten
bulunmuş ve `statusCategory` bilgisi gelmiş) herhangi biri `"done"` kategorisinde
değilse düğüm otomatik olarak **"Hatalı" (❌)**'ya çekilir (`data.js → setNodeStatus`,
durum geçmişine de işlenir).

- **Tek yönlü.** Jira'da statü sonradan "Done" olursa kart **kendiliğinden geri
  alınmaz** — bunu insan kararına bırakıyoruz, tersini otomatikleştirmek "gerçekten
  doğrulandı mı" sorusunu sessizce atlatır.
- **Belirsiz veriyle karar verilmez.** Henüz hiç kontrol edilmemiş ya da Jira'da
  "bulunamadı" damgalı Task ID'ler bu kararı etkilemez — sadece gerçekten bilinen
  durumlar sayılır.
- Jira'nın kendi 3 durum kategorisi (`new`/`indeterminate`/`done`) kullanılıyor,
  belirli statü adlarına (`"Tamam"` gibi) göre değil — proje/board değişse de kural
  kırılmaz.
- Bu kural, mevcut TERS kuralla (❌ işaretlemek en az bir Jira Task ID'yi zorunlu
  kılar, `renderDrawerJiraSection`) çelişmiyor: biri "❌'ysan Jira ID'n olsun" der,
  diğeri "Jira ID'n done değilse ❌'sın" — ikisi birlikte "❌ durumu her zaman
  güncel bir Jira referansıyla gerekçelendirilmiş olsun" istiyor.

### Agent köprüsü: `POST /api/scope/jira/attach` (2026-09-03)

Yukarıdaki kural insanın drawer'dan elle Jira ID eklemesine bağlıydı. Artık
**agent'lar için** sunucu tarafı bir karşılığı var — `panel/scope.mjs →
attachJiraTask({nodeIds, taskId, statusInfo})`, uç: `POST /api/scope/jira/attach`
(token korumalı, `{nodeIds: string[], taskId: string}` gövdesi).

- `homee-product-owner` bir kart açtığında (`POST /api/jira/bug`), bulgunun
  çıktığı düğüm(ler) biliniyorsa bu ucu çağırıp kartı **geri** ağaca bağlıyor.
  `nodeIds` dizi — bir kart birden çok sayfayı etkiliyorsa tek çağrıda hepsi.
- Sunucu, bağlarken `tracker().statusByKeys([taskId])` ile durumu **hemen**
  sorup yukarıdaki auto-flag kuralını aynen uyguluyor — yeni açılan bir kart
  neredeyse hep "To Do" olacağı için pratikte **anında** ❌ görünmesi demek;
  client'taki 60 sn'lik poll'u (o düğümün drawer'ı açık olmalı) beklemiyor.
- Aynı Task ID zaten bağlıysa (case-insensitive) **sessizce atlanır** — agent
  adımı iki kez çalıştırırsa hata almaz. Olmayan `nodeId` `notFound` dizisinde
  döner, tüm çağrı patlamaz.
- `nextId()` (scope.mjs) artık jiraTasks/notes/resourceLinks/statusHistory'nin
  hepsini tarayacak şekilde genişletildi — önceden yalnızca testCases/runs
  taranıyordu, yeni id üretimi (`jira`, `sh` önekleri) client'ın ürettikleriyle
  çakışmasın diye.
- `homee-delivery-lead` bunun **tersini** kontrol ediyor (yazmadan, sadece
  raporda): verdict `pass` yazdığı bir kart Jira'da Done ama bağlı düğüm hâlâ
  ❌'ysa bunu "insan onayı bekliyor" olarak tur raporuna düşürüyor — düğümü
  kendisi ✅'ya çekmiyor, bu kasıtlı (bkz. yukarıdaki "tek yönlü" kuralı).

## Flowscope: kart tıklaması vs. yeniden adlandırma (2026-09-01)

Ağaç/pano/diyagram kartlarındaki isim alanı bir `<input>` ve satırın büyük kısmını
kaplıyor; `attachDrawerOpener` (drawer.js) satır tıklamasında `button, input`
hedeflerini hariç tutuyor. Bunun sonucu: isme tıklamak drawer'ı hiç açmıyor,
sessizce düzenleme moduna düşürüyordu (ölçüldü — kullanıcı karta tıklayıp drawer
açmak isterken adı güncellemiş oluyordu). `chips.js → buildNameInput()` artık
dosya gezgini kuralını uyguluyor: **tek tık drawer açar** (satırın geri kalanıyla
aynı davranış, 220ms gecikmeli — çift tık algılanırsa iptal edilir), **çift tık**
input'u odaklayıp tüm metni seçili yeniden adlandırma moduna girer. `mousedown`'da
`preventDefault()` ile input'un tek tıkta native focus almasını engelliyoruz; bu
üç görünümün (`tree-view.js`, `board-view.js`, `diagram-view.js`) hepsini aynı anda
düzeltiyor çünkü hepsi aynı `buildNameInput()`'u kullanıyor.

## Flowscope: Jira taraması, bilinen hata rozeti, Jira göstergesi, üretim kapısı (2026-09-03)

Altı ekleme birlikte geldi, hepsi canlıda (gerçek panel + tarayıcı, sahte Jira
yanıtı enjekte edilerek) doğrulandı:

- **Ağaç genelinde Jira taraması** — `POST /api/scope/jira/sweep`
  (`panel/scope.mjs → sweepJiraStatuses()`). `attachJiraTask` yalnızca YENİ
  eklenen tek bir Task ID'yi kontrol ederken, bu ağaçtaki TÜM `jiraTasks`'ı tek
  istekte (`collectJiraTaskIds` + tek `tracker().statusByKeys()` çağrısı)
  yeniden değerlendirir. Aynı "bilinen + done değil → ❌" kuralı uygulanır.
  **Tetikleyici**: 2026-09-03'te "Bayat/Bekleyen Test Case'ler" panelinin
  açılışıydı (otomatik); 2026-09-08'de "Dikkat" görünümüne taşınırken elle
  "Tara" düğmesine değişti — bkz. aşağıdaki "Flowscope: 'Dikkat' görünümü"
  bölümü, gerekçe orada.
- **Tersi de raporlanır (uygulanmaz)**: zaten ❌ olan ama bağlı TÜM Task
  ID'leri artık "Done" olan düğümler `reviewSuggested` ile aynı panelde
  "İnsan Onayı Bekliyor" başlığı altında listelenir — ❌'dan otomatik
  ÇIKARILMAZ, bu bilinçli olarak insan kararı (`homee-delivery-lead` de
  aynı kontrolü kendi turunda, yazmadan, `jq` ile yapıyor — bkz. agent dosyası).
- **Ağaç/pano/diyagram satırlarında Jira göstergesi** — `chips.js →
  buildJiraIndicator()`, sadece bağlı Task ID SAYISINI gösterir (canlı "done"
  durumunu DEĞİL — o bilgi ancak bir tarama/poll sonrası bilinir, her zaman yok).
- **Yeni filtre: "Jira: Done Değil"** (`data.js → FACET_META.jiraNotDone`) —
  `state.jiraStatusCache`'e (bir tarama ya da drawer poll'uyla dolar) bakar.
  "Hatalı" facet'inden DAHA DAR: bir düğüm başka sebeple elle ❌ olabilir, bu
  facet özellikle bilinen-Jira-durumuna bağlı olanı hedefler. Hiç tarama
  çalışmadıysa boş döner ("bilinmiyor"u "done değil" saymaz).
- **Test case üretiminde kapı** (`testcase-gen.mjs → gate()`) —
  `scenario-suggest.mjs`/`perf-analyze.mjs`'nin aksine bu üretim yolunda
  hiç kapı YOKTU: `applyFromModel` `findNode(tree, it.nodeId)` başarılı olan
  HER nodeId'yi kabul ediyordu, yani model prompt'ta hiç istenmeyen ama
  ağaçta gerçekten var olan başka bir düğümü "icat edip" oraya case
  yazdırabilirdi. Artık üç çağıranın (`/api/scope/testcases/generate`,
  `/api/jira/testcases/generate`, `/api/scope/testcases/apply` — hem
  `testcase-request.js` hem `panel/public/index.html`'deki kopyala-yapıştır
  akışları) hepsi `allowedNodeIds` gönderiyor; `gate()` bunun dışındaki
  nodeId'leri reddediyor. Geriye dönük uyumluluk için `allowedNodeIds`
  opsiyonel bırakıldı (verilmezse kontrol yok) — ama her mevcut çağıran veriyor.
- **`nodeId` ile bilinen hata → düğüm bağlantısı** (`tests/known-issues.ts`)
  — her kayıt artık hangi Flowscope düğümüne ait olduğunu taşıyor
  (`panel/server.mjs → knownIssues()` ile ayrıştırılır, `/api/meta` üzerinden
  `app.js`'e gelir). Drawer'ın Genel sekmesi eşleşen düğümde kırmızı bir
  "Bilinen Hata" bölümü gösterir. ⚠️ Bu `nodeId`'ler `panel-data/scope/tree.json`
  (gitignore'da) içindeki `seedFromProfile()`'ın ürettiği sıralı `n1,n2,…`
  kimlikleridir — profildeki (`panel/projects/homee.mjs → routes.rules`) sıra
  değişmediği sürece her klonda aynı çıkar; değişirse eşleşme sessizce kaybolur
  (uyarı görünmez olur, hiçbir şey patlamaz).

⚠️ **Bu turda `knownIssues()`'ta İKİ ayrı, önceden fark edilmemiş hata bulunup
düzeltildi** (ölçüldü — eski hâliyle test edilseydi bu özellik yanlış veriyle
çalışırdı):
1. **Kayıt yutma**: eski regex (`detail:\s*\n?\s*"([^"]+)"`) `detail` değeri TEK
   TIRNAKLA yazılmış bir kaydı (içinde kaçışsız `"` geçtiği için, ör. HOMEE-001)
   hiç eşleştiremiyordu; arama bir SONRAKİ kaydın `detail:"..."`ına kadar
   sürüklenip onu YANLIŞ kayda mal ediyordu — **HOMEE-002 ve HOMEE-005 panelin
   "Açık Bulgular" listesinden TAMAMEN kayboluyordu**, HOMEE-001/HOMEE-004 de
   başka bir kaydın detail metnini gösteriyordu.
2. **Kesilme**: `detail` içinde kaçışlı `\"` geçen kayıtlarda (ör. HOMEE-010:
   `pageerror: \"Cannot read...`) `[^"]+` kaçışı anlamadığı için metni ilk
   kaçışlı tırnakta kesiyordu.
   Düzeltme: `id:"..."` eşleşmelerini kaydın SINIRI sayan (bir sonraki `id:`e
   kadar), tırnak tipini (`"`/`'`) ve kaçışları (`\`) karakter karakter takip
   eden bir okuyucu (`readStringLiteral`/`extractField`). Panelin ana
   "Açık Bulgular" listesi de (index.html) aynı fonksiyonu kullandığı için
   şimdi 11 kaydın 11'ini de doğru gösteriyor — önceden 9 gösteriyordu.

## Flowscope: Tasarım Drift Radarı (2026-09-08)

Jira taramasıyla AYNI ilke (`sweepJiraStatuses`), farklı sinyal: "Jira'da done
değil" yerine **"bağlı Figma dosyası, düğümü ✅ dediğin ANDAN sonra değişti mi"**.
✅ (Tamamlandı) VE Kaynaklar'da bir Figma linki olan her yaprak düğüm için
dosyanın Figma'daki `lastModified`'ını düğümün `lastVerifiedAt`'ıyla kıyaslar;
drift varsa düğümü **tek yönlü** ⚠️'ye çeker (otomatik geri alma YOK — Jira
tarafındaki `reviewSuggested` gibi bir "tersi" burada da yok, ⚠️'den çıkış her
zaman insanın elinde) ve neden'i açıklayan bir not düşer.

- **Yeni dosyalar**: `panel/design-drift.mjs` (Figma çağrısı — URL'den dosya
  anahtarı çıkarma + `/v1/files/:key?depth=1` ile `lastModified`, `figma-render.mjs`
  ile AYNI kalıp: `isCut("figma")` şalterine bakar, `noteResponse()` ile kotayı
  işaretler, kimlik/429/ağ hatasında sessizce `null` döner — sweep'in geri
  kalanını durdurmaz), `panel/scope.mjs → collectVerifiedFigmaLinks` +
  `sweepDesignDrift` (ağaç mutasyonu — HTTP bilmez), `panel/public/scope/js/design-drift.js`
  (istemci: `runDesignDriftSweep()`, `jira.js → runJiraSweep()` ile birebir aynı şekil).
- **Uç**: `POST /api/scope/design/sweep` — benzersiz dosya anahtarlarını SIRALI
  sorar (Promise.all değil; kota tek sayaç, paralel istek 429 riskini artırır).
- **Önbellek TAZELİK için 6 saat** (`DESIGN_DRIFT_CACHE_TTL_MS`), tasarım
  ağacı/render önbelleğinin 1 YILLIK TTL'inden (bkz. "Tasarım diff (Figma)")
  BİLEREK çok daha kısa — o önbellek "kota dar, bayat kalsın" derken bu
  önbellek "tazelik sinyali ver ama her panel açılışında gerçek çağrı yapma"
  arasında bir denge.
- ⚠️ **Ölçüm sınırı, kasıtlı**: `/v1/files/:key?depth=1` DOSYA seviyesinde
  `lastModified` veriyor, FRAME seviyesinde değil — "bu dosyada bir şey
  değişti" ile "senin baktığın frame değişti" aynı şey değil. Frame-seviyesi
  tespit tam ağaç ister (pahalı, 429 riski); dosya seviyesi tek ucuz istekle
  kaba ama işe yarar bir "bak" sinyali veriyor.
- **Tetikleyici**: ⚠️ 2026-09-08'de değişti — artık panel açılışında OTOMATİK
  ateşlenmiyor. "Dikkat" görünümündeki Tasarım kartının elle "Tara" düğmesine
  basılınca gerçek istek gider (bkz. aşağıdaki "Flowscope: 'Dikkat' görünümü"
  bölümü). Bu bölümün geri kalanı (önbellek, ölçüm sınırı, sweep mantığı)
  değişmedi.
- Canlıda (gerçek panel + tarayıcı, sahte `/api/scope/design/sweep` yanıtı
  enjekte edilerek) ve doğrudan fonksiyon testiyle (gerçek `tree.json`'a geçici
  test düğümü eklenip yedeklenip geri alınarak) doğrulandı: drift varken ⚠️'ye
  çekme, zaten ⚠️ olanı tekrar işlememe (idempotent), aynı/eski tarihte
  dokunmama, `lastModified` bilinmiyorken karar vermeme, kimlik yokken/şalter
  kesikken sessizce `null` dönme — hepsi ayrı ayrı test edildi.

## Flowscope: Doküman Drift Radarı (Confluence) + genelleme (2026-09-08)

Yukarıdaki Tasarım Drift Radarı **Confluence'a da genişletildi** — kullanıcının
açık kararı: "bu proje sadece Machinarium için değil, herkese açılacak",
yani hiçbir yerde sabit bir `*.atlassian.net` yazılmadı, kimlik/host tamamen
proje-bağımsız çözülüyor.

**Genelleme**: `scope.mjs`'teki Figma'ya özel `collectVerifiedFigmaLinks` /
`sweepDesignDrift` kaldırıldı, yerine kaynak-tipinden bağımsız
`collectVerifiedResourceLinks(tree, type, extractKey)` ve
`sweepResourceDrift(lastModifiedByKey, links, sourceLabel)` geldi. Mutasyon
mantığı (✅ + lastVerifiedAt'tan sonra değişmiş → ⚠️, tek yönlü) kaynağa göre
DEĞİŞMİYOR — yalnızca notun metnine giren `sourceLabel` ("Tasarım" / "Confluence
dokümanı") farklı. `/api/scope/design/sweep` bu genel fonksiyonları `type:"figma"`
ile çağırıyor; yeni `POST /api/scope/confluence/sweep` `type:"confluence"` ile.
İstemci tarafında da aynı ilke: `attention-view.js → buildDriftSection()` tek
bir ortak bileşen, Figma ve Confluence bölümleri yalnızca metin/uç farkıyla
onu çağırıyor (⚠️ bu dosya 2026-09-08'de `attention-panel.js`'ten yeniden
adlandırıldı/yeniden yazıldı — bkz. aşağıdaki "Flowscope: 'Dikkat' görünümü").
İkisi de AYNI rozet sınıfını (`attention-badge-drift`) paylaşıyor — Kaynaklar
panelindeki tüm resource chip ikonları da zaten tek bir mor tona (`#c4b5fd`)
sahip, tutarlılık için yeni bir renk icat edilmedi.

**Yeni dosyalar**: `panel/confluence.mjs` (Confluence API çağrısı —
`extractConfluencePageId(url)` + `lastModifiedByKey(pageIds)`, `design-drift.mjs`
ile aynı önbellek/graceful-degradation kalıbı), `panel/connectors/confluence.mjs`
("docs" yeteneği, connector registry'ye eklendi — `panel/connectors/index.mjs`teki
YETENEKLER listesi ve `DEFAULT_MAP`e `docs: "confluence"` girdisi eklendi),
`panel/public/scope/js/confluence-drift.js` (istemci, `design-drift.js`'in
birebir aynısı, farklı uç).

**Kimlik ve host PROJE-BAĞIMSIZ**:
- Kendi kimlik dosyası var (`~/.confluence-credentials`,
  `CONFLUENCE_EMAIL`/`CONFLUENCE_TOKEN`) ama VERİLMEMİŞSE Jira'nın kimliğine
  (`JIRA_EMAIL`/`JIRA_TOKEN`) düşer — Atlassian Cloud'da aynı hesap/API
  token'ı genelde ikisini birden yetkilendiriyor; aynı email/token'ı iki
  dosyaya kopyalamak gereksiz sürtünme olurdu.
- Host da aynı zincir: `CONFLUENCE_HOST` → profildeki `confluence.host` →
  `JIRA_HOST` → profildeki `jira.host`. Hiçbiri `machinarium.atlassian.net`'i
  SABİT yazmıyor (Jira'nın kendisi bile `panel/projects/homee.mjs`'te tutuluyor,
  çekirdek zaten bunu bilmiyordu — bkz. "Proje profili" bölümü; Confluence de
  aynı disipline uydu).
- Cloud (`*.atlassian.net`) siteleri `/wiki/rest/api/...` altında, Data Center
  `/rest/api/...` altında — ayrım `resources.js → detectResourceType()`teki
  aynı host kontrolüyle yapılıyor.

⚠️ **Ölçüm sınırı, bilerek**: yalnızca URL'sinde sayfa ID'si geçen Confluence
linkleri çözülür (`/pages/<id>/...` ya da `?pageId=<id>`). `/wiki/display/<SPACE>/<Başlık>`
biçimi sayfa ID taşımıyor — çözmek CQL araması (ekstra istek) ister, ilk sürüm
bunu atlıyor ve link sessizce "tanınmadı" sayılıyor (Figma'nın dosya-vs-frame
sınırıyla aynı gerekçe: ucuz + kaba ama işe yarar sinyal).

Test disiplini aynı: syntax kontrolü, gerçek `tree.json`'a yedekli/geri-alınan
doğrudan fonksiyon testleri (URL ayrıştırma, genel `sweepResourceDrift`'in HEM
Figma HEM Confluence linkiyle doğru çalıştığı tek testte doğrulandı), kimlik-yok/
taze-önbellek/bayat-önbellek+kesik-konnektör senaryoları, Jira-fallback kimlik +
host zincirinin gerçek bir HTTP çağrısı mock'lanarak (URL + Authorization header
birebir doğrulanarak) test edilmesi, Cloud (`/wiki` eklenir) vs Data Center
(`/wiki` eklenmez) URL kurulumunun ayrı ayrı doğrulanması, ve canlı panelde
(sahte + gerçek uç, sıfır konsol hatası, Figma sweep'inin genelleme sonrası hâlâ
çalıştığının regresyon kontrolü) — hepsi push'tan önce geçti.

## Flowscope: "Dikkat" görünümü — modaldan kalıcı sekmeye (2026-09-08)

"Bayat/Bekleyen Test Case'ler" **modalı tamamen kaldırıldı**, yerine
Ağaç/Diyagram/Pano'nun yanına dördüncü bir **görünüm** eklendi: **Dikkat**
(`shell.js → VIEWS`, `state.currentView`). Kullanıcı isteğiyle yapılan bir
UI/UX gözden geçirmesi sonucu — eski modalın üç somut sorunu vardı:

1. **Ad yanıltıcıydı**: buton "Bayat/Bekleyen Test Case'ler" diyordu ama içeriği
   çoktan Jira/Figma/Confluence drift'ini de kapsıyordu.
2. **Sayı yanlıştı**: modal başlığındaki rozet SADECE test case sayısını
   sayıyordu, Jira/Tasarım/Doküman bulgularını hiç saymıyordu.
3. **Kademeli yükleme modalı zıplatıyordu**: panel her açıldığında Jira/Figma/
   Confluence sweep'leri OTOMATİK ateşleniyordu, üçü farklı anlarda dolup
   modalın boyunu/içeriğini gözünün önünde değiştiriyordu.

**Çözüm, tek tek:**

- **Modal → kalıcı görünüm**: `attention-panel.js` silindi, yerine
  `attention-view.js` geldi (`renderAttentionView()` diğer view'lar
  —`renderDiagram`/`renderBoard`— gibi `shell.js → renderContent()`'e
  DOM döner, overlay/kapatma YOK). Sekmeler arası geçişte state korunur
  (`state.attentionCategory`, `state.attentionCache`) — Ağaç'a geçip geri
  dönmek sıfırdan kurulum + yeniden tarama gerektirmez.
- **Otomatik ateşleme kaldırıldı**: Jira/Tasarım/Doküman artık panel/sekme
  açılışında OTOMATİK sorgulanmaz. Her biri kendi "Tara" düğmesini bekleyen
  nötr bir kart olarak başlar (`attention-scan-card`); sonucu OTURUM BOYUNCA
  önbellekler (`state.attentionCache.{jira,design,confluence}`, `null` =
  "bu oturumda hiç taranmadı"). Bunun özel bir kazancı var: Jira sweep'inin
  (`statusByKeys`) HİÇ önbelleği yok (bkz. "Flowscope: Jira taraması..."
  bölümü) — artık gerçek Jira çağrısı yalnızca SEN "Tara"ya bastığında gidiyor,
  sekmeye her giriş çıkışta değil. Ayrıca bir de **"Tümünü Tara"** düğmesi var
  (üçünü `Promise.all` ile birden tetikler — kota paylaşan Figma/Confluence
  için bile sorun değil, ikisi ayrı dosya/sayfa anahtarları sorguluyor).
- **Doğru toplam rozet**: "Dikkat" sekmesinin üstündeki sayı (`shell.js →
  refreshAttentionBadge()`, `attention-view.js → attentionBadgeCount()`)
  test case'lerin + (yalnızca TARANMIŞ) Jira/Tasarım/Doküman bulgularının
  toplamı. Taranmamış bir kaynak sayıma 0 olarak GİRMEZ (var olan "0 sorun"
  ile "henüz bilinmiyor" karışmasın diye) — kartın kendisi zaten "henüz
  taranmadı" diyor, rozet buna sessizce "0" eklemiyor.
- **Kategori sekmeleri**: Hepsi · Test Case'ler · Jira · Tasarım · Doküman
  (`facet-pill` görselini yeniden kullanıyor, tek-seçmeli). Tek bir kaynağa
  odaklanmak istediğinde diğer üçü hiç render edilmiyor.
- **Renk dili düzeltildi**: `attention-badge-review` ("ONAY BEKLİYOR" — Jira'da
  done ama düğüm hâlâ ❌) yeşilden (`var(--good)`) accent'e (`var(--accent)`)
  çekildi — yeşil zaten ✅ "Tamamlandı"nın rengiydi, "bu bir başarı" gibi yanlış
  bir sinyal veriyordu; bu bir bilgi/aksiyon sinyali, başarı değil.
- Satıra tıklayınca artık "modalı kapat + drawer'ı aç" değil sadece drawer
  açılıyor (`goToNode()`) — kapatılacak bir modal yok, drawer diğer
  görünümlerde olduğu gibi üstte açılıyor.

Canlıda test edildi (gerçek panel + tarayıcı): otomatik ateşlemenin GERÇEKTEN
kalktığı (sekmeye girince üç kart da nötr, ağ isteği YOK), "Tara"nın gerçek
uca gittiği ve sonucu önbelleklediği, kategori filtresinin doğru daralttığı,
"Tümünü Tara"nın üçünü birden tazelediği, rozetin taranan bulgulara göre
doğru sayıp gizlendiği (`hidden`, inline `display` DEĞİL), satır tıklamasının
drawer'ı doğru düğümde açtığı, Ağaç görünümüne dönüşün bozulmadığı ve sekmeler
arası geçişte "Dikkat" durumunun (önbellek + kategori) korunduğu — sıfır
konsol hatasıyla. Kaynak dosyalardaki (`data.js`, `jira.js`, `design-drift.js`,
`server.mjs`) eski `attention-panel.js` referansları da güncellendi.

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
| `homee-release-gate` | commit/push öncesi son kontrol — sır, guard, ölçüm, koşum durumu (kod yazmaz) |
| `homee-frontend-reviewer` | panel arayüzü ve scope ES modülleri — CSS özgüllüğü, state/data ayrımı, tema token'ları |
| `homee-backend-reviewer` | `panel/*.mjs` — yeni uç, yol kontrolü, token, whitelist, sıfır bağımlılık kuralı |
| `homee-jira-guard` | Jira/tracker'a dokunan her değişiklik — kimlik sızması, ADF, taslak↔gönderim ayrımı |
| `homee-pm-analyst` | kapsam ağacından `docs/feature-inventory.md` + `docs/product-brief.md` üretir |
| `homee-site-crawler` | siteyi kapı oturumuyla gezip kapsam ağacına düğüm ekler — **yıkıcı butona basmaz** |
| `homee-product-owner` | ölçümden **iş üretir**: kart/epic taslağı, ölçülebilir kabul kriteri, gerekçeli öncelik (Jira'ya yazmaz) |
| `homee-delivery-lead` | açık kartları **yürütür**: kuyruk, ön koşul kontrolü, kök nedene göre kümeleme, verdict + taslak, tur raporu |

Altı yeni agent Murat'ın Flowscope deposundan (`muratkocacik-machinarium/Flowscope`)
**fikir olarak** alındı; dosyaları kopyalanmadı — oradaki agent'lar `localhost:8934`
+ localStorage üzerine yazılmış, bizde veri sunucuda. Uyarlamada bu reponun ölçülmüş
tuzakları gömüldü (CSS özgüllüğü, journal `endedAt`, `CARD_SPECS` fonksiyon olmalı,
taslak↔gönderim ayrımı).

`homee-site-crawler`'da bir kural **bilinçli olarak tersine çevrildi**: Murat'ın
agent'ı test ortamında gerçek Kaydet/Gönder/Talep Oluştur butonlarına basıp akışı
tamamlıyor. Bu repoda yıkıcı işlem guard arkasında ve açılan sipariş geri
alınamıyor (iptal akışı POM'da yok) — bizim agent akışı **açar, göndermez**;
geri alınabilir bir mutasyon gerekiyorsa önce izin ister, sonunda geri alır ve
geri aldığını ölçer.

`homee-pm-analyst`'in girdisi `node scripts/scope-snapshot.mjs` çıktısı:
`docs/scope-tree.json` (147 düğüm + özet). **Bu dosya gitignore'da** — müşteri
ürününün ham ekran envanteri ve `origin` remote'u public. Üretilen belgeler
(`feature-inventory`, `product-brief`) commit edilir.

Panel Jira uçları: `/api/jira/cards?view=test|blocked|epic|bugs`, `/api/jira/card/<KEY>`,
`POST /api/jira/comment|transition|bug`.

Agent dosyaları repo bilgisini prompt'a gömer — keşifle zaman harcamasınlar diye.
Yeni bir konvansiyon eklersen ilgili agent'ı da güncelle.
