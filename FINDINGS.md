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
**Yan etki:** Sözleşmeler yüklenemediğinde onay checkbox'ı
`name="checkout-contracts-accepted"` niteliğini de **kaybediyor** (DOM'da isimsiz checkbox
olarak kalıyor). Otomasyon ve erişilebilirlik açısından ayrıca sorunlu.
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
