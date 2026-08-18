# Homee — İlk regresyon taraması bulguları

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

## HOMEE-002 — `/magazalar` sayfasında kırık görsel

**Belirti:** `storage.googleapis.com/tepehome-test-cdn/uploads/images/images/1009341-2.jpg`
yükleniyor gibi görünüyor ama `naturalWidth === 0`.
**Test:** `08-static-pages.spec.ts` → "kırık görsel yok" (`test.fail`)

---

## HOMEE-003 — İletişim formu boş gönderimde hiçbir geri bildirim vermiyor

**Nerede:** `/iletisim`
**Belirti:** tüm alanlar boşken `GÖNDER`'e basıldığında **ne validasyon, ne hata, ne başarı
mesajı** çıkıyor; sayfa aynı kalıyor, kullanıcı ne olduğunu anlamıyor.
Form alanlarında `required` niteliği de yok (`adınız`, `soyadınız`, `e-posta adresiniz`,
`contact-mesajınız`, `contact-privacy`).
**Test:** `09-forms.spec.ts` → "boş gönderimde validasyon gösterir" (`test.fail`)

---

## HOMEE-004 — Ödeme sayfasında sözleşme metinleri yüklenmiyor

**Nerede:** `/odeme`
**Belirti:** "Mesafeli satış sözleşmesi yüklenemedi." + "Ön bilgilendirme formu yüklenemedi."
**Etki:** Kullanıcı onaylamak zorunda olduğu sözleşmeleri okuyamıyor — mevzuat açısından da riskli.
**Test:** `25-checkout-to-payment.spec.ts` → "sözleşme metinleri yüklenir" (`test.fail`)

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

## HOMEE-006 — Arama alaka sorunu

**Nerede:** `/arama?q=koltuk`
**Belirti:** h1 "KOLTUK (768)" diyor ama ilk sonuçlar kolonya ürünleri
(`the-tonka-ve-myrrh-kolonya-kolonya-50ml`, `...-100ml`). Sorgu ile sonuç kümesi alakasız.
**Not:** HOMEE-005 ile aynı kökten (PersonaClick full_search) geliyor olabilir.
**Test:** `04-search.spec.ts` → "arama sonuçları sorguyla alakalı" (`test.fail`)

---

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
