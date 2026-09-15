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
  sağlayıcıdan bağımsız koşulsuz çalışır. `generateAndApply()` (`routes/ai.mjs`)
  üç özelliğin ortak gövdesi: model → kapı → yaz.
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
curl -H "x-panel-token: $T" "localhost:4646/api/rag/search?q=sepet&k=5"   # token ister (repo metni döner)
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

### 4) İkinci tur (aynı gün): yapısal ayrıştırma + inceleme bulguları

İlk tur mevcut mimariye sadık kalıp "üstüne eklemişti"; inceleme dört gerçek
kusur ve bir yapısal borç gösterdi. Hepsi ölçülerek kapatıldı (65 birim testi,
sunucu 4699'da curl + tarayıcı, UI-only Docker imajı).

**Sunucu yapısı — yeni uçlar `panel/routes/` altına, if-zincirine DEĞİL:**

```
panel/http/router.mjs   createRouter() — kayıtta { auth:true, body:true }; bilinen yol
                         yanlış metod → 405; router.list() tüm uçları ve korumayı söyler
panel/http/sse.mjs      SSE havuzu (add/write/broadcast) — /api/events + diff/koşum olayları
panel/run-engine.mjs    koşum motoru: tek slot, idempotency, kuyruk, journal, kapsam yazımı;
                         spawn ENJEKTE edilir → gerçek alt süreçle birim testli
panel/perf-read.mjs     perf ölçümünü diskten okur (eskiden /api/perf kendine HTTP atıyordu)
panel/routes/ai.mjs     senaryo · perf · test case (prompt/apply/generate) + generateAndApply
panel/routes/runs.mjs   /api/run*, /api/stop, /api/events, /api/runs/history, /api/scope/run*
panel/routes/rag.mjs    /api/rag/status (açık) · /search (TOKEN) · /reindex (token)
panel/routes/assets.mjs /js/*.js — panel arayüzünün ayrı dosyaları (yol kontrolü + .js)
```

`server.mjs`: 3.345 → 2.563 satır. `CTX` (send, audit, engine, sse, readTree, …)
rota modüllerine enjekte edilir; modüller sunucunun kapanışına bağlı değil.
Dispatch `try`'ın başında: kayıtlı uç yoksa eski zincire düşer. **Taşınmayanlar
bilinçli**: Jira, Figma, crawl, record, sessions, oauth uçları zincirde kaldı —
kimlik/tarayıcı gerektirdikleri için ölçülmeden taşınmadı; taşınırken aynı
`register*(router, CTX)` deseni kullanılır.

⚠️ `child.on("error")` motorda var: eskiden `npx` bulunamazsa dinleyicisiz
'error' olayı PANELİ düşürüyordu; şimdi log + `run-end(-1)`.

**Kapatılan kusurlar (ölçülmüş):**
- **Gizli veri sızıntısı** — `panel/rag/redact.mjs`, üç katman: ortamdaki
  `*PASSWORD/*TOKEN/*SECRET/*KEY` DEĞERLERİ (≥6 kr) nerede geçerse geçsin,
  bilinen token kalıpları (sk-ant-, figd_, xox?-, ATATT, Bearer/Basic, PEM),
  `X_PASSWORD=değer` satırları ve şifre geçen satırlardaki `(kullanıcı / şifre)`
  çiftleri. İndeks v2 (v1 bayat sayılıp yeniden kurulur); `scripts/rag-index.mjs`
  `loadEnv()` çağırır ki script de sunucuyla aynı değerleri maskelesin. Ölçüm:
  `password123` sorgusu artık 0 parça döndürüyor, isteme de girmiyor (4 maskeleme).
  `/api/rag/search` token ister.
- **Önbellek süs değil** — `rag/digest.mjs → stableDigest()`: CLAUDE.md'nin kural
  bölümleri (tuzak/hijyen/kural/guard/kimlik/ortam) + `docs/*.md`, deterministik,
  ≤16 k karakter, maskeli. `provider.ask({system, stable, user})` → API yolunda
  ayrı sistem bloğu; `cache_control` YALNIZCA `system+stable` eşiği
  (`AI_CACHE_MIN_TOKENS`, varsayılan 1100 / Haiku 2100) aşınca konur
  (`buildSystemBlocks`, birim testli). `usage.cache_read_input_tokens` deftere
  (`cacheRead`) ve yanıta (`cache`) düşer — sıfır kalıyorsa eşiği yükselt.
  Perf istemi zemin almaz (sayısal ölçüm). CLI yolunda zemin metne eklenir.
- **Arayüz `requestId`/kuyruk göndermiyordu** — `public/js/run-client.js →
  runRequest()`: anahtar = koşum + parametre + 5 sn'lik zaman kovası (çift tık
  aynı isteği tekrarlar, sunucu `deduped` döner); 409 BUSY'de "sıraya al?" sorar,
  evet → `queue:true`. Beş `/api/run` çağrısının hepsi buradan geçer
  (`post('/api/run'` doğrudan çağrısı 0). SSE `run-queued` → aktif pill'in title'ı.
- **Test hijyeni** — `AI_RETRY_MS` (testte 1 ms, 2 sn beklemeler kalktı),
  `provider.resetCliCache()` (import cache-busting hilesi kalktı).
- **CLI model etiketi** — `claude-cli.mjs` en çok çıktı token'ı olan modeli
  seçer, `models` listesini de verir (ilk anahtar haiku gösteriyordu).

**Arayüz dosyaları** (`panel/public/js/`, klasik script, global — satır içi
kod ve `onclick="…"` adla bakıyor; `<script src>` etiketleri satır içi bloktan
ÖNCE): `dialogs.js` (uiToast/uiConfirm/uiPrompt), `run-client.js`
(runRequest/stopRun), `ai-client.js` (loadAiStatus/aiOnay/perfGenerate/
scenarioGenerate). `index.html` 4.331 satır; kalan ~3.000 satırlık satır içi
kodun parçalanması ayrı iş — `onclick` globalleri yüzünden modül geçişi tek
seferde yapılamaz, dosya dosya `window.*` yüzeyiyle taşınır (bu üçü örnek).

**Hâlâ borç (bilinçli):** kuyruk bellekte (yeniden başlatınca kaybolur), bütçe
tavanı süreç başına (iki replika ayrı sayar), maliyet liste fiyatından tahmin,
gerçek anahtarla başarılı çağrı sunucuda ölçülecek.

## Claude hesapları — kişi kendi aboneliğiyle bağlanır (2026-09-10)

**İstek:** ekipte herkesin API anahtarı yok; kişi kendi Claude hesabıyla
çalışsın, sunucuda birden fazla hesap dursun, kişi hangisiyle koşacağını seçsin.

**Yol (Anthropic'in belgelediği):** `claude setup-token` → bir yıllık OAuth
token'ı → panel `claude -p`'yi `CLAUDE_CODE_OAUTH_TOKEN` ile çalıştırır.
Token'la doğrudan API'ye GİDİLMEZ; Claude Code gider, izin verilen kullanım bu.

```
panel/auth/claude-accounts.mjs   depo + relay: save/list/remove/envFor/touch,
                                 startLogin → submitCode → cancelLogin
panel/routes/claude.mjs          /api/claude/accounts[ /login/{start,code,cancel} | /rename | /remove ]
panel-data/claude/accounts/<id>.json   token (0600) — TOKEN BAŞKA HİÇBİR YERDE YOK
panel-data/claude/config/<id>/         her hesabın kendi CLAUDE_CONFIG_DIR'i
```

**İki ekleme yolu, tek depo:**
1. **Panelden giriş (relay).** Panel sunucuda `claude setup-token`'ı sözde
   terminalde başlatır, Anthropic'in giriş adresini karta koyar; kişi kendi
   tarayıcısında girer, dönen kodu panele yapıştırır. Kişinin makinesine
   kurulum YOK.
2. **Token yapıştır.** Kişi kendi makinesinde `claude setup-token` çalıştırıp
   token'ı yapıştırır. Her yerde çalışır; relay yoksa tek yol budur.

⚠️ **Relay yalnız Linux'ta.** Ölçüldü 2026-09-10: `setup-token` BORU üzerinde
hiçbir şey basmıyor, gerçek terminal şart. Node'da yerleşik pty yok, `node-pty`
yerel derleme ister (sıfır bağımlılık kuralı). Çözüm `script(1)`:
`script -qec "<komut>" /dev/null` — Linux'ta (bsdutils, Debian imajında hazır)
borulu stdin ile çalışır; macOS'un BSD `script`i stdin'in TTY olmasını istiyor
ve `tcgetattr/ioctl: Operation not supported on socket` ile düşüyor. Bu yüzden
geliştirici makinesinde kart yapıştırma yolunu gösterir, sunucuda relay açıktır.

**Relay'in ölçülmüş mekaniği:**
- Giriş adresi ekrandaki metinden DEĞİL **OSC-8 köprü dizisinden** okunur
  (`ESC ] 8 ; … ; <URL> BEL`): ekranda adres satırlara bölünüyor, köprüdeki
  hâli tam. Yakalanan adres `scope=user:inference`, PKCE `S256`.
- CLI'nin TUI'si kelimeleri imleç hareketiyle diziyor: metin eşleşmesi
  **boşluksuz** yapılır (`pastecodehere`), yoksa hiç eşleşmez.
- Kod `\r` (Enter) ile gönderilir; girdi ekranda yıldızla maskeleniyor.
- Geçersiz kodda CLI "Invalid code… Press Enter to retry" der ve **ayakta
  kalır** — akış düşürülmez, kişi kodu yeniden yapıştırır.
- Bekleyen akış sunucu belleğinde, 10 dk; süreç yeniden başlarsa akış kaybolur
  ("yeniden başlat"). PKCE doğrulayıcısı o süreçte olduğu için iki adım aynı
  süreçte olmak zorunda.

### Relay'in dört sessiz hatası — hepsi ölçülüp kapatıldı (2026-09-10, ikinci tur)

Sunucuda kod gönderimi **60 sn bekleyip 504 `TIMEOUT` "kodu yeniden dene"**
veriyordu ve neden hiçbir yerde görünmüyordu. Dokploy'a bakıldı: servis edilen
dosyaların blob'ları HEAD ile birebir aynı, yani **deploy düşmüştü, hata
relay'in kendisindeydi.** Docker'da (`node:22-bookworm-slim` + CLI 2.1.267)
gerçek CLI ile ölçüldü:

1. **Süreç çıkışı izlenmiyordu.** CLI'nin HER hata ekranı `OAuth error: …`
   basmıyor: **`account_on_hold`** (abonelik yok/askıda, kuruluş politikası
   uzun ömürlü token'a izin vermiyor) bu öneki KULLANMIYOR ve süreç 500 ms
   sonra kapanıyor (binary'den doğrulandı). Dinleyici olmadığı için panel
   ölmüş sürecin ekranını okumak yerine tam zaman aşımı kadar bekliyordu.
   Artık `child.on("exit")` var; bu yol `CLI_EXIT` (502) döner ve **ekranın
   son satırlarını** hata metnine koyar. Ölçüm: 60 sn → **1,6 sn**.
2. **Token satır kırılmasıyla SESSİZCE KIRPILIYORDU.** Ink metni terminal
   genişliğinde kendisi kırıyor; pty varsayılanı 80 sütun (ölçüm: 346
   karakterlik giriş adresi ekrana 5 satır iniyor). Token ~110 karakter →
   ilk 80'i eşleşiyor, `TOKEN_RE` geçerli sayıyor ve **kırpılmış token
   kaydediliyordu** (kart "bağlandı" der, sonraki her `claude -p` patlar).
   İki katman: `stty cols 400` ile pty genişletildi **ve** `tokenFromScreen()`
   satır sonuna dayanan token'ı birleştiriyor (boşluk içeren satır
   birleştirilmez — "Store this token securely." token'a yapışmasın).
   Token ayrıca satırın bittiği görülmeden kabul edilmiyor: yarım basılmış
   kare kırpılmış token verirdi.
3. **Terk edilmiş akışlar "Hesap ekle"yi kilitliyordu.** `loginId` yalnız
   tarayıcı belleğindeydi; sayfa yenilenince akış sunucuda 10 dk yaşıyor ama
   ne devam edilebiliyor ne iptal edilebiliyordu — üç tanesi birikince yeni
   giriş `429 BUSY` alıyordu (canlıda `pending: 3` ölçüldü, kullanıcı kartta
   hiçbir şey göremiyordu). Artık: `pendingList()` akışları **karta** koyuyor
   (etiket, kalan süre, **devam et** / **vazgeç**), kart satırında da
   "süren giriş: N akış bekliyor" görünür, ve tavan doluyken **en eski akış
   düşürülür** — giriş hiç kilitlenmez. TOKEN ve ekran metni bu listeye girmez.
4. **stdin'de hata dinleyicisi yoktu** — `claude-cli.mjs`'de ölçülen EPIPE
   sınıfı hata burada da vardı: CLI kodu okumadan ölürse yakalanmamış `EPIPE`
   **panelin tamamını düşürürdü**. Artık yakalanıyor.

Yan iyileştirmeler: `plain()` imleç-ileri dizisini (`ESC[<n>C`) **boşluğa**
çeviriyor (ekran "Requstfailed withstatus" gibi yapışık çıkıyordu); ekran
özetinde token maskeleniyor ve **yıldızla maskelenmiş girdi yankısı atılıyor**
(yapıştırılan kodun kuyruğu hata mesajına sızıyordu); zaman aşımı/red
mesajları `alive` alanı taşıyor, arayüz buna bakarak kod kutusunu açık
bırakıyor (kullanıcı aynı kutuda yeniden dener). Panelin periyodik preflight
yenilemesi (10 dk) süren giriş akışında **kartı yeniden çizmiyor** — kod
kutusunu ve içine yazılmış kodu uçuruyordu.

⚠️ `TIMEOUT` hâlâ mümkün — CLI ekrana hiçbir şey basmadan takılabiliyor
(canlıda ölçüldü 2026-09-10: kod gönderildi, 60 sn boyunca tek bayt çıkmadı).
Bu durumda hata mesajı **iki durumu ayırıyor** ve **ağı ölçüyor**:

- `bytes: 0` → kod sürece hiç ulaşmamış olabilir
- yıldızlı yankı var → kod **alındı**, karşılık gelmedi = token değişimi takıldı

### KÖK NEDEN: uzun kod "yapıştırma" sayılıyor, Enter yutuluyor (2026-09-10)

Yukarıdaki teşhis katmanları sayesinde bulundu ve **ölçüldü** (gerçek CLI,
Linux container, aynı akış üç kez):

| gönderim | sonuç |
|---|---|
| 25 karakterlik kod + `\r` **tek yazmada** | CLI cevap verdi (400) |
| **184 karakterlik kod + `\r` tek yazmada** | **CLI HİÇ tepki vermedi** — ekranda yalnız yıldızlar |
| 184 karakterlik kod, Enter **300 ms sonra ayrı** | CLI cevap verdi |

CLI uzun bir girdi bloğunu **yapıştırma** kabul ediyor ve aynı yazmadaki
Enter'ı "gönder" değil **metnin parçası** sayıyor: kod kutuda duruyor, hiç
gönderilmiyor, ekran değişmediği için Ink tek bayt basmıyor ve akış sessizce
zaman aşımına düşüyor. Gerçek OAuth kodu ~105 karakter, yani **üretimde her
zaman eşiğin üstünde** — relay ilk günden beri hiç çalışmamıştı; benim
testlerimdeki 23 karakterlik sahte kod eşiğin altında kaldığı için sorun
geliştirmede hiç görünmedi.

Düzeltme `sendCode()`: önce metin, `ENTER_GAP_MS` (300 ms) bekle, sonra AYRI
bir yazmada `\r`. Ölçüm: 92 karakterlik kod artık 674 ms'de gerçek cevap
alıyor (öncesi: 60 sn sessizlik).

### Token okuma: ekran PARÇALI yazılıyor (2026-09-10, aynı gün ikinci bulgu)

Enter düzeltmesinden sonra relay çalıştı ve CLI token'ı **üretti** — ama panel
onu okuyamadı ve kullanıcıya "hesapta aktif abonelik yok" diye **yanlış sebep**
söyledi (ekranda "Store this token securely." yazıyorken). Sebep: TUI metni
imleç hareketleriyle parçalayarak yazıyor ve parça sınırı `sk-ant-oat`
çapasının ORTASINA denk gelebiliyor ("sk-ant-" … "oat01-…"), ya da token'ın
gövdesine boşluk giriyor.

Üç katman eklendi (`tokenFromScreen`):
1. **Bölge okuyucu (ÖNCE)** — token her zaman "Your OAuth token …:" ile
   "Store this token securely." arasında; o bölgede token'dan başka bir şey
   olmadığı için bölgedeki TÜM boşluklar atılıp aranıyor. Bitiş çapasının
   basılmış olması satırın tamamlandığını da garanti ediyor.
2. Satır okuyucu (sonra) — temiz durumlar ve satır kırılması için.
3. `tokenFromConfigDir()` — CLI yapılandırma dizinine yazmışsa oradan kurtarır.

### Ekran ayrıştırma değil, ekran ÖYKÜNMESİ (`panel/auth/tty-screen.mjs`)

Üç ayrı ayrıştırma denemesi (satır bazlı → bölge bazlı → tam ANSI elemesi)
sırayla çuvalladıktan sonra canlı döküm gerçek sebebi gösterdi: **CLI ekranı
satır satır yazmıyor, imleci konumlandırarak boyuyor.**

```
\e[1C\e[2B sk-ant-…  \e[K token\e[19G(valid\e[26Gfor\e[30G1\e[32Gyear):
```

Token'ın baytları, kendi başlık satırının ("Your OAuth token (valid for 1
year):") baytlarının **arasından** akıyor — yani **bayt sırası ekrandaki
görsel sıra değil**. Akışı düz metin sayan HİÇBİR ayrıştırma bunu doğru
okuyamaz; "başlıkla 'Store this token' arasını al" mantığı da tam bu yüzden
boş döndü (çapa `oauthtoken` akışta bitişik değil).

`renderScreen()` baytları bir terminal gibi işleyip satır tamponu kuruyor:
imleç hareketi (CUU/CUD/CUF/CUB/CHA/CUP/VPA), satır/ekran silme (EL/ED),
DECSC/DECRC (`ESC7`/`ESC8`), CR/LF/BS/TAB. SGR ve `?` ile başlayan özel modlar
görünmez oldukları için atlanıyor. Kaydırma, çift genişlikli karakter ve
alternatif ekran **bilinçli olarak yok** — gerekmiyor, olsaydı sessizce yanlış
sonuç üretebilirdi. `plain()` artık bu fonksiyon; token okuma, hata özeti ve
anahtar kelime araması hepsi GERÇEK ekran üstünde çalışıyor.

⚠️ **EKRAN TAMPONU SIFIRLANMAZ — son ve en ince hata buydu.** TUI ekranı
**farksal** boyuyor: değişmeyen sütunların üzerinden `\e[<n>C` ile atlayıp
yalnız değişeni yazıyor. Kod göndermeden önce `state.raw = ""` yapınca
terminalin "hafızası" siliniyor ve atlanan sütunlarda karakter yerine
**boşluk** kalıyordu: token ekranda `sk-ant- <100 karakter>` diye ikiye
bölünüyor, hiçbir okuyucu birleştiremiyordu (canlı döküm 757 bayt — tam bir
ekran için fazlasıyla küçük, ilk ipucu buydu). Artık akışın tamamı tutuluyor;
gönderim anında yalnız bir **işaret** (`mark`) alınıyor: token TÜM akıştan
(gerçek ekran) okunuyor, hata kelimeleri ise sadece işaretten sonrasında
aranıyor — önceki denemenin ekranda kalan hatası yeni denemeyi düşürmesin.
Ekranı canlandıran her okuyucu için kural: **geçmişi atma.**

⚠️ **LF sütunu da sıfırlıyor.** Gerçek terminalde LF yalnız satır atlar (sütunu
CR sıfırlar); burada sıfırlanmazsa `\n` ile ayrılan ikinci satır ekranın
ortasına kayıyor ve okuma bozuluyordu.

⚠️ **`@xterm/headless` bilinçli olarak KULLANILMADI.** Doğru aday oydu (VS
Code'un terminal motoru) ama panelin sıfır çalışma-zamanı bağımlılığı kuralını
delerdi (bkz. dotenv ve Anthropic SDK'nın sökülme gerekçesi). Bir TUI'nin
kullandığı ~10 dizi için 110 satır yeterli; yetmediği gün `renderScreen()`
arkasına o paketi koymak tek dosyalık değişiklik.

⚠️ **ANSI ELEMESİ TAM OLMAK ZORUNDA.** İlk sürüm yalnız `ESC[<sayı;?><harf>`
biçimini atıyordu; CLI ayrıca `ESC[>4m` (modifyOtherKeys), `ESC[<u` (kitty
klavye), `ESC(B` (karakter kümesi) ve `ESC7`/`ESC8` (imleç kaydet/geri yükle)
basıyor. ESC kontrol karakteri olarak atılınca geriye `[>4m`, `[<u`, `(B` ve
**düz `7`/`8` rakamları** kalıyordu (canlıda görüldü: `(B[>4m[<u78[>4m[<u`).
Bu kalıntı token'ın yanına düşerse eşleşmeyi kırar, **ortasına düşerse token'a
rakam ekleyip BOZUK kaydeder**. `plain()` artık CSI'nin tam dilbilgisini
(parametre 0x30-0x3f, ara 0x20-0x2f, bitiş 0x40-0x7e), OSC/DCS bloklarını,
karakter kümesi seçimlerini ve iki karakterli dizileri eliyor.

**Kurtarma tek komut:** `node scripts/claude-token-recover.mjs` — en yeni
dökümü panelin GÜNCEL ayrıştırıcısıyla yeniden okur (yani ayrıştırıcı
düzeldikçe eski dökümler de kurtarılabilir hâle gelir). `--yapi` token'ı
BASMADAN maskeli yapıyı gösterir; teşhis paylaşırken bunu kullan.

⚠️ **SIRA ÖNEMLİ.** Satır okuyucu önce koşarsa token'ın ortasındaki boşlukta
kesip **kırpılmış** token'ı kabul ediyor: ölçüldü, 105 karakterlik token 53
karakter olarak kaydedildi (kayıt geçerli görünür, her `claude -p` patlar).

Ayrıca: token üretildiği hâlde ayrıştırılamazsa ham ekran
`panel-data/claude/diag/<loginId>.txt` (0600) dosyasına yazılıyor ve hata
mesajı yolunu veriyor — token KAYBOLMASIN, sunucudan `grep -o
"sk-ant-oat[A-Za-z0-9_-]*"` ile kurtarılabilsin. Başarı ekranı basılmışken
hata metni artık "abonelik" demiyor.

⚠️ **Yanlış teşhis dersi:** bu bulunana kadar ölçüm zinciri sırayla "abonelik
askıda", "sunucunun çıkışı yok" ve "IPv6 kara deliği" derken **üçü de
yanlıştı**. Sonuncusu koda da yazılmıştı ve canlıda "container'da IPv6'yı
kapat" diye yanlış tavsiye bastı. Onu çürüten şey **kontrol ölçümü** oldu:
geliştirici makinesindeki Docker container'ı AYNI ağ profilini veriyor
(IPv4 bağlı, IPv6 `ENETUNREACH`) ama orada CLI 371 ms'de cevap veriyor.
`diagnose()` artık IPv6'nın **anında hata** vermesi (normal, istemci IPv4'e
düşer) ile **zaman aşımına düşmesi** (asıl kara delik) arasını ayırıyor.
Bir sonraki teşhis katmanı yazılırken kural: **fark ürettiği iddia edilen
her koşul, çalışan ortamda da var mı diye kontrol edilmeli.**

`panel/auth/claude-net.mjs` + `GET /api/claude/net` (token ister): CLI'nin
gittiği iki adrese ulaşılıyor mu ölçer — `platform.claude.com/v1/oauth/token`
(token değişimi) ve `claude.com/cai/oauth/authorize` (giriş sayfası), ikisi de
CLI binary'sinden çıkarıldı. Kimlik/gövde göndermez; **herhangi bir** HTTP
yanıtı (405/307 dahil) "ulaşıldı" sayılır. `TIMEOUT`/`CLI_EXIT` dönerken bu
ölçüm otomatik koşup hata metnine tek satır olarak giriyor — kullanıcı
"neden takıldı" sorusunu panelden cevaplayabilsin diye.

⚠️ Relay testleri **Linux'ta** koşulmalı: `docker run --rm -v $PWD:/app -w /app
node:22-bookworm-slim node --test "panel/**/*.test.mjs"` (macOS'ta relay
testleri atlanır, 110/111 geçer).

### Aynı turda çıkan ikinci yanlış durum: "oturumsuz CLI = tek tık açık"

CLI sunucudaki imaja **relay için** girdi (2026-09-10, hesaplar turu) ve
`provider.mjs → mode()` bunu "geliştirici yolu" sanıp `mode:"cli"`,
`oneClick:true` döndürüyordu: kutuda hiç kimse giriş yapmamış olduğu hâlde
panel "Tek tık üretim açık (bu makinedeki Claude Code oturumuyla)" diyordu ve
her üretim kimlik hatasıyla düşerdi (canlıda ölçüldü: hesap yok, anahtar yok,
`oneClick:true`).

`cliSessionReady()` eklendi: **çıplak CLI yolu yalnız CLI'nin kendi oturumu
varsa açılır.** Kimlik Linux'ta `<config dir>/.credentials.json` (binary'den
doğrulandı; boş kurulumda dosya yok) — `CLAUDE_CODE_OAUTH_TOKEN` verilmişse de
oturum sayılır. ⚠️ **macOS'ta eleme YOK**: Claude Code kimliği Keychain'e
yazabiliyor, orada dosyanın yokluğu kanıt değil ve geliştirici yolunu kesmek
gerçek bir gerilemeydi. `AI_PROVIDER=cli` zorlaması da elemeye takılmaz.
Kart artık "CLI bulunamadı" demiyor: "CLI kurulu ama oturum açılmamış →
panelden giriş yap ya da anahtar ver".

**Kullanım ve sınır:**
- Üretimde hesap seçilir (`account` alanı): tek tık onayı birden fazla hesap
  varsa aynı anda hesap seçicisidir (`uiChoose`); seçim tarayıcıda hatırlanır
  (`qa-panel-ai-account`, panel ve Flowscope aynı anahtar).
- ⚠️ **OTOMATİK HESAP DEĞİŞTİRME YOK.** Her token bir kişinin aboneliğidir;
  limit dolunca başkasının hesabına düşmek hesap paylaşımıdır ve sözleşmeye
  aykırıdır. Limit hatası `RATE_LIMIT` + hesap adıyla gösterilir, seçim insana
  kalır. Bunu "eksik" sanıp otomatik rotasyon eklemeyin.
- Sıra: hesap varsa **abonelik yolu API anahtarından ÖNCE** gelir (ekip bilinçli
  olarak bağladı); anahtar yolu isteyene açık kalır, elle yapıştırma her zaman var.
- Token hiçbir yanıtta ve hiçbir denetim kaydında geçmez; listede son dört hane
  (`tokenTail`). Defterde hesap ADI durur (`ai-usage.jsonl → account`).
- İmajda Claude Code CLI kurulu (`@anthropic-ai/claude-code@2.1.267`, sabit
  sürüm). Yükseltirken relay testlerini **Linux'ta** koş: CLI'nin ekran biçimi
  değişirse ayrıştırma kırılır.
- `panel-data` volume bağlı değilse hesaplar deploy'da uçar ve herkes yeniden bağlanır.

**Kaldırmanın üç seviyesi (karıştırma):**

| Ne | Nasıl | Kimliğe ne olur |
|---|---|---|
| Geçici kapat | Bağlantılar → Claude rozeti → **kopar** | Hiçbir şey silinmez; tek tık üretim kapanır (`mode: manual`), geri bağlamak tek tık |
| Bir hesabı kaldır | Kart → "Hesap ekle / yönet…" → hesabın yanındaki **sil** | O hesabın token'ı ve `panel-data/claude/config/<id>/` dizini silinir; diğer hesaplar durur |
| Token'ı gerçekten iptal et | claude.ai → Settings | Panel bunu YAPAMAZ; sunucudan silmek token'ı geçersiz kılmaz |

⚠️ Şalter `mode()` içinde SORULUR. Eskiden yalnız `resolveCred` içinde
sorulurdu; API anahtarı yolu kesiliyordu ama hesap ve yerel CLI yolları
kesilmiyordu — **Claude koparılmışken tek tık üretim çalışmaya devam
ediyordu** (ölçüldü 2026-09-10). Yeni bir yol eklerken şalteri `mode()`
seviyesinde sor, tek tek kimlik çözücülerde değil.

⚠️ **Aynı turda bulunan gerçek hata:** `claude-cli.mjs` istemi `child.stdin`e
yazıyordu ama **stdin'de hata dinleyicisi yoktu**. CLI istemi okumadan çıkarsa
(bozuk token, sürüm uyuşmazlığı, çökme) `EPIPE` yakalanmamış hata olarak
**panelin tamamını düşürüyordu** (ölçüldü: sunucu süreci öldü, ECONNREFUSED).
Koşum motorundaki `child.on("error")` ile aynı sınıf. Artık yakalanıyor, sebep
hata mesajına giriyor, panel ayakta kalıyor (`panel/claude-cli.test.mjs`).

⚠️ **Arayüz tuzağı:** `cxRecoverPlan` içinde çok hesaplı sağlayıcı kontrolü
`state === 'ok'` erken dönüşünden ÖNCE olmalı. Sonra konulduğunda ilk hesap
eklenip kart "ok" olunca "Hesap ekle" düğmesi kayboluyor ve **ikinci hesap hiç
eklenemiyordu** (ölçüldü). Hesap eklemek bir kurtarma değil, sürekli bir eylem.

## Provider yapısı — Faz 1 (2026-09-08)

"Connector" artık **provider**: kimlik bildirimi sağlayıcı dosyasının içinde,
çözümü tek depoda, OAuth akışı ve yenileme ortak çekirdekte. İstek: sunucuda
deploy sonrası tak-çalıştır, panelden bağlanma, 20 sağlayıcıya ölçeklenme.

```
panel/providers/<id>.mjs        7 sağlayıcı (claude-code, confluence, figma, jira, linear, mobai, slack)
                                key · label · icon · order · capabilities[] · configured() · check()
                                auth: { apiKey?: {file, vars:[{name,label,secret}], setupUrl, steps},
                                        oauth2?: {authorizeUrl, tokenUrl, scope, var, tokenType, pkce?, readToken?, appSetup*} }
                                probe()? — panelden kaydedilen kimliği doğrular (Figma: ağa çıkmadan)
                                + yetenek nesnesi (tracker / design / docs / chat / device)
panel/auth/credential-store.mjs ortam > panel kaydı (panel-data/credentials/<id>.json, 0600) > ~/.<id>-credentials
                                resolve() SENKRON ve çağrı anında; save/remove/stored; eski panel-data/oauth/ okunurken TAŞINIR
panel/auth/oauth2.mjs           authorizeUrl (state + PKCE) · handleCallback · refreshAccessToken · ensureFresh (tek uçuş) · statusFor
panel/connectors/index.mjs      registry: providers/*.mjs OTOMATİK keşif + yüzey doğrulaması (bozuk dosya açılışta hata)
panel/connectors/credentials.mjs UYUMLULUK: resolveCreds(".<id>-credentials", vars) → depo (eski çağıranlar dokunulmadı)
panel/routes/connectors.mjs     /api/connectors/use|cut · /<id>/credentials (kaydet + DOĞRULA) · /<id>/credentials/remove
                                /api/oauth/<id>/start · /callback · /<id>/client · /<id>/disconnect
```

- **Yeni sağlayıcı = tek dosya.** `providers/` altına koy; listeye satır yok.
  Zorunlu yüzey eksikse panel açılışta hangi dosyanın neyi eksik olduğunu söyler.
- **Kimlik çağrı anında çözülür.** `panel/jira.mjs` eskiden modül yüklenirken
  bir kez çözüp donuyordu; panelden bağlanmak yeniden başlatma istiyordu
  (ölçüldü). `JIRA.available/email/credSource` artık getter, `authHeader()` fonksiyon.
- **Panelden kimlik: kaydet → doğrula → tut ya da geri al.** `POST
  /api/connectors/<id>/credentials` değeri yazar, `probe()` (yoksa `check()`,
  yalnız `ok`/`unknown` kabul) çağırır; başarısızsa önceki kayıt geri gelir.
  Ölçüldü: sahte Jira kimliği önce `warn` ile kabul ediliyordu (Jira 401'i
  "token eskimiş olabilir" sayıyor) — `warn` artık RED. Değerler denetim
  kaydına DÜŞMEZ, yalnız adlar. Ortam değişkeni varsa panel kaydı onu
  ezemez → 409 `ENV_WINS`, kullanıcıya söylenir.
- **OAuth token'ları yenilenir.** Depo `refreshToken` + `expiresAt` tutar;
  Linear/Slack her API çağrısından önce `ensureFresh` (5 dk kala, tek uçuş,
  dönen refresh token eskisinin yerine). Faz 2 (Atlassian 3LO) ve Faz 3 (Figma)
  aynı çekirdeği kullanır; bugün OAuth yalnız Linear ve Slack'te.
- **Arayüz:** her sağlayıcı kartında tek "Bağlan…"; kutu sağlayıcı ne sunuyorsa
  onu gösterir (OAuth izin ekranı / tek seferlik uygulama kaydı / API anahtarı
  alanları — alanlar sunucudan, `auth.apiKey.vars`). "kimlik" satırı kaynağı
  yazar (ortam değişkeni · panel kaydı · OAuth · dosya). Panel kaydı varsa
  "kimliği sil". `cxSetupOpen` kalktı, `token` (yeni sekmede link) yolu kalktı.
- **Şalter (kopar) depoyu görür:** `resolve()` kopuk sağlayıcıda `cut:true`
  döner; Claude anahtarı da artık `claude-code` şalterine bağlı (eskiden
  `.anthropic-credentials` dosya adıyla ayrı bir anahtara bakıyordu, şalter
  onu hiç kesmiyordu).
- Ölçüm: 86 birim testi (`auth/credential-store`, `auth/oauth2` PKCE +
  callback + yenileme tek uçuş + eski depo taşıma, `connectors/registry`);
  4699'da curl: sahte Jira → 400 `VERIFY_FAILED` + kayıt yok, Figma biçim
  kontrolü, env kazanır 409, tokensiz 403, `/api/oauth/*/start` 403/400, 405;
  tarayıcıda Jira kartı → "Bağlan…" → iki alan (token `password`) → kaydet →
  401 metni toast'ta.

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
- ③ ⚠️ 2026-09-11'de redesign edildi (bkz. "Jira kart akışı: YAZ adımı
  redesign") — artık "iki tıklı" tek buton değil, hep görünen İKİ AYRI buton
  ("Taslak Oluştur" / "Gönder"), yorum kutusu baştan açık (serbest yazılabilir),
  Gönder yalnızca kutu doluyken aktif. Statü düğmesi hâlâ seçim yapılmadıkça
  **disabled**, artık kendi ayrı bloğunda.

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

⚠️ **`parent = <epic>` JQL'i alt görevleri kaçırır.** Test statüsündeki alt
görevler epic'in değil hikâyelerin çocuğu oluyor (ör. MAC-7248/7251 → üst kart
MAC-7074) — `parent = <epic>` yazan bir sorter bunları hiç görmez. Bu artık
panelin sabit bir görünümünün hatası değil (bkz. "Jira: Sorter" — sabit
görünümler kaldırıldı) ama kendi özel sorter'ını `parent = <epic>` ile
yazarsan aynı tuzağa düşersin; `project = <proje>` daha güvenli.



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

## Jira: Sorter (2026-09-11)

Jira sekmesindeki "görünüm seçici" artık **Sorter** — isim değişikliği kozmetik
değil, ne olduğunu daha doğru anlatıyor: farklı görsel temsiller arasında
geçiş yapmıyor (Flowscope'taki Ağaç/Diyagram/Pano gibi), sabit bir kart
kümesini FARKLI JQL sorgularıyla filtreleyip sıralıyor.

**Eski hâli (2026-09-11'e kadar) tamamen kaldırıldı**: `panel/projects/<proje>.mjs`
içinde `jira.views(J)` diye bir fonksiyon 4 statik görünüm (Test kolonu, Bloklu,
Tüm redesign epic'i, Bug'lar) tanımlıyordu — değiştirmek için kodu düzenleyip
paneli yeniden başlatmak gerekiyordu. Artık **kodda hiçbir statik sorter tanımı
yok** (`homee.mjs` ve `mto.mjs`'den `views` bloğu tamamen silindi).

**Yeni model, iki katman:**
- **"Tümü"** (`panel/jira.mjs → ALL_SORTER`) — TEK sabit seçenek, silinemez/
  düzenlenemez. JQL'i `project = <JIRA.project> ORDER BY status, key` —
  epic'e DEĞİL, doğrudan bağlı Jira projesine bakıyor (bilinçli: bir epic'i
  olmayan profilde bile çalışsın, bkz. `mto.mjs`'nin `epic: null` olması).
- **Özel sorter'lar** (`panel/jira-sorters.mjs`, `panel-data/jira-sorters.json`)
  — kullanıcının panelden eklediği `{id, label, jql, createdAt}` kayıtları.
  **Tohumlama YOK**: dosya yoksa boş liste, profilden hiçbir şey kopyalanmaz.
  Tam CRUD: ekle/düzenle/sil, hepsi panelden. Kimlik/e-posta alanı YOK —
  panelin önünde henüz kullanıcı girişi olmadığı için (bkz. "Güvenlik modeli")
  sorter'lar bu paneli kullanan herkes için ortak/paylaşılan bir liste;
  bireysel giriş geldiğinde bu alan eklenecek, veri şekli o zaman genişleyecek
  (bugünden veri taşıma sorunu çıkarmasın diye bilinçli tasarım).

**Kaydetmeden önce "Dene"**: hem ekleme hem düzenlemede JQL'i kaydetmeden önce
gerçekten Jira'ya sorup sonuç gösteren ayrı bir adım var (`POST
/api/jira/sorters/test` → `jira.mjs → testJql()`, ilk 5 kartı örnek döner).
"Kaydet" düğmesi ancak "Dene" başarılı olunca açılıyor; **JQL metni Dene'den
SONRA değişirse Kaydet tekrar kilitleniyor** — test edilen metinle kaydedilen
metnin aynı olduğunu garanti etmek için (arayüzde `#sfJql`'in `input`
olayında).

**Uçlar**: `GET /api/jira/sorters` (kimlik istemez, `{all, custom}` döner),
`POST /api/jira/sorters` (`{id?, label, jql}` — id verilip mevcutsa günceller,
yoksa yeni açar, token korumalı), `POST /api/jira/sorters/delete` (`{id}`),
`POST /api/jira/sorters/test` (`{jql}` — diske hiçbir şey yazmaz). `/api/jira/cards`
uç noktasının kendisi (`?view=`) DEĞİŞMEDİ — sadece artık `all` ya da bir özel
sorter id'si kabul ediyor, `test/blocked/epic/bugs` gibi sabit id'ler yok.
`/api/meta`'nın `jira` alanından `views` listesi de kaldırıldı — istemci
sorter listesini artık sayfa yüklenirken bir kere değil, Jira sekmesi HER
açılışında `/api/jira/sorters`'tan taze çekiyor (`loadSorters()`), yeni
eklenen/silinen bir sorter panel yeniden başlatılmadan görünsün diye.

**Boşken teşvik**: özel sorter listesi boşsa (ilk kurulumda hep böyle, tohumlama
olmadığı için) kesik çizgili bir kutu + "+ Sorter ekle" — Dikkat görünümündeki
`attention-scan-card` ile aynı görsel dil.

⚠️ Eski `parent = <epic>` alışkanlığıyla özel bir sorter yazarsan yukarıdaki
"alt görevleri kaçırır" tuzağına düşebilirsin — `project = <proje>` daha güvenli.

## Jira kart akışı: YAZ adımı redesign (2026-09-11)

Kart detayının 3. adımı (YAZ) hem UI hem kullanım olarak yeniden ele alındı.

**Tek buton, iki iş → iki ayrı buton.** Eskiden "Yorumu hazırla" butonu
tıklanınca AYNI eleman "Jira'ya gönder"e dönüşüyordu — güvenli (taslak
oluştur) eylemle geri dönüşü olmayan (Jira'ya yolla) eylem sadece metin
farkıyla ayırt ediliyordu. Artık Sorter'daki "Dene → Kaydet" deseniyle
tutarlı: **"Taslak Oluştur"** (her zaman aktif) + **"Gönder"** (textarea
boşken kapalı) hep birlikte görünen iki ayrı buton.

**Yorum kutusu artık başından görünür.** `<textarea id="jComment">`'daki
`hidden` kaldırıldı — koşum ya da karar kaydı olmasa bile istediğin an
tıklayıp serbestçe yazabilirsin; "Taslak Oluştur" artık zorunlu bir kapı
değil, isteğe bağlı bir kısayol.

**"Gönder" TEK bir mekanizmadan yönetiliyor**: `syncSendBtn()` textarea'nın
`.value.trim()`ine bakıp butonun `disabled`ını ayarlıyor, textarea'nın
`input` olayına bağlı. Metni nereden geldiği (elle yazma, `buildDraft`,
`fillFromVerdict`) fark etmiyor — programatik olarak metin yazan HER yer
(`.value = `) `setCommentText()` üzerinden geçip `syncSendBtn()`'i de
tetikliyor. Bu TEK mekanizma üç ayrı sorunu birden çözdü:
- Serbest yazma artık mümkün (yukarıdaki madde).
- **Gerçek bir hata düzeldi**: Verdict sekmesinden "kart →" ile gelince
  (`verdictToCard` → `fillFromVerdict`) taslak metni textarea'ya yazılıyordu
  ama `hidden` kalkmadığı VE buton `disabled` senkronlanmadığı için görünmüyordu
  — kullanıcı Verdict'ten getirdiği metni hiç göremiyordu. Artık `hidden` zaten
  yok, `setCommentText` `syncSendBtn`'i çağırdığı için Gönder de doğru açılıyor.
- Tutarlılık: tek kod yolu, üç ayrı özel-durum yaması değil.

**Taslak kaynağı önceden görünüyor.** Kaynak SEÇİCİSİ yok (otomatik
birleştirme aynen sürüyor) ama "Taslak Oluştur"a basmadan ÖNCE `draftAvailLine()`
şunu gösteriyor: *"Taslağa girecek: ✓ Koşum (7/7 geçti · 2026-09-05) ·
✓ Karar (Geçti)"* — hangisi yoksa "— Koşum kaydı yok" / "— Karar kaydı yok".
Bu veri `openCard()` içinde kart açılırken bir kere hesaplanıp `c.linkedVerdict`
olarak saklanıyor (`/api/verdicts`'i `.card` alanına göre süzerek — bir
verdict'in KENDİ anahtarı card anahtarıyla aynı olmak ZORUNDA değil, bu yüzden
`readVerdict(cardKey)` gibi doğrudan bir arama YETMEZ). **KARAR kaydedilince
bu satır kartı yeniden açmadan CANLI güncelleniyor** (`saveCardVerdict` →
`CARD.linkedVerdict` günceller → `.cf-avail` metnini yeniden yazar).

**"Taslak Oluştur" üzerine yazmadan önce sorar.** Textarea'da zaten metin
varsa (elle yazılmış olabilir) `uiConfirm` ile onay ister — taslak butonuna
yanlışlıkla basıp yazdığın şeyi kaybetmeyesin diye.

**Statü Değiştir artık ayrı bir blok.** Eskiden Yorum'la aynı satırda duran
statü seçici + "Statüyü uygula" düğmesi artık kendi alt-başlığıyla (`.cf-subtitle`)
görsel olarak ayrılmış bağımsız bir bölüm — mekaniği değişmedi (seç → onayla
→ uygula), sadece Yorum'la karışmıyor.

**Ölü kod temizlendi**: `fillFromRun(key)` — `buildDraft`'ın yaptığı
birleştirmenin SADECE koşum kısmını yapan, hiçbir yerden çağrılmayan bir
fonksiyondu (muhtemelen eski bir tasarımda üç ayrı "Koşumdan doldur / Karardan
doldur / İkisini birleştir" butonu olacaktı, sadeleşirken sadece ikisi kaldı).
Tamamen kaldırıldı. `fillFromVerdict(key)` KALDI — Verdict sekmesinden gelen
"o tek verdict'in metni, koşumla seyreltilmeden" ihtiyacı gerçek ve farklı bir
senaryo, `buildDraft` onun yerini tutmuyor.

Test disiplini: syntax kontrolü, canlı panelde sahte bir kart yanıtı enjekte
edilerek tam akış (serbest yazma → Gönder açılıyor, "Taslak Oluştur" dolu
textarea'da onay istiyor, KARAR kaydedince "Taslağa girecek" satırının canlı
güncellendiği, `fillFromVerdict`'in artık görünür VE Gönder'i açtığı,
`buildDraft`'ın koşum+karar'ı `———` ile birleştirdiği, Statü Değiştir'in ayrı
blok olarak göründüğü) — sıfır konsol hatasıyla doğrulandı. Test sırasında
diske yazılan sahte verdict kaydı (`panel-data/verdicts/TEST-1.json`) silinip
temizlendi.

## Panel ↔ Flowscope: hafif çapraz-gezinme (2026-09-12)

Panel'in Jira sekmesi ve Flowscope'un Jira entegrasyonu **iki farklı soruya**
cevap veriyor — Panel "hangi kartlara bakmalıyım" (Sorter/JQL, sayfaya bağlı
değil), Flowscope "bu sayfa sağlıklı mı" (düğüme bağlı `jiraTasks[]`, done
değilse ❌). Veri modelleri **BİLEREK birleştirilmedi** (Panel'in Sorter'ı az
önce epic'e bağlılıktan kurtarıldı, tekrar sayfaya bağlamak bunu geri getirirdi)
— sadece iki yönlü, hafif bir gezinme köprüsü eklendi:

- **Kart detayında Flowscope linki**: `/api/jira/card/<KEY>` artık `scopeNodes`
  alanı da döndürüyor (`panel/scope.mjs → findNodesByJiraTask`, ağaçta bu
  Task ID'ye sahip TÜM yaprak düğümleri — bir kart `attachJiraTask` ile birden
  çok sayfaya bağlanabildiği için tek eşleşmeyle durmaz). Kart başlığının
  altında varsa "Flowscope: Homee › 01 Anasayfa · Homee › 06 Sepet" satırı
  çıkıyor, her biri `/scope/#node=<id>` linki (yeni sekmede — Flowscope'un
  zaten desteklediği "paylaşılabilir link" mekanizması, `app.js` sayfa
  açılışında `location.hash`ı okuyup ilgili düğümün drawer'ını otomatik açıyor).
- **Sorter listesine ikinci sabit seçenek**: **"Flowscope'a Bağlı"**
  (`panel/jira.mjs → flowscopeSorter()`). "Tümü"nün aksine JQL'i HER ÇAĞRIDA
  yeniden hesaplanıyor (`key in (...)`, `collectJiraTaskIds(tree)` — Flowscope
  için zaten var olan bir fonksiyon, sıfırdan yazılmadı) çünkü bağlı Task
  ID'ler çalışma zamanında değişiyor. Ağaçta hiç bağlı kart yoksa `null`
  döner ve sorter dropdown'da hiç görünmez — boş `key in ()` geçersiz JQL
  olurdu. "Tümü" gibi bu da sabit: düzenlenemez/silinemez, `syncSorterButtons`
  ikisini de "custom değil" sayıyor.
- **Üçüncü sabit sorter — "Flowscope'a Bağlı Değil"** (2026-09-12,
  `panel/jira.mjs → flowscopeUnlinkedSorter()`). `flowscopeSorter()`'ın
  simetriği: `project = <proje> AND key NOT IN (...)` diyerek hiçbir sayfaya/
  düğüme bağlanmamış kartları (QA modelimizin dışında kalan iş kalemleri)
  gösterir. Bağlı kart hiç yoksa (`keys.length === 0`) bu sorgu "Tümü" ile
  birebir aynı sonucu verirdi — anlamsız bir kopya olmasın diye o durumda
  `flowscopeSorter()` İLE TUTARLI olarak `null` döner, ikisi birlikte kaybolur.

Test disiplini: syntax kontrolü + gerçek `PANEL_PROJECT=homee` ile doğrudan
`flowscopeSorter()`/`flowscopeUnlinkedSorter()` çağrılıp gerçek ağaçtaki 15
benzersiz Task ID'nin doğru JQL'e (hem `IN` hem `NOT IN` yönünde) girdiği
doğrulandı, canlı panelde sahte kart yanıtıyla (gerçek Jira kimliği bu
ortamda yok) kart detayındaki Flowscope linklerinin doğru render olduğu VE
tıklanınca gerçekten `/scope/#node=<id>`'ye gidip doğru düğümün drawer'ını
açtığı, Sorter dropdown'ında üç sabit seçeneğin de doğru sırada göründüğü ve
her biri seçilince Düzenle/Sil'in gizli kaldığı, kimliksiz ortamda
`?view=flowscope` ve `?view=flowscope-unlinked`'in çökmeden gerçek hata
döndürdüğü — sıfır konsol hatasıyla doğrulandı.

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

## Flowscope ↔ panel: çift yönlü canlı bağ (2026-09-14)

**İstek:** "Flowscope'ta olan her şey paneli dinamik olarak etkilesin, API'lerle."

Önceki durum ölçüldü: panelin altı bölümü (Genel bakış · Koşumlar · Sonuçlar ·
Jira · Performans · Site canlı) **profildeki elle yazılmış listelerden**
besleniyordu (`quickRoutes`, `routes.rules`, `cardSpecs`); Flowscope ise aynı
ürünün canlı ağacını tutuyordu. İkisi birbirini hiç görmüyordu: ağaca sayfa
eklemek panelde hiçbir şey değiştirmiyor, panelden koşulan test ağaçta **hiç iz
bırakmıyordu** (ağaç her zaman "hiç koşulmamış" görünüyordu).

### Okuma yönü: ağaç → panel (`panel/scope-bridge.mjs`, SAF katman)

fs/HTTP/PROJECT bilmez, ağacı parametre alır → birim testli (`scope-bridge.test.mjs`, 12 test).

| Fonksiyon | Ne üretir | Paneldeki karşılığı |
|---|---|---|
| `deriveRoutes` | rota tasıyan düğümler (+runId, specs, jiraKeys) | Site (canlı) butonları, perf hedefleri |
| `routesWithFallback` | ağaçta rota yoksa profil listesi (`source:"profile"`) | rota butonları asla kaybolmaz |
| `deriveSummary` | düğüm/kapsam/case/Jira sayaçları | Genel bakış "Kapsam" şeridi |
| `deriveJiraIndex` | kart → düğüm dizini | Jira sekmesindeki "Kapsam" kolonu |
| `deriveRuns` | `runRef`li koşumlar (+`known` whitelist işareti) | Koşumlar'daki "Kapsam ağacından" grubu |
| `nodesForSpec` / `deriveCases` | spec ↔ düğüm bağı, ağaçtaki case'ler | Sonuçlar sekmesi rozetleri |

Uçlar `panel/routes/scope.mjs` (if-zincirine DEĞİL): `GET /api/scope/summary`
(altı bölümün ortak kaynağı) · `/routes` · `/jira` · `/perf-targets` ·
`POST /backfill-routes` (token).

⚠️ **Rota iki kaynaktan gelir, bu sırayla:** düğümdeki **göreli** `route`
("/sepet") ve `resourceLinks` içindeki **mutlak** adres (crawler böyle yazıyor).
Göreli olan öncelikli çünkü **ortamdan bağımsız** — `HOMEE_ENV` test'ten
staging'e geçince aynı ağaç doğru adresi gösterir. `seedFromProfile` artık
göreli rotayı da yazıyor; ondan ÖNCE tohumlanmış ağaçlar için
`backfillRoutes()` var (panelde "kapsami panele bagla" düğmesi, tekrar
çalıştırmak güvenli, rotası olan düğüme dokunmaz).

### Yazma yönü: panel → ağaç (`panel/scope.mjs`)

- `applyRunResultsBySpecs` — **panelden tetiklenen HER koşum** (yalnız
  Flowscope'tan başlatılan değil) sonucu, spec'e `runRef.specs` ile bağlı
  bütün düğümlere yazar. Koşum motorunda `finish()` içinde, `skipNodeId` ile
  Flowscope'tan gelen koşum iki kez yazılmaz.
- `applyPerfToTree` — perf ölçümü rota→düğüm eşlenip `node.perf`'e **üzerine
  yazılarak** işlenir. Not olarak yazılsaydı her süpürme düğümün not listesini
  bir satır büyütür, insanın notları arasında kaybolurdu. Aynı `measuredAt`
  ikinci kez yazılmaz (`/api/perf` her sekme açılışında okunuyor).
- `writeRunIntoNode` — yukarıdaki ikisi ve `applyRunResults` aynı gövdeyi
  paylaşır; iki kopya kaçınılmaz olarak birbirinden saparadı.

⚠️ **Bağ TAHMİN EDİLMEZ**: yalnız açık `runRef.specs` eşleşmesi. URL/isim
benzerliğine dayalı eşleme yanlış düğüme otomatik case yazar ve bunu fark etmek
neredeyse imkânsız olurdu (`scope-writeback.test.mjs` bunu ölçüyor: bağlantısız
düğüme hiç dokunulmadığı ayrı bir test).

⚠️ **Düğümün KENDİ durumu değiştirilmez** (R19, mevcut kural): otomatik koşum
insanın verdiği durumu sessizce ezmez.

### Canlı bağ: `scope-changed` SSE

`writeTree()` tek kapı → `onTreeChange()` dinleyicileri → `broadcast("scope-changed", {reason})`.
Ağacın değiştiği **sekiz yol** (drawer düzenlemesi, Jira bağlama, üç sweep,
koşum, perf, test case üretimi) için ayrı ayrı olay eklemek birini unutmak
demekti.

- **Panel** (`public/js/scope-client.js`, klasik script): olayı alır →
  `scopeRefresh()` → `onScopeChange` dinleyicileri etkilenen bölümleri çizer.
  Panelin kendi `EventSource`'u kullanılır; ikinci bağlantı açılmaz.
- **Flowscope** (`scope/js/live.js`): `reason:"edit"` (kendi PUT'u) HARİÇ her
  değişiklikte ağacı tazeler, açık drawer'ı yeni düğüm nesnesine bağlar, toast
  basar. ⚠️ **Metin alanı odaktayken tazeleme ERTELENİR** (odak kaybında yapılır)
  — sunucudan gelen bir koşum sonucu kullanıcının yazdığı notu ekrandan silmemeli.
- Olay **veri taşımaz**, sadece haber verir: alan taraf taze okur, iki sürüm
  arasında şema uyuşmazlığı sessiz yanlış gösterime dönüşmez.

### Perf hedefleri de ağaçtan

`scripts/perf-sweep.mjs` sıraya girdi: `--routes` > **kapsam ağacı** >
`tests/routes.ts`. Okuma script'te (panelde değil) ki ölçümü kim tetiklerse
tetiklesin (panel, CLI, ileride cron) aynı hedef listesi kullanılsın. Koşum
başında hangi kaynağın kullanıldığı log'a basılır.

### Test case üretimi: düğme artık gerçeği söylüyor

"Test Case İste (Claude Code)" yazısı kopyala-yapıştır turunu anlatıyordu; oysa
sunucuda Claude hesabı bağlıyken (bkz. "Claude hesapları") aynı düğme modeli
kendisi çağırıp case'leri doğrudan ağaca yazıyor. `applyGenerateLabel()`
(`testcase-request.js`) `/api/ai/status`'a bakıp yazıyı **"Test Case Üret"**e
çeviriyor ve başlıkta hangi hesapla koşacağını söylüyor. Sağlayıcı yoksa yazı
değişmez — elle yol hâlâ orada. Çizim ağ isteğine bekletilmez (drawer açılışı
yavaşlamasın).

⚠️ Panel çekirdeğine proje adı sızmaz kuralı burada da geçerli: `npm run
panel:check` ilk turda `scope-bridge.mjs`'teki iki yorum yüzünden kırmızı
verdi (örnek kart anahtarı + ortam değişkeni adı), ikisi de nötrlendi.

## Site (canlı) iframe'i sunucuda: TEK DOMAIN modu (2026-09-15)

Kullanıcı kararı: ikinci domain bağlamak yerine **proxy panelin kendi
origin'inden** servis edilsin. Proxy artık iki yerde birden çalışıyor:

| Mod | Adres | Ne zaman |
|---|---|---|
| kendi portu | `http://localhost:<PANEL_PORT+1>` | istek yerelden geliyorsa (lokal davranış DEĞİŞMEDİ) |
| ikinci domain | `PANEL_PROXY_PUBLIC_URL` | açıkça verilmişse — her yerde kazanır, tarayıcı izolasyonu korunur |
| **tek domain** | `<isteğin origin'i>/__site` | ikisi de yoksa ve istek yerel değilse |

Seçim İSTEK BAŞINA (`proxyUrlFor(req)`), `Host` başlığına bakarak — ortam
değişkenine değil (aynı gerekçe `landingUrlFor`'da da var).

**Nasıl çalışıyor (dördü de gerekli, biri eksikse sayfa bozuk gelir):**
1. `createProxyHandler` — proxy gövdesi kendi sunucusundan ayrıldı; aynı işleyici
   hem kendi portunda hem panelin `/__site/` öneğinde koşuyor (iki kopya
   kaçınılmaz olarak birbirinden saparadı).
2. **HTML yeniden yazımı** (`rewriteAbsolutePaths`, 8 birim testi) — `src/href/
   action/poster`, `srcset` ve CSS `url()` içindeki mutlak yollar öneğe taşınır;
   `//host/...` ve zaten taşınmış yollar ellenmez. `<base href="/__site/">` de
   eklenir (göreli adresler için).
3. ⚠️ **ÖNEK TARAYICIDA HEMEN SİLİNİR** (`history.replaceState`, enjekte edilen
   script `<head>`te, uygulama paketlerinden önce). Sebebi ölçüldü: Next.js
   hidrasyonda `location.pathname` okuyup rota eşliyor; `/__site/sepet` hiçbir
   rotaya uymuyor ve **"Sayfa Bulunamadı"** basıyor (aynı sayfa port modunda
   "Sepetim" gösterirken). Kontrol ölçümü olmasa bu "proxy bozuk" diye
   okunurdu.
4. **Önek silindiği için sonraki istekler panelin köküne düşer** — `/images/...`,
   `/_next/...`, hatta sitenin kendi `/api/auth/get-token`i (ölçüldü: 22 görsel
   + 3 API çağrısı 404). Çözüm: proxy HTML yanıtına bir **işaret çerezi**
   (`qa_site_proxy=1`) koyuyor ve panel, **tanımadığı** bir yolda 404 vermeden
   önce isteği siteye devrediyor (dispatcher'ın EN SONUNDA).

⚠️ **Referer ile ayırt EDİLEMİYOR**: ana sayfada önek silinince iframe'in adresi
de `/` oluyor, yani panelin kendi sayfasıyla aynı. Bu yüzden karar "panel bu yolu
tanıyor mu" sorusuna dayanıyor, isteğin nereden geldiğine değil.

⚠️ **Panelin "Bilinmeyen uc" teşhisi**: işaret çerezi olan bir tarayıcıda artık
o mesaj yerine sitenin 404'ü gelir. Panel kendi yollarını (`/api/*` dahil) her
zaman önce cevapladığı için gerçek panel çağrıları etkilenmiyor.

⚠️ **AYNI ORIGIN'İN BEDELİ**: iframe panelle aynı origin'de, yani hedef sitenin
JS'i teorik olarak panelin DOM'una (ve oradaki panel token'ına) erişebilir.
Hedef site bizim test ortamımız olduğu için kabul edilen risk. Yabancı bir siteyi
gömerken `PANEL_PROXY_PUBLIC_URL` ile AYRI DOMAIN kullanılmalı — tarayıcı
izolasyonu ancak orada var.

⚠️ Enjekte edilen script bir **template literal'in içinde**: yorumlarda bile
backtick KULLANMA. Literal'i kapatır ve içeriği koda çevirir (ölçüldü:
`Proxy hatasi: __site is not defined`).

## Proxy'nin adresi: ikinci domain yolu (2026-09-14)

⚠️ **`panel/proxy.mjs` tarayıcıya sabit `http://localhost:<port>` diyordu** —
yani iframe **bir domain arkasında hiç çalışmadı**. Ölçüm (canlı):
`/api/meta → proxyUrl: "http://localhost:3001"`; o adres kullanıcının KENDİ
makinesini gösteriyor, container'ın içindeki portu değil. Panel https ise
tarayıcı ayrıca karışık içerik olarak da engeller. Lokalde çalışıyor olması
yanıltıcı: orada `localhost:4647` gerçekten var.

`PANEL_PROXY_PUBLIC_URL` verilirse proxy hem döndüğü adreste hem yönlendirme
yeniden yazımında onu kullanır. Sunucuda proxy portuna (container içi
`PANEL_PORT + 1`) **ikinci bir domain** bağlanmalı ve bu değişken o adrese
ayarlanmalı. Verilmezse davranış aynen eskisi gibi.

⚠️ **Neden ikinci domain, panel origin'inde bir alt yol değil:** sitenin mutlak
yolları (`/assets/...`, framework'ün çalışma anında kurduğu adresler) alt yolda
panelin köküne düşer; HTML yeniden yazmak JS'in kurduğu adresleri yakalayamaz ve
sayfa yarım render olur. Ayrı origin'de hiçbir yeniden yazma gerekmiyor.
Panelin `message` dinleyicileri origin doğrulamadığı için (`qa-nav`, `qa-scroll`,
`qa-rec-*`) yeni domain ek değişiklik istemiyor.

⚠️ **Değişken verilmemişse iframe HİÇ yüklenmiyor artık** (`proxyUsable()` →
`showProxyWarning()`): eskiden çerçeve "localhost refused to connect" diyordu ve
sebebi hiçbir yerde yazmıyordu (canlıda görüldü 2026-09-15). Şimdi yüklemeden
önce soruluyor — proxy `localhost` derken panel localhost DEĞİLSE, ya da https
panelde http çerçeve varsa (karışık içerik) — ve yerine ne yapılması gerektiğini
yazan bir kutu + "siteyi yeni sekmede aç" çıkıyor. Panel de proxy de yereldeyse
davranış aynen eskisi gibi (ölçüldü: iframe `localhost:4700`'ü yüklüyor).

## İKİ AYRI "paket" var — karıştırma (2026-09-14)

Aynı gün, iki ayrı oturumda iki farklı özellik "paket" adını aldı. İkisi de
duruyor çünkü gerçekten farklı şeyler; etiketler ayrıldı:

| | Paketler | Tür paketleri |
|---|---|---|
| Ne | Var olan test CASE'lerinin koşulabilir koleksiyonu | Case ÜRETİLİRKEN seçilen test TÜRÜ kombinasyonu |
| Nerede | Flowscope sol sidebar → Test Suite grubu | Drawer → QA Analizi → tür seçicisinin altı |
| Depo | `panel-data/scope/packages.json` | `panel-data/type-packages.json` |
| Kod | `panel/packages.mjs` · `routes/packages.mjs` · `scope/js/packages.js` | `panel/type-packages.mjs` · `routes/scope.mjs` · `scope/js/type-packages.js` |
| Uç | `GET/PUT /api/scope/packages` (tüm listeyi yazar) | `GET /api/type-packages`, `POST` + `/delete` |

Biri üretimin GİRDİSİ, diğeri üretimin çıktısının gruplanması. Yeni bir "paket"
eklemeden önce hangisinin genişlemesi gerektiğine karar ver.

## Tür paketleri (`panel/type-packages.mjs`, 2026-09-14)

Drawer'daki "Test Türleri (birden fazla seçilebilir)" listesi kodda sabit ve öyle
kalıyor; eksik olan şey türler değil, **aynı kombinasyonu her düğümde elden
yeniden seçmek** zorunda olmaktı. Paket = o kombinasyonun bir ismi.

- Depo `panel-data/type-packages.json`, desen `jira-sorters.mjs` ile **birebir
  aynı** (aynı id üretimi, aynı "tohumlama yok" kuralı) — ikinci bir kalıcılık
  deseni icat etmek aynı hataların ikinci kez yapılması olurdu.
- Uçlar `panel/routes/scope.mjs`: `GET /api/type-packages` (açık),
  `POST /api/type-packages` ve `/delete` (token). Doğrulama hataları kullanıcıya
  aynen gösterilir (400).
- Arayüz `scope/js/type-packages.js` + drawer'daki tür satırının altı. Liste
  sunucuda tutuluyor (localStorage DEĞİL): paket panele giren herkes için aynı.
- ⚠️ **Türler kayıtta doğrulanmaz**, uygulama anında bilinmeyen tür sessizce
  elenir ve rozette gerçek sayı yazar. Tür listesi değiştiğinde eski bir paket
  yüzünden kayıt reddedilseydi kullanıcı sebebini anlamazdı.
- `uiPrompt` Flowscope tarafında YOKTU, `dialog.js`'e eklendi (panelle aynı API,
  aynı asenkron tuzak: `await` şart, vazgeçince `null` döner — boş string ile
  karıştırma).

## Test Case'ler sayfası + panelden paket koşumu (2026-09-15)

**Test Case'ler** (`scope/js/testcases.js`) artık dolu: ağaçtaki BÜTÜN case'ler
tek listede — hangi düğüme bağlı, kaç adım, son koşumu, hangi paket(ler)de.
Süzgeçler: arama · durum · **pakette değil** · hiç koşulmamış · otomatik/elle.
Satıra tıklamak case'in düğümünün drawer'ını açar.

⚠️ **SIRA**: `openDrawer` sekmeyi `genel`e SIFIRLIYOR — `state.drawerTab`
ondan SONRA verilip `renderDrawer()` çağrılmalı, yoksa kullanıcı case
listesinden geldiği hâlde Genel sekmesine düşer (ölçüldü).

⚠️ Paket üyeliği **etkin** içerikten hesaplanır (`collectEffectiveTestCaseItems`):
paketler iç içe olabildiği için alt pakete eklenmiş bir case üst paketin de
içindedir; doğrudan `items`e bakmak "pakette değil" diye yanlış rapor verirdi.

**Panelden paket koşumu**: `GET /api/scope/packages/runnable` paketi spec
listesine çözüyor (`packages.mjs → resolvePackageItems`, iç içe + **çevrim
korumalı**, 6 birim testi), panel bunu TEK parametreli koşumla çalıştırıyor
(`id:'custom'`, spec'ler `tests/` altındaki dosyalarla doğrulanıyor — whitelist
güvenliği yerinde).

⚠️ Flowscope'taki paket koşumu SIRALI (düğüm düğüm, her biri ayrı koşum,
`packages-run.js`), panelinki TEK koşum. İkisi de aynı `results.json`'ı üretir
ve sonuç aynı şekilde ağaca yazılır (`applyRunResultsBySpecs`).

⚠️ **Otomatik karşılığı olmayan case'ler koşulmaz** ve sayısı satırda YAZILIR
("10 case · 3 spec · 7 elle"). Paketin yarısının sessizce atlanması, "paketi
koştum" diyen kullanıcıyı yanıltırdı.

## Ortam okuma: script'ler `.env`i DOĞRUDAN okumaz (2026-09-15)

`scripts/perf-sweep.mjs` ve `scripts/figma-offline-diff.mjs`
`fs.readFileSync(".env")` yapıyordu. Container'da `.env` YOK (`.dockerignore`
onu bilerek dışarıda bırakıyor, kimlikler ortam değişkeniyle geliyor) →
Performans sekmesindeki "Yeniden ölç" sunucuda **ENOENT ile düşüyordu**
(kullanıcı "env hatası" olarak bildirdi). İkisi de artık `loadEnv()` + 
`process.env` kullanıyor (panelin geri kalanıyla aynı kural, bkz. "QA Paneli").

Aynı turda: kapı oturumu (`playwright/.auth/*.json`) da imajda yok — perf
süpürmesi dosya yoksa **oturumsuz** koşuyor ve sebebi log'a yazıyor (tamamen
düşmektense kapı ekranını ölçmek yeğdir).

## "0/88" yanılgısı (2026-09-15)

Genel bakıştaki ilk KPI, hiç koşum kaydı olmayan kurulumda `0/88` yazıyordu ve
bu "88 case'in hepsi kaldı" gibi okunuyordu — oysa anlamı "bu makinede koşum
kaydı yok" (`panel-data/case-history.json` boş). Kayıt yoksa artık sayı değil
**durum** yazılıyor: `– · kosum kaydi yok · 88 otomatik case`.

## Jira: "Kart açılmayı bekleyenler" (2026-09-15)

Bug formu vardı ama **neye kart açacağım** sorusunun cevabı hiçbir yerde yoktu:
kullanıcı başarısız case'i "Son sonuçlar" sekmesinde görüp özeti ve açıklamayı
ELDEN yazmak zorundaydı. Jira sekmesinin en üstünde artık tek liste:

- **son koşumun GERÇEK başarısızlıkları** (`/api/results` → `expected !== "failed"`)
- **bilinen hatalar** (`tests/known-issues.ts`, `/api/meta → knownIssues`)

⚠️ İkisi bilerek AYRI etiketli: `test.fail()` ile işaretli bir case beklenen
şekilde düştüğünde suite YEŞİL kalır — onu "başarısız" saymak raporu bozar
(mevcut kural, bkz. "Bilinen ürün hataları"). Bu liste o ayrımı koruyor.

⚠️ **Bu bölüm kart AÇMAZ, formu DOLDURUR.** Özet + açıklama (hata metni /
dayanak kodu) hazır gelir, kullanıcı gözden geçirip "Kartı aç" der. Jira'ya
yazma tek yerden ve onayla (`createBugCard`) — kural değişmedi.

**Kapsam bağı:** bilinen hata kaydında `nodeId` varsa kart açıldıktan sonra
`POST /api/scope/jira/attach` ile ağaca geri bağlanır (aynı çağrı düğümün
durumunu da Jira statüsüne göre değerlendiriyor). Bağlama başarısız olursa kart
yine açılmıştır; sebep satırda yazar, sessizce yutulmaz.

## "Bu kartlar nereden geliyor" — `/api/site/match` artık ağaç öncelikli (2026-09-15)

Site (canlı) sekmesindeki eşleşme satırı (`01 Anasayfa · MAC-7037, MAC-7040,
MAC-7041`) profildeki **elle yazılmış** `routes.rules[].cards` listesinden
geliyordu; kullanıcı haklı olarak "bu neye göre geliyor" diye sordu.

Sıra artık: **kapsam ağacındaki düğüm** → profil kuralı → eşleşme yok.
Ad ve kartlar düğümden gelir (Flowscope'ta kart bağlamak paneli de değiştirir);
koşum bilgisi (`runId`/`specs`) düğümde yoksa profilin kuralından tamamlanır —
aksi halde taranarak eklenmiş bir düğümde "Bu sayfayı test et" sessizce
kapanırdı. Yanıt `source` alanı taşır ve panel bunu satırda GÖSTERİR
(`kapsam` rozeti düğüme link, ya da soluk `profil` etiketi).

Ölçüm: `/` → `source: scope, node n2`; Flowscope'tan MAC-9999 bağlanınca panel
satırı anında dördüncü kartı gösterdi; bilinmeyen rota `source: none`.

## Yan yana tasarım kolonu: hizalama ve durum (2026-09-15)

İki kusur birlikte kapandı (ikisi de bildirildi):

1. **Kolon yüksekliği `640px` SABİT yazılıydı** — gömülü çerçeve artık ölçülerek
   büyüdüğü için (bkz. `fitSiteFrame`) tasarım kolonu onunla hizasını kaybediyordu.
   Yükseklik kapsayıcıdan (`#siteSplit`) geliyor; ölçüm: kolon 604px = çerçeve 604px.
2. **Yükleme/hata durumu `<img>`in KENDİSİYLE anlatılıyordu**: src kaldırılıyor,
   tarayıcı KIRIK GÖRSEL ikonu çiziyor, tek açıklama üstteki 11px monospace
   satırda kalıyordu ("zar zor okunuyor"). Artık ayrı bir durum kutusu var
   (`#designState`, 13px, ortalanmış): yükleniyor · hata · hazır. Görsel
   GERÇEKTEN yüklenene kadar kutu kalır (`img.onload`/`onerror`) — render ucu
   yavaş ya da 429 olduğunda boş beyaz kolon "bozuk" gibi görünüyordu.

⚠️ `hidden` kullanan öğeye **inline `display:` verme** — görselin biçimi bu
yüzden CSS'e (`.dcol-img`) taşındı. Bu, panelde daha önce de ölçülmüş bir tuzak
(`#dShots`, bkz. "QA Paneli").

## Elle koşum: adımlardan oluşan case'ler nasıl "koşulur" (2026-09-15)

AI'ın ürettiği case'ler ADIMLARDAN oluşuyor, Playwright spec'i yok — paket
koşumu onları çalıştıramıyordu ("oluşturduğum test paketini koşamıyorum").
Ölçüm: paketin durumu `{cases: 1, specs: [], manualCases: 1}`, yani koşacak
otomasyon fiziksel olarak mevcut değil.

Xray/TestRail deseni eklendi: **insan adımları yürütür, sonucu işaretler.**

- Panel → Koşumlar → paket satırında **iki** düğme: otomatik koşum (spec'i olan
  case'ler) ve **"elle koş"**. Paketin içinde ikisi karışık olabilir.
- Akış: case'ler sırayla önüne gelir (başlık · düğüm · adımlar · beklenenler),
  Geçti / Uyarılı / Kaldı / Atla + serbest not.
- Sonuç `scope.mjs → applyManualRuns` ile case'in `runs[]`ine yazılır:
  `by: "manual"` + notun ilk satırında `Elle koşum · <paket adı>`.
  Uç: `POST /api/scope/testcases/run` (token).
- Adımları veren uç ayrı: `GET /api/scope/package-cases?id=` (liste ekranında
  adımlar gereksiz yük).

⚠️ **Sonuçlar TEK SEFERDE, en sonda yazılır.** Her adımda sunucuya yazmak,
yarıda bırakılan bir koşumu "kısmen koşmuş" gibi gösterirdi; kullanıcı
vazgeçerse hiçbir şey yazılmaz (vazgeçmeden önce işaretlenmiş sayısı söylenir).

⚠️ **Geçersiz satır ATLANIR, koşumun tamamı reddedilmez** — tek bozuk referans
yüzünden insanın 20 dakikalık işini çöpe atmak kabul edilemez; atlananlar
sebebiyle birlikte döner.

⚠️ Düğümün KENDİ durumu yine değiştirilmez (R19) ve `by:"manual"` işareti
kayıtta durur: otomatik koşumla karıştırılırsa "bu case gerçekten koştu mu"
sorusu cevapsız kalır.

## Koşum konsolu — "Koşumlar" sekmesi (2026-09-15)

Sayfanın amacı: panelin geri kalanı OKUMA ekranı, burası **YAPMA** ekranı. Üç
adımı da aynı sayfada tutmak zorunda — ne koşacağını seç · koşarken ne olduğunu
gör · bitince sonuca göre aksiyon al. Önceki hâli yalnızca birincisini yapıyordu
(düğme listesi): koşum başlayınca sayfa susuyor, bitince "Son sonuçlar" ve
"Jira" sekmelerine gitmek gerekiyordu.

Kod `panel/public/js/runs-console.js` (klasik script, `rc*` önekli globaller).
Veri kaynaklarının HEPSİ zaten vardı, gösterilmiyordu.

| Ne | Nasıl |
|---|---|
| **Canlı koşum kartı** | SSE (`run-start`/`log`/`run-end`) → koşan işin adı, geçen süre (1 sn'lik sayaç), o an koşan test, akan geçti/kaldı sayımı, durdur |
| **Biten koşum sonucu** | `/api/results` → geçti/başarısız/bilinen hata + düşen case listesi; her satırda **bug kartı** (Jira formunu doldurur) ve **tekrar koş** (`-g`) |
| **Koşum tablosu** | ad · risk · kapsam düğümü · son sonuç · ortalama süre · son 10 koşum noktası · koş |
| **Kuyruk** | `/api/run/state → pending` — sunucu kuyruğu vardı ama arayüzde HİÇ görünmüyordu; sıraya alınan koşum "kayboluyor" gibiydi |
| **Filtre** | arama + Tümü/Son koşumu düşen/Hiç koşulmamış/Riskli · `/` tuşu odaklar |
| **Risk rozetleri** | sipariş açar (guard durumuna göre) · üye oturumu · veri değiştirir |
| **Geçmiş noktaları** | `/api/runs/history` → `runId` başına son 10 koşum, renk = düşen var mı |

⚠️ **`META`/`SPECS`/`HEADLESS` panelin satır içi kodunda `let`** — global
sözlüksel kapsamdalar, `window` ÜZERİNDE DEĞİL. `window.META` undefined döner
ve tablo sessizce BOŞ çizilir (ölçüldü). Ayrı script'lerden çıplak adla okunmalı
(`rcMeta()`/`rcSpecs()`/`rcHeadless()` sarmalayıcıları TDZ'ye karşı).

⚠️ **Risk rozetleri için spec listesi SUNUCUDAN** (`/api/meta → runs[].specs`,
`specsForCommand`): koşumların çoğu `npm run test:sepet` biçiminde ve gerçek
spec yolu `package.json` scriptinde. İstemcide komut ayrıştırmak 22 koşumun
15'inde boş liste veriyordu, yani rozetler sessizce kayboluyordu.

⚠️ **Tablo hizası**: her satır kendi grid'i, o yüzden `auto` kolon kullanılamaz —
genişlik satır başına değişir ve kolonlar satırlar arasında kayar (ölçüldü:
risk rozeti olan/olmayan satırlar tutmadı). Ad ve kapsam dışındaki kolonlar
SABİT genişlikte; ölçüm: 22 satırın kolon başlangıçları birebir aynı.

⚠️ **`.facet-pill` Flowscope'un stil dosyasında, panelde YOK.** O sınıfı
kullanan düğme panelin genel `button{width:100%}` kuralına düşüp tam genişlik
blok oluyor (ölçüldü: 392px). Panelde `.rc-pill` kullanılmalı.

⚠️ `#tab-runs`'ın `max-width`i 760px → **1280px** ve `margin:0 auto` ile
ORTALANDI: düğme listesi için 760px yeterliydi, tablo için değil; sınırsız da
bırakılmadı (çok geniş ekranda satır okunmaz olur) ama sola yapışık kalınca
2000px'lik ekranda sağda 700px boşluk kalıyordu.

⚠️ **"Kapsam ağacından" çip grubu KALDIRILDI.** Ağaçtaki her koşumu ayrı çip
olarak listeliyordu; oysa koşum tablosu aynı koşumları ZATEN bağlı oldukları
kapsam düğümüyle birlikte gösteriyor (ölçüldü: 14 kapsam koşumunun 14'ü de
whitelist'te, yani satırların birebir tekrarı — sayfanın en üstündeki en büyük
görsel gürültü buydu). `#scopeRuns` artık yalnızca GERÇEKTEN yeni olan bilgiyi
basıyor: ağaçta bağlı ama `panel/runs.json` whitelist'inde olmayan koşum (o
tabloda hiç görünmez). Normal kurulumda hiç basılmaz.

Paketler de aynı tablo dilinde (`.rc-prow`: ad · özet · iki aksiyon). Önce çip
yığınıydı ve "elle koş" düğmesi iki satıra kırılıyordu.

## AKTİF ÜRÜN — panel hangi siteye bakıyor (2026-09-15)

**Şikâyet:** "panel çorba — ben Flowscope'ta bir URL tarıyorum, panel hâlâ
profilin sitesine bakıyor". Ölçüldü: kapsam ağacında 151 düğüm ve **iki ayrı
kök** (Promptfoo + Tepe Home), panel ise üçüncü bir gerçeğe (proje profili)
bakıyordu.

**Model: ağacın her KÖKÜ bir üründür.** Biri aktif seçilir; panelin siteye bakan
bütün yüzeyleri yalnız o kökün alt ağacından ve o ürünün **taranmış adresinden**
beslenir. `.env`'deki `BASE_URL_<ENV>` artık yalnızca **varsayılan**.

```
panel/active-product.mjs   listProducts · resolveActive · activeSubtree · productSlug
panel-data/scope/active-product.json   seçim (ağaca YAZILMAZ — görüntüleme tercihi)
GET/POST /api/scope/products[/active]
```

Ürünün adresi alt ağaçtaki **en çok geçen origin**den çıkar (dış linkler
azınlıkta kalır); Figma/Jira/Confluence linkleri elenir. Hiç adres yoksa
(profilden tohumlanmış ağaç) profilin adresi kullanılır.

| Yüzey | Aktif ürüne göre ne değişir |
|---|---|
| Site (canlı) | rota kısayolları, iframe hedefi, proxy (hedef HER İSTEKTE çözülür — ürün değişince panel yeniden başlamaz) |
| Performans | ölçüm `panel-data/perf/<ürün>/`; sweep hedefleri aktif alt ağaçtan |
| Sonuçlar | "Kapsam sonuçları" bloğu (ağaçtaki case'ler + koşum kayıtları) |
| Jira | yabancı üründe kartlar **kapsam ağacından** (profilin JQL'i değil) |
| Genel bakış | açık bulgular ağaçtan türer (`deriveFindings`) |
| Koşumlar | repo suite'i **katlanır** ve sahibi yazılır |

⚠️ **Repo'nun Playwright suite'i ürüne göre değişmez** — o testler bu repoda ve
profilin sitesini test ediyor. Yabancı ürün seçiliyken gizlenmiyor, **işaretli**
(kullanıcı kararı): koşturmak serbest, ama neyin ne olduğu görünür.

⚠️ **Profil yedeği yalnız repo'nun kendi ürünü aktifken.** `/api/site/match`
eşleşmeyi bulamazsa profilin rota kuralına düşüyordu; yabancı bir sitenin
sayfasında profilin Jira kartları görünüyordu (ölçüldü). Aynı kural
`routesWithFallback`'ta da var (quickRoutes yedeği).

⚠️ **Perf'te "eski düz dizine düş" yalnız profil ürünü için** (`legacyFallback`).
Yabancı ürün için de düşülünce panel, hiç ölçülmemiş bir sitenin perf sekmesinde
BAŞKA ÜRÜNÜN rotalarını gösteriyordu.

⚠️ **Tek ürün varsa şerit yine gösterilir** — o ürün repo'nun ürünü DEĞİLSE.
Kullanıcının gerçek durumu buydu: ağaçta yalnız kendi taradığı site var, panel
ise repo'nun suite'ini taşıyor.

## Elle case → Playwright spec'i (`panel/spec-gen.mjs`, 2026-09-15)

Flowscope'taki "Test Case'leri Koştur (Claude Code)" düğmesi bir **istem**
üretip kullanıcıyı kendi terminaline gönderiyordu; sonuç panele hiç dönmüyordu.
Artık sunucu üretiyor: adımlar → Playwright kodu → `tests/gen-*.spec.ts` →
düğüme bağlanır → panelin whitelist'li koşum yolundan çalışır → sonuç ağaca düşer.

Uç: `POST /api/scope/testcases/spec {nodeId}`. Panelde Koşumlar → paket satırı →
**"otomatiğe çevir"** (yalnız elle case'i olan pakette görünür).

⚠️ **Dosya `tests/` KÖKÜNE yazılır.** Playwright'ın `testDir`i ve panelin spec
doğrulaması (`listSpecs` → `buildCustomArgs`) yalnız kökü tarıyor; alt klasördeki
dosya "Bilinmeyen spec" diye reddedilirdi. `gen-` öneki elle yazılmış suite'ten
ayırır, dosya başlığı nereden geldiğini söyler, yeniden üretim **yeni dosya**
açar (mevcut ezilmez).

⚠️ **Kapı VERİ yolunda** (`gate`): Playwright import'u var mı, `test()` var mı,
istenen case başlıklarının en az biri geçiyor mu, tehlikeli kalıp (require,
child_process, fs yazma/silme, dinamik env) var mı. Geçmeyen kod **diske
yazılmaz**. 11 birim testi.

⚠️ **Model biçimi ARALIKLI sapıyor** (CLI yolu): aynı istem bir kez
`{file, code}`, bir kez `{file, language, code}` döndürdü, bir denemede `code`
hiç gelmedi ve üretim düştü (0.39 $ boşa gitti). `pickCode()` önce `code`a
bakar, yoksa Playwright import'u içeren ilk uzun metni alır — kapı onu yine
doğruladığı için gevşeklik güvenliği azaltmıyor.

⚠️ **ÜRETİLEN SPEC KENDİ ÜRÜNÜNE KOŞAR.** `playwright.config.ts` baseURL'ü
`.env`den okuyor, yani profilin sitesinden; yabancı ürün için üretilen test
göreli `page.goto("/")` ile **sessizce tepehome'a** giderdi. Koşum motoruna
`productEnv` eklendi: **yalnızca** bütün spec'ler `gen-` önekliyse VE aktif ürün
repo'nun ürünü değilse `BASE_URL_<ENV>` override edilir. Whitelist koşumları
(repo'nun kendi testleri) etkilenmez.

Ölçüm: 9 elle case → 43 sn, 0.31 $, 9885 karakterlik spec, 9 case'in hepsi
kodda, düğüme `runRef.specs` ile bağlandı.

## `npm run up` landing'i artık kendisi build ediyor (2026-09-15)

`vite preview` `site/dist`i servis ediyor, kaynağı değil. Önceden yalnızca
"dist hiç yok mu" diye bakılıyordu; kaynağı değiştirip `npm run up` diyen kişi
**7 gün önceki sayfayı** görüyordu (ölçüldü: dist 8 Eylül, kaynak 15 Eylül).
`up.mjs → buildGerekli()` artık `site/` altındaki en yeni dosyayı `dist` ile
karşılaştırıp gerekiyorsa build alıyor (`dist/` ve `node_modules/` taranmaz).

## Toplu seçimde "Tümünü seç" (2026-09-15)

Seçim çubuğunda yalnızca "Seçimi temizle" vardı; 101 düğümlük bir ağaçta tek tek
işaretlemek pratikte imkânsızdı (kullanıcı bildirdi) — oysa toplu işlemin varlık
sebebi tam da bu.

⚠️ **"Tümü" = SÜZGEÇTEN GEÇEN düğümler**, ağacın tamamı değil. Arama ya da facet
açıkken ekranda 17 öğe görünüp 101'inin seçilmesi, kullanıcının gördüğüyle
yaptığının ayrışması olurdu. Ağacın kendi görünürlük kuralı yeniden yazılmadı:
`data.js → computeSearchVisibleIds` (eşleşen + ataları + eşleşen dalın altı)
kullanılıyor, düğme sayıyı da yazıyor ve tooltip sınırı söylüyor.

Hepsi seçiliyken düğme "Seçimi kaldır"a döner (aynı kümeyi geri alır).
Ölçüm: süzgeçsiz `Tümünü seç (101)` → 101 seçili; arama "red teaming" →
`Tümünü seç (17)` → 17 seçili.

## Pakete toplu test case ekleme (2026-09-15)

Paket detayındaki "Test case ekle" listesi tek tek `+` ile ekleniyordu; 125
case'lik bir ağaçta paketi kurmak onlarca tıklama demekti. Arama kutusunun
yanına **"Tümünü ekle (N)"** geldi.

⚠️ **"Tümü" = ARAMADAN GEÇEN adaylar**, ekranda görünen ilk 60 değil
(`MAX_CANDIDATES_SHOWN`). Liste "+65 sonuç daha" derken yalnız 60'ının
eklenmesi, kullanıcının okuduğu sayıyla olanın ayrışması olurdu. 25'ten fazlası
onay ister.

⚠️ **Toplu ekleme AYRI fonksiyon** (`packages-data.js → addTestCasesToPackage`):
`addTestCaseToPackage` her çağrıda `persistPackages()` çalıştırıyor, 125 case'i
tek tek eklemek 125 sunucu yazması olurdu. Hepsi belleğe eklenir, kalıcılık BİR
kez çalışır; zaten pakette olan sessizce atlanır ve sayısı döner.

⚠️ **"Paket ekle" ve "Test case ekle" bölümlerinin markup'ı BİREBİR AYNI**
(aynı `search-box pkg-search`, aynı `search-input`). Düğme ilk denemede
yanlışlıkla PAKET bölümüne düştü ve "Tümünü ekle (2)" diye paket sayısını
gösterdi; tıklayınca paket nesnelerini case sanıp eklemeye çalıştı (veri
katmanındaki `nodeId`/`testCaseId` kontrolü tuttu, hiçbir şey bozulmadı).
Bu iki bölümü ayırt etmek için `placeholder`a bak — `searchWrap` ya da sınıf
adıyla arama yapma. Aynı tuzak testte de tekrarlandı: `.pkg-search .search-input`
seçicisi ilk kutuyu (paket aramasını) yakalıyor.

Ölçüm: süzgeçsiz `Tümünü ekle (125)` → onay → "125 case eklendi" → düğme (0);
arama "connect" → `(10)`; eşleşmeyen arama → `(0)` ve düğme kapalı.

## Ürün giriş bilgileri — login akışı testleri (2026-09-15)

Bir URL taranıp kapsam kurulunca "Login akışı" gibi case'ler üretiliyor ama
onları koşacak kimlik hiçbir yerde yoktu: `.env`'deki `TEST_EMAIL`/
`TEST_PASSWORD` **profilin** sitesine ait. `panel/product-credentials.mjs` her
ürün için ayrı kayıt tutuyor (`panel-data/scope/product-credentials.json`, 0600).

- Uçlar: `GET /api/scope/credentials` (maskeli) · `POST` (kaydet) ·
  `POST /remove`. Panelde **Koşumlar → "giriş bilgileri"**.
- Koşuma `QA_LOGIN_URL` / `QA_USERNAME` / `QA_PASSWORD` olarak geçer — ve
  yalnızca `gen-*` spec'leri, yalnızca aktif ürün repo'nunki değilken
  (`server.mjs → productEnv`, baseURL override'ıyla aynı dar kapı).

⚠️ **PAROLA HİÇBİR YANITTA DÖNMEZ.** Okuma ucu kullanıcı adını ve "parola var
mı" bilgisini verir (`publicView`). Ölçüldü: `/api/scope/credentials`,
`/summary`, `/meta`, `/products` ve denetim kaydı temiz; parola yalnızca 0600
izinli dosyada.

⚠️ **PAROLA MODELE DE VERİLMEZ.** Spec üretim istemi yalnız kullanıcı adını ve
giriş sayfasını söyler; modele `process.env.QA_PASSWORD` okuması yazdırılır.
Kapı bunu DOĞRULUYOR: üretilen kodda parola düz metin geçerse dosya **yazılmaz**
(`gate(..., { secret })`). Aksi halde parola `tests/` altına düz metin olarak
düşer ve oradan git'e sızabilirdi.

⚠️ **Kimlik yoksa test ATLANIR, uydurulmaz**: istem "kullanıcı adı/parola
UYDURMA, `test.skip` ile atla ve sebebini yaz" diyor; `runEnv` de kayıt yoksa
boş dönüyor.

⚠️ **Parola boş gönderilirse eskisi korunur.** Arayüz parolayı hiç göstermiyor;
her kaydetmede boş alanı "sil" saymak, kullanıcı yalnızca kullanıcı adını
düzelttiğinde parolayı sessizce uçururdu. Silmek için ayrı uç var.

## `known` ile `runnable` ayrı şey (2026-09-15)

`deriveRuns` bir düğümün koşumunu `known: runId ? whitelist.has(runId) : false`
diye işaretliyordu. Üretilen spec'lerin (`gen-*.spec.ts`) `runId`'si YOK, o
yüzden hepsi `known:false` çıkıyor ve panel **"whitelist'te yok — panelden
başlatılamaz"** uyarısı basıyordu; oysa aynı ekranda paket satırı onları
"2 spec otomatik" diye koşuyordu (parametreli koşum yolu, spec'ler `tests/` ile
doğrulanıyor). Artık:

- `known` — yalnız `runId` varken anlamlı; yoksa `null` (soru sorulmamış)
- `runnable` — spec varsa true (parametreli yol), ya da bilinen bir runId varsa

Uyarı yalnızca `runnable === false && runId` durumunda basılır: ağaç, whitelist'te
gerçekten olmayan bir koşum id'si gösteriyorsa.

## Üretilen spec'ler deploy'da uçuyordu — kalıcı depo (2026-09-15)

Canlıda ölçülen belirti: koşum "**Bilinmeyen spec: gen-rec-login-akisi.spec.ts ·
Bilinmeyen spec: gen-salon.spec.ts**" diyordu. Ölçüm: ağacın `runRef.specs`i o
iki dosyayı istiyor, `/api/specs` 17 spec görüyor ve **hiçbiri `gen-` değil**.

Sebep: üretilen spec `tests/` altına yazılıyordu, yani **imajın içine**;
`tests/gen-*.spec.ts` gitignore'da olduğu için her deploy imajı git'ten yeniden
kurup dosyaları siliyor. Referans ise `panel-data` volume'ünde kalıyor. İki
katman birbirinden ayrı ömür sürünce koşum sessizce imkânsız hâle geliyordu.

**Çözüm — asıl kopya volume'de, `tests/` çalışma kopyası:**

```
panel-data/generated/gen-*.spec.ts   ASIL (volume)
tests/gen-*.spec.ts                  calisma kopyasi (imaj; Playwright buraya bakar)
panel/spec-gen.mjs   → storeSpec() ikisine birden yazar; restoreGenerated() geri koyar
panel/spec-restore.mjs → restoreSpecs(readTree): depo + agac, tek cagri
```

- **Tek yazma yolu.** `storeSpec()` hem depoya hem `tests/`e yazar; `writeSpec()`
  başlığı ekleyip ona düşer, kayıttan üretim (`/api/scope/testcases/record`) de
  onu çağırır. ⚠️ Doğrudan `fs.writeFileSync(tests/…)` yazan ikinci bir yol
  açma — tam olarak bu hata `gen-rec-*` dosyalarını uçuran şeydi.
- **Geri yükleme iki kaynaktan**: (1) depo → `tests/`; (2) **kapsam ağacından**
  yeniden üretim — kaydedici adımları (`testCase.recorded`) ağaçta, yani
  volume'de duruyor, `recorded-spec.mjs → restoreFromTree()` onları modelsiz ve
  deterministik olarak yeniden render ediyor (ölçüldü: yeniden üretilen dosya
  orijinaliyle kod olarak BİREBİR aynı, yalnız başlıktaki ürün adı satırı
  farklı olabiliyor). Bu, depo var olmadan üretilmiş kayıtları da kurtarır.
- **Sahiplenme (tests → depo).** Depo kurulmadan önce üretilmiş ve hâlâ diskte
  duran `gen-*` dosyaları ilk çağrıda depoya kopyalanır; bir daha uçmazlar.
  Elle yazılmış testler adlandırma deseni yüzünden sahiplenilmez.
- **Hiçbir dosya EZİLMEZ.** Var olan `tests/` dosyası atlanır (`skipped`):
  üretilen kod elle düzeltilmiş olabilir, dosya başlığı zaten bunu söylüyor.
- **Ne zaman koşar:** panel açılışında (proxy'den önce, `BASE_URL`den bağımsız)
  ve **her koşumdan önce** (`/api/run` + `/api/scope/run`). Hatası koşumu
  düşürmez.
- `pickFilename()` çakışmayı **her iki dizinde** arar; yalnız `tests/`e bakmak,
  deploy sonrası boş dizinde var olan bir adı yeniden verip geri yüklemede
  dosyayı ezmeye yol açardı.

⚠️ **Bu değişiklikten ÖNCE kaybolmuş AI üretimi spec'ler geri gelmez** —
kayıtları hiçbir yerde yok, yeniden üretilmeleri gerekir. Kaydediciden gelenler
(`gen-rec-*`) ağaçtaki adımlardan kurtulur.

### Ölü spec referansı: "otomatik" görünen ama koşulamayan case (2026-09-15)

Yukarıdakinin ikinci yarısı, kullanıcı bildirdi: *"otomatiğe çevir bir kez
yapıldı, o paket için artık gözükmüyor — nereden yapacaktım?"* Ölçüldü: dosya
uçtuğunda case'in `spec` alanı DURUYOR, yani case her yerde **otomatik**
sayılıyordu →

- `manualCases` 0 → **"otomatiğe çevir" düğmesi gizli**
- `POST /api/scope/testcases/spec` filtresi `!tc.spec` → **400 "çevrilecek elle
  case yok"**
- koşum → **"Bilinmeyen spec"**

Yani kullanıcının elinde hiçbir yol kalmıyordu. Artık **"otomatik mi" sorusu
dosyaya da bakıyor** (`spec-gen.mjs → specExists`, yol kaçışını da reddeder):

| Yer | Ne değişti |
|---|---|
| `packages.mjs → resolvePackageCases` | case başına `specMissing` |
| `/api/scope/packages/runnable` | kayıp spec'li case `manualCases`a sayılır; `missingSpecs[]` döner |
| Koşumlar satırı | "N spec dosyası kayıp" + düğme geri gelir, adı **"yeniden üret"** |
| `/api/scope/testcases/spec` | filtre `(!automated && !spec) \|\| (spec && !specExists(spec))` |
| aynı uç, yazma | **ölü referans TEMİZLENİR**: `runRef.specs`ten düşer, `tc.spec` yeni dosyaya döner — kalsaydı doğrulama "Bilinmeyen spec" demeye devam eder, yeni dosya hiç denenmezdi |

⚠️ **Ölü referans İKİ yerde olabilir** ve ikisi de temizlenmeli: case'in kendi
`spec` alanı VE düğümün `runRef.specs`i. Canlıda ölçüldü (2026-09-16):
`n2 Salon → runRef ['gen-salon.spec.ts']`, case'in `spec`i **null** — bağ
yalnızca düğüm seviyesinde. Yalnız `tc.spec`e bakan temizlik o adı ağaçta
bırakır ve yeniden üretilen dosya hiç denenmeden koşum yine "Bilinmeyen spec"
der. `spec-gen.mjs → deadSpecs(list)` ikisini birden süzüyor (tek yer, birim
testli).

Ölçüm: dosya silinip ağaçtaki referans bırakılınca satır `5 case · 1 spec
otomatik · 2 elle · 1 spec dosyası kayıp` + "yeniden üret" (ipucunda dosya adı);
üretim filtresi eski hâlinde 4 case görüp reddederken yeni hâlinde ölü
referanslı case'i de alıyor (5).

### Giriş bilgisi ihtiyacı artık paketin yanında görünüyor

`/api/scope/packages/runnable` her paket için `needsLogin` (case/spec adında
login·giriş·oturum·sign-in geçiyor mu) ve yanıt başında `credentials:
{saved, username}` döndürüyor (**parola dönmez**). Koşumlar sekmesi, login akışı
içeren bir paket varken kayıt yoksa paketlerin ÜSTÜNDE sarı bir uyarı ve tek
tıkla kutuyu açan "giris bilgisi ekle" düğmesi basıyor; kayıt varsa "… <kullanıcı>
ile koşacak" satırı. Satır özetine de "giris bilgisi yok" giriyor. Gerekçe:
kullanıcı canlıda giriş düğmesini (üst bardaki ve başlıktaki iki adet) bulamadı —
kimlik istemek için doğru an, ihtiyacın doğduğu yer.

## Kaydediciden çıkan spec neden düşüyordu — dört ölçülmüş hata (2026-09-16)

Canlıda bir paket koşuldu, 4 case de düştü (`expect(locator).toBeVisible()
failed` ×3, `locator.click: Timeout 20000ms` ×1). Ölçüm sırası:

- Site **ayakta ve kapı ekranı YOK** (anonim istek 85 KB gerçek içerik döndü) —
  sebep ortam değil, **locator'lar**.
- Kayıttan üretilen spec, canlı ağaçtaki adımlardan yeniden render edilip tek
  tek gerçek siteye karşı koşuldu. Dört ayrı hata çıktı, dördü de kapatıldı:

**1. Erişilebilir ad, kullanıcının YAZDIĞI değerden türetiliyordu.**
`proxy.mjs → locator()` ad için `el.value`a düşüyordu; form alanında bu
`getByRole('textbox', { name: 'mirac@ornek.co' })` ve
`getByRole('checkbox', { name: 'on' })` üretiyordu (`on` = input'un varsayılan
`value`si). Ölçüldü: ikisi de **0 eşleşme**. Form alanında sıra artık
`aria-label > placeholder > <label> metni > #id > [name] > css`; `el.value`
hiçbir zaman kullanılmaz.

**2. PAROLA kaydediliyordu.** `step({action:"fill", value: el.value})` parola
alanında düz metin parolayı hem kapsam ağacına hem `tests/` altındaki dosyaya
yazardı. Artık `secret: true` işareti konuyor, değer taşınmıyor; üretilen kod
`process.env.QA_PASSWORD` okuyor ve kimlik yoksa `test.skip` ile atlıyor (bkz.
"Ürün giriş bilgileri"). Eski kayıtlarda kalan maskelenmiş dize (`••••••••`) de
render sırasında parola sayılıyor (`isSecretStep`).

**3. `input[type="password"]` bu sitede YOK.** Parola kutusu
`id="login-password"` ama **`type="text"`** — maskelemeyi kendi yapıyor (zaten
`el.value`nin `••••••••` dönmesinin sebebi bu). `passwordLoc()` önce AYNI kaydın
başka bir adımında geçen parola-benzeri locator'ı arıyor (kaydedici onu genelde
bir iddiada `#login-password` olarak yakalamış oluyor), sonra geniş bir CSS
listesine düşüyor.

**4. Kutular `sr-only`.** `<input type="checkbox" class="sr-only">` — görünen şey
etiketi; Playwright aktiflik kontrolünde 20 sn bekleyip düşüyor. `check`/
`uncheck` ve kutuya yapılan `click` artık `{ force: true }` ile üretiliyor
(reponun POM'undaki `focus()+Space` çözümüyle aynı gerekçe, seçici tuzakları
madde 11).

Ayrıca **çoklu eşleşme**: giriş sayfasında `getByRole('button', { name: 'GİRİŞ
YAP' })` **2 eşleşme** döndü → çıplak locator strict mode ile patlar. Üretilen
her locator artık `.filter({ visible: true }).first()` ile bitiyor; `.first()`
tek başına görünmez ikizi yakalayıp click timeout'una düşerdi (madde 2).

Eski kayıtlar da **render sırasında onarılıyor** (`repairLoc`): tahmin yok,
yalnız üç güvenli kaynak — parola alanı, bir önceki adımın aynı alana tıklaması,
adsız rol. Onarılamayan bozuk ad için koda `// TODO` satırı düşüyor.

**Sonuç ölçümü:** aynı kayıt, düzeltmelerden sonra gerçek siteye karşı **2,3
sn'de yeşil** (öncesi: 20 sn timeout).

**5. SAYFANIN KENDİ TIKLAMASI kayda giriyordu** (2026-09-16, ikinci tur).
Kullanıcı "ben KAPAT'a hiç basmadım" dedi — haklıydı. Kaydedicide
`e.isTrusted` kontrolü YOKTU: modern arayüzler kendi elemanlarına programatik
`click()` atıyor (rota değişince açık bir modalı/drawer'ı kapatmak için) ve
tarayıcı bunu normal bir click olayı olarak yayıyor. Kaydedici onu KULLANICI
ADIMI sanıp dosyaya yazıyordu; bir daha koşulduğunda o modal hiç açılmadığı
için adım **20 sn bekleyip düşüyordu**. `isTrusted` yalnız gerçek girdi
aygıtından gelen olaylarda true'dur — click/change/keydown dinleyicilerinin
üçünde de soruluyor. Ölçüm (gerçek proxy sayfası, gerçek tarayıcı): gerçek
tıklama kaydedildi, `el.click()` ile atılan tıklama kaydedilmedi.

⚠️ **Kalan sınır, bilinçli:**
- Kayıt sırasında **gerçekten** çıkan ve kullanıcının kapattığı bir pop-up
  (çerez bandı gibi) adım olarak girer; temiz koşumda o banner çıkmazsa
  bekler. Bunu kaydedici bilemez — dosya elle düzenlenebilir ya da yeniden
  kaydedilir.
- **Kayıt tek başına TEST DEĞİL.** Yukarıdaki koşum YANLIŞ parolayla da yeşil
  geçti: adımların hepsi çalıştı ama "giriş yapıldı mı" diye soran bir iddia
  yok. Kaydederken **İDDİA MODU** ile en az bir doğrulama bırakılmalı.

### Bu düzeltmeler İKİ üretim yolunda da geçerli

Spec üreten iki yol var ve **ortak kod paylaşmıyorlar** — biri düzeltilince
diğeri kendiliğinden düzelmez:

| Yol | Kodu kim yazıyor | Kurallar nerede |
|---|---|---|
| Kayıttan (`gen-rec-*`) | `recorded-spec.mjs` (deterministik) | fonksiyonun içinde — `asLocator`, `repairLoc`, `passwordLoc` |
| AI'dan (`gen-*`) | model | **istemde** — `spec-gen.mjs → SYSTEM` |

Yukarıdaki dört hata önce yalnız kayıt yolunda kapatılmıştı; aynı maddeler
(görünür süzgeç, `force`, parola ortamdan, `type="password"` varsayma, Türkçe
`İ`, iddia zorunluluğu) **istem kurallarına da yazıldı** ve bir birim testi
istemde durduklarını doğruluyor (sessizce silinmesinler diye). Yeni bir seçici
tuzağı ölçtüğünde **ikisini birden** güncelle.

⚠️ Üretilen kod `locator.filter({ visible: true })` kullanıyor; `package.json`
tabanı bu yüzden `@playwright/test ^1.51.0` (ölçülen sürüm 1.62.1).

### Üreteç düzelince ELDE DURAN dosyalar ne olacak

Bu tam olarak canlıda yaşandı: seçici hataları düzeltildi ama düzeltme yalnız
YENİ kayıtlara uygulansaydı, elde duran kayıtlar sonsuza kadar bozuk locator'la
koşardı. Üstelik daha kötüsü ölçüldü — depodaki (volume) eski kopya her
deploy'da geri konup taze render'ı **gölgeliyordu** (`restoreGenerated` önce
koşuyor, `restoreFromTree` "dosya zaten var" deyip atlıyordu).

| Spec | Yenileme | Ne zaman |
|---|---|---|
| Kayıttan (`gen-rec-*`) | **otomatik**, ücretsiz, deterministik | panel açılışında, `üretici: kayıt vN` eskiyse |
| AI'dan (`gen-*`) | **tek tık**, model çağrısı (ücretli) | Koşumlar → paket satırı → "yeniden üret" |

- `recorded-spec.mjs → GENERATOR` sürüm sayısı dosya başlığına yazılıyor.
  **Üreteci her değiştirdiğinde bu sayıyı ARTIR** — yoksa düzeltmen elde duran
  kayıtlara hiç ulaşmaz.
- Tazeleme **kalıcı kopyayı da** günceller (`storeSpec`); yalnız `tests/`e
  yazsaydı bir sonraki deploy eskisini geri koyardı.
- Güncel sürüm damgası taşıyan dosyaya DOKUNULMAZ (birim testi bunu ölçüyor).
- ⚠️ AI spec'i için düğme eskiden **yalnız dosya eksikken** çıkıyordu; üretim
  kuralları değişince elde duran dosyayı yenilemenin hiçbir yolu yoktu
  (kullanıcı bildirdi). Artık dosya yerindeyken de çıkıyor ve onay kutusu
  "model çağrısı yapılır, YENİ dosya açılır, eskisi ezilmez" diyor.

### Neden modelin kendisi koşmuyor da spec dosyası üretiliyor

Sık gelen soru. Model **kodu yazar, Playwright koşar** — model tarayıcıyı
sürmez. Gerekçeler ölçülebilir: aynı dosya her koşumda **aynı** adımları atar
(model her seferinde başka yol seçebilir), koşum **saniyeler** sürer ve
**ücretsizdir** (üretim ~30-40 sn ve ücretli), düşen adım **trace/video/ekran
görüntüsü** bırakır, dosya git'e girer ve insan **düzeltebilir**. Model bir kez
yazar, dosya sonsuz kez koşar.

## Spec yönetimi: "hangi dosyalar koşuyor, hangisini artık istemiyorum" (2026-09-16)

Her "yeniden üret" `runRef.specs`e **YENİ** bir dosya ekliyor, eskisi kalıyordu.
Canlıda ölçüldü: iki düğümde 5 dosya birikti ve **4 case'lik bir paket 9 test
koştu** — aynı case üç kopyada çalışınca sonuç tablosu "biri geçti ikisi kaldı"
diye okunamaz hâle geldi. Kullanıcının bunu görebileceği ya da temizleyebileceği
hiçbir yer yoktu.

Koşumlar → paket satırında **"specler (N)"** düğmesi; modal her dosyayı, türünü
ve hangi düğüm/case'lere bağlı olduğunu listeliyor.

| Tür | Ne demek | Silinebilir mi |
|---|---|---|
| `recorded` (`gen-rec-*`) | kayıttan üretildi | evet — adımlar ağaçta, ücretsiz yeniden üretilir |
| `ai` (`gen-*`) | model yazdı | evet — yenilemek model çağrısı ister |
| `repo` (diğer) | reponun kendi suite'i | **HAYIR**, sunucu reddeder |

**İki eylem bilinçli olarak AYRI:**
- **bağı kaldır** (`POST /api/scope/specs/unlink`) — dosya diskte kalır, ağaç
  onu koşmaz. Üç yerden birden temizlenir, yoksa dosya bir şekilde geri gelir:
  `node.runRef.specs`, `testCase.spec` (case "elle"ye döner) ve yalnızca o
  dosyayı temsil eden çöp case (`"Otomatik: <dosya>"`).
- **sil** (`POST /api/scope/specs/delete`) — bağı kaldırır **ve** dosyayı hem
  `tests/` hem kalıcı depodan siler. Yalnız bağı kaldırmak dosyayı bırakırdı ve
  bir sonraki deploy onu geri yüklerdi; yalnız dosyayı silmek ağaçta ölü
  referans bırakırdı ("Bilinmeyen spec"). İkisi tek uçta.

⚠️ `removeSpecFile` **yalnız `gen-` önekli** dosyayı siler ve yol ayracı taşıyan
adı reddeder: repo'nun kendi suite'i git'te izlenen kaynak kod, panelden
silinebilir olması kabul edilemez (birim testli).

Ölçüm: uçtan uca tarayıcıda — modal iki dosyayı türü ve bağlı düğümüyle
listeledi, "bağı kaldır" sonrası uç bir dosya döndü, ağaç güncellendi, **dosya
diskte durdu**. 270 birim testi (`spec-unlink.test.mjs` + `removeSpecFile`).

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

Panel Jira uçları: `/api/jira/cards?view=all|<sorter-id>` (bkz. "Jira: Sorter"),
`/api/jira/card/<KEY>`, `POST /api/jira/comment|transition|bug`.

Agent dosyaları repo bilgisini prompt'a gömer — keşifle zaman harcamasınlar diye.
Yeni bir konvansiyon eklersen ilgili agent'ı da güncelle.

## Panel ürün-merkezli: profil suite'i arayüzden kalktı (2026-09-15, akşam)

**İstek:** "Homee QA muhabbeti sistemden tamamen kalksın; her şey girilen
kapsam URL'sinden ilerlesin. Parametreli koşum ve HOMEE_ENV'den gelenler
kalkacak, paketleri koşacağız; sonuçlar kalıcı olacak; perf flow'daki tüm
istekleri ölçecek; Site (canlı) kaydı bitince ad verilip test case olacak;
connector gereken yer bağlı değilse Bağlantılar'a yönlendirsin." Push YOK,
önce lokalde test.

**Arayüzden kalkanlar** (kod yolları sunucuda duruyor, yalnız UI):
Koşumlar'daki whitelist tablosu + "Parametreli koşum" + "Bilinen hatalar";
Sonuçlar'daki repo spec listesi, "Senaryo öner", "Bilinen hatalar tablosu",
"Taslaklar"; "Son sonuçlar" sekmesi; Site'deki codegen "Kaydet" bloğu
(misafir/üye oturumu profil kavramıydı); TIPS'teki Homee rota adları.
`/api/specs`, `/api/results`, `/api/record/*`, `custom` koşum yolu sunucuda
aynen duruyor — `runCase` (tek case tekrarı) ve paket koşumu `custom`'ı kullanır.

**Yeni model, sekme sekme:**
- **Başlık/rozet**: `/api/meta → project.title` artık aktif ürünün adı
  (≤32 kr) yoksa host'u (`productTitle`): kırılım "promptfoo.dev". Sağ üst
  rozet ortam adı değil ürün host'u; sipariş guard rozeti yalnız profil
  ürünü aktifken (`display:none`, `hidden` DEĞİL — `.pill` display'i ezer).
- **Koşumlar = paketler** (`renderScopePackages`): satırda son koşum
  (`x/y`), zaman, son 10 koşumun noktaları, `kos`/`elle kos`/`otomatige
  cevir`. Paket koşumu `runRequest({id:'custom', params:{specs, package:{id,name}}})`
  — `params.package` motorda etiketi "Paket: X" yapar ve koşum sonunda defteri
  tetikler. Boş listede akış anlatan kutu + Flowscope linki.
- **Sonuçlar = paket koşum defteri** (`panel/package-runs.mjs`,
  `panel-data/package-runs.json`, en yeni 300): her kayıt paket + mod
  (auto/manual) + sayımlar + **case satırları gömülü** (results.json ezilse de
  durur). Uçlar `GET /api/scope/package-runs[?packageId=&cases=0]`,
  `/api/scope/package-run?id=`. Yazma iki yerden: motor `onRunFinished`
  (otomatik) ve `POST /api/scope/testcases/run` gövdesinde `packageId` varsa
  (elle). Sonuç → case eşlemesi `mapResultsToCases`: case'in `spec`i (yoksa
  düğümün `runRef.specs`i) içindeki satırlardan **başlığı birebir** (ilk 60
  kr) eşleşen; yoksa spec özeti (düşen varsa ❌); spec yoksa ⏭️ "elle";
  satır yokken koşum düştüyse ⚠️ sebep. Ölçüm: Tümü paketi 5 case → 4 ❌ 1 ✅
  başlıkla eşleşti, 76 sn. Hata metni ANSI'den arındırılır.
- **Genel bakış**: KPI'lar `SCOPE.summary`den (geçen/koşulan, düşen, case,
  paket koşumu, bulgu); "Misafir/Üye seti" düğmeleri → "Paketleri koş" /
  "Siteyi tara"; BUGÜN listesi ağaçtan (kapı satırı yalnız profil ürününde).
- **Site (canlı) → Kaydet → Bitir**: `finishIframeRec()` ad ister (uiPrompt),
  `POST /api/scope/testcases/record {title, steps, path}` → sunucu MODELSİZ
  (a) adımları insan-okunur case adımlarına çevirir (`recorded-spec.mjs →
  toCaseSteps`: iddialar önceki adımın `expected`ine yazılır), (b)
  deterministik spec'i `tests/gen-rec-<slug>.spec.ts` olarak yazar, (c)
  case'i rotanın düğümüne (yoksa ürün köküne) `spec` + ham `recorded[]` ile
  ekler ve `runRef.specs`e bağlar (`scope.mjs → addRecordedCase`). Test
  başlığı = case başlığı (defter eşlemesi buna dayanır). Eski
  `/api/record/steps` de aynı kod üreticiyi kullanıyor. Ölçüm: kayıt →
  paket → koşum 7,6 sn, `PW_PRODUCT` ile promptfoo'ya gitti, ❌ deftere düştü.
- **Tasarım kolonu / diff**: `/api/figma/frame|render` önce aktif ürünün
  ağacındaki düğümün **Figma kaynak linkinden** (`figmaOverrideForPath`,
  node-id'li link) çözer; yabancı üründe profil haritasına DÜŞÜLMEZ ("/"
  profilin Home frame'iyle eşleşirdi). Hata `code` taşır: `NO_CREDS` →
  kolon "Figma bağlı değil" + **Bağlantılar'ı aç** (`openConnector('figma')`
  → `pfPanelOpen` + `cxConnectOpen`), `NO_MAP` → "düğüme Figma linki ekle"
  + Flowscope linki. `figma-render.mjs` artık `fileKey` parametreli.
- **Perf**: `scripts/perf-sweep.mjs` adresi **aktif üründen** alır
  (`resolveActive` + en çok geçen origin), rotalar yalnız o alt ağaçtan,
  **`tests/routes.ts` taban listesi KALKTI** (rota yoksa açık hata), kapı
  oturumu yalnız profil sitesinde yüklenir, çıktı `perf/<urun>/`. Sebep:
  Promptfoo aktifken "Yeniden ölç" Tepe Home'un 33 statik rotasını
  ölçüyordu (ölçüldü 15:41). `apiHostRe` yabancı üründe null.
- **RAG/zemin yalnız profil ürünü için** (`routes/ai.mjs → profilUrunu`):
  promptfoo case'leri "HOMEE_ENV ile ortam seç", "BasePage.isNotFound()"
  diyordu — tests/pages/CLAUDE.md parçaları yabancı ürünün istemine
  giriyordu. Test case ve spec üretiminde `repoContext`/`useStable` kapalı.
- **Koşum ortamı**: `productEnv` yabancı ürün + hepsi `gen-` spec ise
  `BASE_URL_<ENV>` override + **`PW_PRODUCT=1`**: `playwright.config.ts`
  storageState vermez, `global-setup.ts` kapı/üye girişini atlar. ⚠️ Bunsuz
  global-setup yabancı sitede kapıyı arayıp `test-gate.json`'ı **o sitenin
  çerezleriyle EZİYOR** ve üye girişi `/giris` bulamayıp koşumu düşürüyordu.
- **Bug kuyruğu**: bilinen hata kayıtları yerine ağaçtaki ❌ işaretli
  düğümler (`findings.kind === 'node'`).

**Ölçüm**: 237 birim testi yeşil (+8 yeni: `package-runs.test.mjs`,
`recorded-spec.test.mjs`), `panel:check` temiz, 4699'da headless Chrome
probu: 9 sekme, whitelist/param/known-issue DOM'da yok, paket satırları,
kayıt→case→spec→paket→koşum→defter zinciri, tasarım kolonu NO_MAP metni, sıfır
panel JS hatası (konsoldaki 404/ERR_NAME_NOT_RESOLVED iframe'deki sitenin
varlıkları).

**Bilinçli borç / açık**: kaydedicide iframe'deki bir bağlantıya tıklama
probda adım olarak düşmedi (iddia tıklaması düştü) — mevcut kaydedici
mekaniği, bu turda dokunulmadı; `tests/routes.ts`, `known-issues.ts`, repo
suite'i ve `panel/runs.json` whitelist'i duruyor ama arayüzde görünmüyor
(perf-sweep/gate-refresh gibi motor koşumları whitelist'ten); `/api/jira/cards`
kimliksiz ortamda 500 (önceden de böyle, yabancı üründe çağrılmıyor);
`writeRunIntoNode` notlarındaki ANSI kodları temizlenmedi (yalnız defterde
temiz); kayıt spec'inin locator kalitesi kaydedicinin verdiği kadar.

## Flowscope: toplu seçimde "Test Case Üret" modalı (2026-09-15)

Toplu seçim çubuğundaki üretim düğmesi seçenek sormadan sabit happy+negative · 4
ile gidiyordu; drawer'daki QA Analizi ise preset/tür/tür paketi seçtiriyordu.
İstek: "toplu seçince Case üret'e basınca modal açılsın, aynı üretme seçenekleri
çıksın." Yapılan:

- `scope/js/testcase-options.js` — `TEST_TYPE_META`, `TEST_TYPE_PRESETS`,
  `DEFAULT_TYPES` ve **ortak tür seçici** `buildTypeSelector({selected,
  expanded, onChange, onPackagesLoaded})` (preset pilleri · açılır checkbox
  listesi · tür paketleri satırı). Drawer'daki satır içi kopya bununla
  değiştirildi (`drawer.js`), seçim yine drawer'ın module-scope state'inde.
  Bileşen durumsuz: her değişiklikte `onChange` → çağıran yeniden çizer.
- `scope/js/bulk-generate.js` — `openBulkGenerateModal({nodeIds})`:
  ai-assist iskeleti (`.ai-assist-overlay/.ai-assist-modal` + `.bulk-gen-*`),
  seçili düğüm çipleri (24'ten sonrası "+N"), ortak tür seçici, **düğüm başına
  en fazla** (2/3/4/5/6/8) + "≈ en fazla N case · türler" satırı, Üret. Seçim
  modal kapanınca unutulmaz (module-scope). Üretim yine tek yoldan
  (`openTestCaseRequest` — tek tık/elle, hesap seçimi, `allowedNodeIds`
  kapısı); yazma bitince seçim temizlenir (aynı düğümlere ikinci kez basmak
  tekrar atlanır ama ücret öder).
- `bulk-actions.js` ↔ `bulk-generate.js` döngüsel import (clearSelection /
  openBulkGenerateModal) — ikisi de yalnız tıklama anında kullanılıyor,
  modül yüklenirken değil; sorun çıkarmaz.

Ölçüm (4646, headless Chrome): 3 yaprak seçildi → modal 3 çip, presetler,
"Tümü" → 10 tür seçili, bir tür kaldırılınca aktif preset 0, sınır 6 →
"≈ en fazla 18 case", Üret → tek tık onayı "en fazla 6'er case", elle yol
istemi 3 düğüm bloğu + "En fazla 6 case". Drawer'daki QA Analizi aynı
bileşenle çalışmaya devam ediyor. Sıfır konsol hatası.
