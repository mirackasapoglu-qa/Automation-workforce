# Homee — İlk regresyon taraması bulguları

> Jira karşılığı: `MAC-7035 "Tepe - Redesign"` epic'i (machinarium.atlassian.net / MAC projesi).
> Bulgu ↔ kart eşlemesi `tests/jira-map.ts` içinde.

**Tarih:** 2026-08-18
**Ortam:** `test` → `https://redesign-prod.test.tepehome.com.tr`
**Yöntem:** Playwright (Chromium/Chrome), misafir + üye oturumu, DOM'dan doğrulama
(Homee 404'te de HTTP 200 döndüğü için durum kodu tek başına kullanılamaz)

Bu dosya **ürün bulgularını** listeler. Suite'in kendi test kodu sorunları burada değil.
Her bulgu, suite'te otomatik takip ediliyor — sütuna bak.

---

## Kırık rotalar (menüde/footer'da linki var, 404 dönüyor)

| Rota | Nerede link veriyor | Takip |
|---|---|---|
| `/oturma-odasi` | ana menü | `routes.ts → KNOWN_BROKEN_ROUTES` |
| `/yasam` | ana menü | aynı |
| `/yatak-odasi` | ana menü | aynı |
| `/indirimli-urunler` | footer / kampanya | aynı |
| `/cerez-politikasi` | footer | aynı |
| `/sozlesme-ve-bilgilendirme` | footer | aynı |

Kanonik kategori yolu `/tum-urunler/<slug>` çalışıyor (örn. `/tum-urunler/oturma-odasi` → 200,
h1 "Oturma Odası"). Yani menüdeki üst seviye kısa yollar eşlenmemiş.

**Not:** `/kayit-ol` da 404 dönüyor ama bu bir hata **değil** — Jira'da
[MAC-7038 "Tepe - Sign up"](https://machinarium.atlassian.net/browse/MAC-7038) kartı
"Yapılacaklar" statüsünde, yani kayıt akışı henüz geliştirilmedi. Bu yüzden kırık rota
listesine alınmadı.

**Test:** `02-navigation.spec.ts` → "bilinen kırık linkler kayıt altında".
Bir rota düzelirse test FAIL eder ve listeden çıkarılmasını zorunlu kılar.

---

## Boş kategoriler ("0 ürün / Ürün bulunamadı")

| Rota | h1 | Ürün |
|---|---|---|
| `/tum-urunler/dekoratif-obje-figur` | Dekoratif Objerler&Vazo | 0 |
| `/oturma-odasi/tamamlayici-mobilya` | Tamamlayıcı Mobilya | 0 |
| `/mutfak` | Mutfak&Sofra | 0 |
| `/banyo` | Banyo | 0 |
| `/yeni-urunler` | YENİ ÜRÜNLER | 0 |

Dikkat: **header'ın iki ana menü linki de boş kategoriye gidiyor** —
`MOBİLYA → /oturma-odasi/tamamlayici-mobilya` ve `EVDEKOR → /tum-urunler/dekoratif-obje-figur`.
Yani ana navigasyondan ürün listesine ulaşılamıyor.

Ürün dönenler: `/tum-urunler` (30), `/tum-urunler/oturma-odasi` (6), `/bahce` (3),
`/arama?q=koltuk` (768).

Test ortamı verisi eksikliği mi, kategori eşlemesi hatası mı ayrımını ürün ekibi netleştirmeli.

**Test:** `02-navigation.spec.ts` → "boş kategoriler kayıt altında" (`routes.ts → LISTING_EMPTY`).

---

## HOMEE-001 — Ürün detayında JS hatası

**Nerede:** ürün detay sayfaları (örn. `/tepe-sap-test-yeni-urun-p-1099765`)
**Belirti:** `pageerror: parameters is not iterable`
**Etki:** sayfa render oluyor ama bir bileşen çalışmıyor; hatanın hangi özelliği bozduğu
FE tarafında incelenmeli.
**Test:** `05-product-detail.spec.ts` → "konsol hatası yok" (`test.fail`)

---

## HOMEE-002 — `/magazalar` sayfasında kırık görsel · ARALIKLI

**Belirti:** `storage.googleapis.com/tepehome-test-cdn/uploads/images/images/1009341-2.jpg`
yükleniyor gibi görünüyor ama `naturalWidth === 0`.
**Aralıklı:** ilk koşumda kırıktı, sonraki koşumda yüklendi → test CDN'i kararsız.
Bu yüzden `test.fail()` ile işaretlenmedi; test doğrudan assert ediyor, kırık görsel
görüldüğü koşumda fail eder.
**Test:** `08-static-pages.spec.ts` → "statik sayfalarda kırık görsel yok"

---

## HOMEE-003 — İletişim formu boş gönderimde hiçbir geri bildirim vermiyor

**Nerede:** `/iletisim`
**Belirti:** tüm alanlar boşken `GÖNDER`'e basıldığında **ne validasyon, ne hata, ne başarı
mesajı** çıkıyor; sayfa aynı kalıyor, kullanıcı ne olduğunu anlamıyor.
Form alanlarında `required` niteliği de yok (`adınız`, `soyadınız`, `e-posta adresiniz`,
`contact-mesajınız`, `contact-privacy`).
**Test:** `09-forms.spec.ts` → "boş gönderimde validasyon gösterir" (`test.fail`)

---

## HOMEE-004 — Ödeme sayfasında sözleşme metinleri yüklenmiyor (AÇIK — suite'te kırmızı)

**Nerede:** `/odeme`
**Belirti:** "Mesafeli satış sözleşmesi yüklenemedi." + "Ön bilgilendirme formu yüklenemedi."
**Etki:** Kullanıcı onaylamak zorunda olduğu sözleşmeleri okuyamıyor — mevzuat açısından riskli.
**Yan etki (2026-08-22'de düzeltildi):** Önce "sözleşmeler yüklenemediğinde onay
checkbox'ı `name` niteliğini kaybediyor" diye kaydedilmişti. Ölçüm bunu çürüttü:
`/odeme` sayfasındaki **iki checkbox'ın da `name` niteliği hiç yok** —
`#checkout-billing-same` ve `#checkout-contracts-accepted`, sözleşmelerin sorunsuz
yüklendiği koşumda bile. Yani `name` eksikliği bu hatanın yan etkisi değil, ayrı ve
sürekli bir durum. Suite artık ikisini de ID ile bağlıyor.
**Sıklık:** 3 koşumun 2'sinde tekrarlandı (bir koşumda yüklendi).
**Test:** `25-checkout-to-payment.spec.ts` → "sözleşme metinleri yüklenir" —
`test.fail()` ile susturulmadı; **açık hata olduğu için suite'te kırmızı duruyor.**

---

## HOMEE-005 — Arama sonuçlarının TAMAMI prod domain'ine link veriyor (en ciddi bulgu)

**Nerede:** `/arama?q=<herhangi>`
**Ölçüm (2026-08-18):**

| Sayfa | Ürün linki | Site içi | Prod domain'ine |
|---|---|---|---|
| `/arama?q=koltuk` | 50 | **0** | **50** |
| `/arama?q=koltuk` (scroll sonrası) | 100 | **0** | **100** |
| `/arama?q=zzzqwertyyok` (sonuçsuz) | 8 öneri | 0 | 8 |

**Belirti:** sonuç kartları `https://prod.tepehome.com.tr/...?recommended_by=full_search&recommended_code=<sorgu>`
adresine gidiyor. Arama tamamen PersonaClick üzerinden çalışıyor ve **test ortamındaki kullanıcı
sonuç kartına bastığında canlı siteye çıkıyor.**

**Etki:**
- Test ortamında arama sonuçları test edilemiyor (tıklayan prod'a gider).
- Prod'da olmayan/test ürünleri aramada bulunamaz, prod ürünleri test ortamında görünür.
- Sonuçsuz aramada "ürün bulunamadı" mesajıyla birlikte 8 prod öneri kartı gösteriliyor.

**Test:** `04-search.spec.ts` → "arama sonuç kartları site içi link veriyor" (`test.fail`)
ve `02-navigation.spec.ts → 02b` (`test.fail`)

---

## HOMEE-006 — Arama alaka sorunu · ARALIKLI

**Nerede:** `/arama?q=koltuk`
**Belirti:** h1 "KOLTUK (768)" diyor ama bir koşumda ilk sonuçlar kolonya ürünleri döndü
(`the-tonka-ve-myrrh-kolonya-kolonya-50ml`, `...-100ml`). Sonraki koşumda sonuçlar alakalıydı.
**Yorum:** PersonaClick kişiselleştirmesi sonuç sırasını değiştiriyor; HOMEE-005 ile aynı kökten.
**Test:** `04-search.spec.ts` → "arama sonuçları sorguyla alakalı" (deterministik olmadığı için
`test.fail()` yok; alaka bozulduğu koşumda fail eder)

---

## HOMEE-007 — Ürün detayda öneri kartlarının görselleri kırık · ARALIKLI

**Nerede:** ürün detay sayfası, "Diğerleri de sevdi" / "Daha Önce Sepete Ekledikleriniz" bölümleri
**Belirti:** 5 görsel `naturalWidth === 0` dönüyor. Örnek:
`storage.googleapis.com/tepehome-cdn/product/41/images/1001728-1_400x400.jpg`
**Not:** Bu görseller **prod CDN'inden** (`tepehome-cdn`) geliyor, test CDN'inden
(`tepehome-test-cdn`) değil — HOMEE-005 ile aynı desen: öneri bileşeni prod verisine bağlı.
**Test:** `05-product-detail.spec.ts` → "SEPETE EKLE butonu aktif ve ürün görseli yüklü"

---

## HOMEE-008 — Banner metinleri ve CTA'ları görsele gömülü (tasarım diff'inden)

**Nerede:** anasayfa hero ve multi-banner bölümleri
**Belirti:** Figma'da metin katmanı olan içerikler canlıda **DOM'da hiç yok**, banner
görsellerinin içine basılmış. Ölçüm (2026-08-19, `document.body.innerText` taraması):

| Metin | DOM'da |
|---|---|
| `YENİ KOLEKSİYON` | yok |
| `Evde daha sessiz, daha rafine bir mevsim.` | yok |
| `KEŞFET` (hero CTA) | yok |
| `Sakin Salon Kompozisyonu` | yok |
| `LOOK'U KEŞFET` (CTA) | yok |
| `Mekânı yerinde deneyimleyin` / `MAĞAZALAR` | yok |

Görseller `alt="Anasayfa Multi Banner - Salon"` gibi genel alt metinlerle geliyor.

**Etki:** arama motoru bu başlıkları ve çağrıları göremiyor; ekran okuyucu okuyamıyor;
metin değişikliği için görselin yeniden üretilmesi gerekiyor (CMS'den düzenlenemiyor).
**Not:** Kampanya banner'larının CMS'ten görsel olarak yönetilmesi kasıtlı olabilir —
ama en azından hero başlığı ve CTA'nın metin olarak var olması beklenir.
**Kaynak:** `node scripts/figma-diff.mjs --node 140:2705 --route /` → 31 "sayfada yok" bulgusu

---

## HOMEE-011 — Havale açıklama bloğunda 3 hata · [MAC-7303](https://machinarium.atlassian.net/browse/MAC-7303)

**Nerede:** `/odeme` → `HAVALE / EFT`

**Belirti 1 — gönderen adı boş basılıyor (en ciddi):**
> "Havelenizi yaparken gönderen bölümünde mutlaka **""** adını kullanınız."

İsim gelmesi gereken yer boş çift tırnak olarak render ediliyor. Kullanıcıya "şu adı kullan"
deniyor ama ad yazılmıyor — havalede gönderen adı eşleşmesi tahsilat için kritik.
Muhtemelen ayarlardan/servisten gelen bir alanın boş dönmesi.

**Belirti 2 — yazım hatası:** "Havelenizi" → "Havalenizi".

**Belirti 3 — olmayan arayüz:** Açıklama metni şunu diyor:
> "Aşağıdaki menüden havale göndermek istediğiniz banka IBAN numarasını seçip
> **"Siparişi Tamamla"** tuşuna basınız."

Oysa sayfada (ölçüldü 2026-08-22):
- **seçilebilir banka menüsü yok** — tek bir banka bloğu var; ölçüm: sayfada `select` 0,
  görünür `select` 0, `role=combobox|listbox` 0. Yalnızca "Alıcı adını kopyala" ve
  "IBAN'ı kopyala" butonları var
- buton adı **"ÖDEME YAP"**, "Siparişi Tamamla" diye bir buton yok

**Etki:** Kullanıcı ekranda olmayan bir adımı arıyor. Havale, para transferini kullanıcının
elle yaptığı yöntem olduğu için talimat metninin doğru olması kritik.
**Sıklık:** Deterministik (ölçülen her koşumda).
**Test:** `25-checkout-to-payment.spec.ts` → "havale açıklaması sayfada var olan arayüzü
anlatıyor" — `test.fail()` ile takipte; metin düzelirse test kırmızı olur ve kayıt silinir.

---

## ÇÖZÜLDÜ (2026-08-22) — "Sepete eklenen ürün bazen sepette görünmüyor"

Belirti: `SEPETE EKLE` sonrası badge artıyor ama `/sepet` "Sepetiniz boş" gösteriyor.
Üç tam koşumda 1–2 case düşürdü, her seferinde farklı case → başta "kararsız test" sanıldı.

**Kök neden ikiye ayrıldı.**

### 1. Suite hatası (asıl sebep, düzeltildi)

`CartPage.waitForRendered()` boşluk kararını **DOM'a** dayandırıyordu: `badge === 0`
(ve sonradan eklenen `/Sepetiniz boş/` metni) görünce "sepet gerçekten boş" deyip dönüyordu.
Oysa o metin **sayfa yüklenirken de ekranda duruyor** — yani geçici yükleme durumu,
"boş sepet" kanıtı sanılıyordu. `clear()` aynı tuzağa düşüyordu: görünür kaldır butonu
kalmayınca bitmiş sayıp çıkıyor, sepette ürün kalıyor ve **sonraki** test
"sepette zaten 1 ürün var" diye patlıyordu.

Düzeltme: boşluk kararı artık **uygulamanın kendi basket yanıtına** dayanıyor
(`watchBasket()`, navigasyondan önce kurulan response dinleyicisi). API "0 satır"
demedikçe boşluğa inanılmıyor; API ürün olduğunu söylüyorsa satır boyanana kadar
beklenip, süre dolarsa **sessizce geçmek yerine hata fırlatılıyor**.

Doğrulama: tanı spec'i (12 tur) düzeltmeden önce 2 kayıp veriyordu, sonra **12/12 temiz**.

### 2. Ürün tarafı bulgu — [MAC-7304](https://machinarium.atlassian.net/browse/MAC-7304)

Ölçüm, sayfanın **API yanıtı geldikten sonra bile** boş durumu göstermeye devam ettiğini
kanıtladı. Düşen iki turda ağ trafiği birebir şöyleydi:

```
POST /v1/baskets            -> 200, items: 1      (ekleme başarılı)
GET  /v1/baskets/<id>       -> 200, items: 1      (sepet fazı, 1. çağrı)
GET  /v1/baskets/<id>       -> 200, items: 1      (sepet fazı, 2. çağrı)
   ...bu anda ekran: 0 satır, badge 0, "Sepetiniz boş"
   ...satır ~15 sn içinde NAVİGASYON OLMADAN geldi
```

Yani veri kaybı yok, kalıcı hata yok — ama kullanıcı, sepetinde ürün varken birkaç saniye
**"Sepetiniz boş"** görüyor (12 turun 2'sinde, ~%17). Header badge de o pencerede 0 okuyor.
Muhtemel sebep: boş durum, basket yanıtı çözülmeden render ediliyor ve yeniden render
gecikiyor. Kanıt: `panel-data/diag-add.json`, `panel-data/evidence/diag-bos-sepet-tur*.png`.

**Kart: MAC-7304** (2026-08-22, Okan Atayurt'a atandı, iki kanıt görseli ekli).

## Ürün hatası SANILAN ama olmayan davranışlar

İlk koşumlarda hata gibi görünen, keşifle doğrulandığında **doğru çalıştığı** anlaşılan davranışlar.
Not ediliyor ki ekip bunları boşuna kovalamasın:

| Görünen | Gerçek |
|---|---|
| "Çıkış Yap oturumu kapatmıyor" | Buton bir **onay diyaloğu** açıyor ("Çıkış yapmak istiyor musunuz? — Bu cihazdaki oturumunuz sonlandırılacak."). Onay basıldığında `auth_token`/`refresh_token` siliniyor, korumalı sayfa `/giris`'e yönleniyor. Doğru çalışıyor. |
| "Yanlış şifrede hata mesajı yok" | Mesaj var: "Lütfen e-posta adresinizi ya da şifrenizi kontrol edin." — ~1.2 sn sonra çıkıp **kaybolan toast**. Sabit bekleyip bakan test kaçırıyor. |
| "Boş formda validasyon yok" (giriş) | Var: "Lütfen e-posta adresinizi giriniz." + "Lütfen şifrenizi giriniz." Aynı toast davranışı. |
| "Ödeme yöntemleri render olmuyor" | `/odeme` adresine **doğrudan gidilemiyor**; sepette ürün olsa bile `/sepet`e yönlendiriyor. Checkout oturumu "ÖDEME ADIMINA GEÇİN" butonuyla açılıyor. Tasarım gereği. |
| "Adres silinemiyor" | Silme iki aşamalı: kartın "Sil" butonu → `[role=dialog]` onayı ("Bu adresi silmek istediğinize emin misiniz? Bu işlem geri alınamaz."). Doğru çalışıyor. |
| "Favori eklenmiyor" | Favori butonu **toggle**; ürün zaten favorideyse etiketi "Favorilerden çıkar" oluyor. Ayrıca favori listesi lazy yükleniyor. Doğru çalışıyor. |
| "Sepette adet artırınca toplam değişmiyor" | Ürünün **satın alma limiti** var. `deneme` (1099766) ürününde limit 1 → `PUT /v1/baskets/<id>` **406** dönüyor ve **"Bu üründen en fazla 1 adet ekleyebilirsiniz."** mesajı gösteriliyor. Mesaj kaybolan toast olduğu için 2026-08-21 denetimi "sessiz hata" sandı. Limitsiz üründe (`sapTest`) artırma sorunsuz çalışıyor (4.000 → 8.000). Doğru çalışıyor. |
| "Sepette Azalt butonu tıklanamıyor" | Adet **1 iken buton kasıtlı olarak `disabled`** (adet 0'a düşürülemiyor, silme için ayrı "Ürünü kaldır" butonu var). Adet 2'ye çıkınca etkinleşiyor. Doğru çalışıyor. |

## Gözlemler (hata sayılmayan, ama not edilmesi gerekenler)

1. **`/hesabim/iadelerim` bir koşumda "TEKRAR DENE" hata durumunda geldi**, sonraki koşumda
   normal render etti → aralıklı API hatası olabilir. `24-orders.spec.ts` bu durumu assert
   ediyor; tekrar görülürse gerçek bulguya dönüştürülmeli.
2. **`/hesabim/bilgilerim` yok** (404); doğru rota `/hesabim/profil`.
3. **Üye oturumu refresh-token'ı rotate ediyor** → kaydedilmiş oturum ikinci kez kullanılamıyor.
   Bu bir güvenlik davranışı olabilir (kasıtlıysa sorun değil) ama otomasyon açısından
   her testin yeniden login olmasını gerektiriyor; suite buna göre kuruldu.
4. **Kampanya sayfaları** (`/kucuk-mekanlar-1`, `/Tepe-Home-Bahce`) ürün listelemiyor —
   içerik sayfası oldukları için beklenen davranış kabul edildi (`CONTENT_PAGES`).
5. **Adres formunda validasyon kısmi:** boş form kaydedilmeye çalışıldığında yalnızca
   "Lütfen telefon numaranızı giriniz." uyarısı çıkıyor; adres başlığı, ad/soyad, şehir ve
   adres detayı için uyarı yok (form da kaydedilmiyor). Kullanıcı hangi alanın eksik olduğunu
   göremiyor.
6. **Backend:** FE'nin konuştuğu API `https://ecom-api.test.tepehome.com.tr`
   (`POST /auth/login` yanlış kimlikte 401). İleride API seviyesinde test yazılabilir.
7. **Test ortamındaki havale IBAN'ı geçerli bir TR IBAN'ı değil:**
   `/odeme` → HAVALE / EFT bloğunda `TR1000012345678901234567890` yazıyor — bu
   **TR + 25 hane**, geçerli TR IBAN'ı ise TR + 24 hane (toplam 26 karakter).
   Kukla test verisi olduğu varsayılıyor; **prod'a çıkmadan gerçek IBAN ile
   değiştirilmeli ve doğrulanmalı.** `25-checkout-to-payment.spec.ts` şu an
   `/^TR\d{20,25}$/` ile geçiyor, gerçek veri gelince `/^TR\d{24}$/` yapılmalı.
8. **`/odeme` sayfasındaki iki checkbox'ın da `name` niteliği yok**
   (`#checkout-billing-same`, `#checkout-contracts-accepted`). Form gönderimi JS
   ile yapıldığı için çalışıyor ama otomasyon ve erişilebilirlik için isimlendirme
   beklenirdi. Suite ID ile bağlıyor.
9. **Sepet özeti basket yenilemesinde yeniden mount oluyor.** `/sepet` ve `/odeme`
   sayfalarında "Ara toplam" / "Toplam" satırı, arka planda dönen
   `GET /v1/baskets` + `/api/auth/set-cookies` + `/api/auth/get-token` turlarında
   bir an DOM'dan çıkıyor; header sepet badge'i de aynı anda kayboluyor.
   Kullanıcı için görünür etkisi kısa bir "zıplama", ama otomasyon için gerçek bir
   sorun: 2026-08-22'de 5 tam koşumda 4 ayrı test tek seferlik okuma yüzünden düştü
   ("ara toplam okunamadı", "sepete eklenen ürün sepette görünmüyor"). Suite artık
   poll ediyor (`CartPage.moneyNear`, `CheckoutPage.summaryTotal`, `waitForRendered`)
   — ama **uygulama tarafında gereksiz token/basket yenileme trafiği** ayrıca
   incelenmeye değer (denetimde de "aşırı auth token yenilemesi" olarak çıkmıştı).
10. **Checkout/sepet dokunma hedefleri WCAG 2.2 AA'ya UYGUN — "25 ihlal" iddiası yanlıştı.**
   2026-08-21 denetimi 44x44 (Apple iOS kılavuzu / WCAG AAA) eşiğiyle ölçüp `/odeme`'de
   "25 küçük dokunma hedefi" saymıştı. AA eşiği **24x24** (2.5.8) ve iki muafiyeti var
   (satır içi metin linkleri; hedefin etrafında 24px boşluk varsa geçer).
   Doğru ölçütle yeniden ölçüldü (2026-08-22, masaüstü 1440x900 + mobil 412x915):

   | Sayfa | Hedef | <24px | **AA ihlali** | <44px |
   |---|---|---|---|---|
   | masaüstü `/sepet` | 59 | 25 | **0** | 48 |
   | masaüstü `/odeme` | 30 | 12 | **0** | 24 |
   | mobil `/sepet` | 42 | 6 | **0** | 33 |
   | mobil `/odeme` | 18 | 6 | **0** | 13 |

   Yani **uyum sorunu yok**; ama 44x44 tavsiyesini karşılamayan hedef sayısı yüksek
   (mobil `/odeme`'de 18 hedefin 13'ü) — bu bir tasarım kalitesi notu, hata değil.
   Ölçüm dosyası: `panel-data/a11y-checkout.json`.
11. **Mobil `/odeme`'de etkileşimli öğe sayısı masaüstünün yarısı** (18 ↔ 30).
   Farkın bir kısmı header'ın masaüstü linkleri ve footer'dan geliyor, ama mobilde
   gerçekten eksik bir kontrol olup olmadığı doğrulanmadı — mobil kapsam onaylanırsa
   ilk bakılacak yer burası.
