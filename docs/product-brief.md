# Ürün Özeti — Homee (Tepe Home redesign) QA'sı

> `homee-pm-analyst` agent'ının ürettiği belge. Kapsam ağacı, Jira eşlemesi ve
> Playwright suite'inden çıkarılmıştır; ürün tarafında doğrulanmamış varsayım
> içermez — bilinmeyen yerler "bilinmiyor" olarak yazılıdır.

**Son güncelleme:** 2026-08-26
**Kaynak veri:** `docs/scope-tree.json` (`exportedAt: 2026-08-26T14:20Z`) ·
`tests/jira-map.ts` · `tests/known-issues.ts` · `panel/projects/homee.mjs`

## 1. Ürün ve ortam

Test edilen şey, Tepe Home e-ticaret sitesinin **redesign** sürümü. QA tarafı
iki parçadan oluşuyor:

- **Playwright suite** — 17 spec, 88 otomatik case. Misafir seti `01–09`, üye
  seti `20–25`.
- **QA paneli** (`localhost:4646`) — koşum tetikleme (whitelist'li), canlı log,
  case defteri, Jira kart akışı, performans ölçümü, tasarım diff'i, kapsam
  ağacı (Flowscope).

Aktif ortam `.env → HOMEE_ENV`; şu an `test` →
`https://redesign-prod.test.tepehome.com.tr`. Site **"Geçici Erişim" kapısının
arkasında**: oturum `playwright/.auth/<env>-gate.json` içinde tutulur.

## 2. Ana kullanıcı akışları

Kapsam ağacındaki sayfa hiyerarşisinden çıkan akışlar:

1. **Keşif** — Anasayfa → mega menü / arama → kategori-liste (filtre, sıralama,
   "Daha fazla göster") → ürün detay.
2. **Satın alma** — ürün detay → sepet (adet, silme, sipariş özeti) → ödeme
   adımı → sipariş onayı.
3. **Hesap** — giriş → hesabım özeti → adres yönetimi, favoriler,
   siparişler/iadeler.
4. **Kurumsal / destek** — statik sayfalar (Hakkımızda, Yardım Merkezi,
   Bloglar), mağazalar, iletişim formu.

## 3. QA açısından riskli alanlar — gerekçesiyle

| Alan | Risk | Neden (ölçülmüş/belgeli) |
|---|---|---|
| Ödeme / sipariş tamamlama | **Yüksek** | Açılan sipariş geri alınamıyor: iptal akışı POM'da yok. Bu yüzden `ALLOW_HOMEE_ORDERS` guard'ı var ve `25-checkout-to-payment` "ÖDEME YAP"a basmıyor. |
| Kapı oturumu | **Yüksek** | ~24 saatte sessizce ölüyor ve dolduğunda tüm ölçüm yanlış çıkıyor; bir kez 33 rotalık perf sweep'ini çöpe attırdı. Panelin üst barında kalan süre göstergesi bu yüzden var. |
| Hesabım CRUD (22–27) | Orta | Suite kasıtlı olarak **yıkıcı değil** (gerçek silme / şifre değişimi yok). Bu tasarım kararı bozulursa hesap kalıcı bozulur. `phoneUpdate` OTP kapalı hesapta telefonu doğrudan günceller. |
| Kategori/liste | Orta | En yoğun redesign alanı (MAC-7039 + MAC-7072, `partial`). Ağaçta en çok case burada (7) ve tek koşum kaydı da burada. |
| Statik sayfalar / Bloglar | Düşük-orta | 3 kart tek spec'e bağlı (`08-static-pages`), MAC-7079 ve MAC-7116 `partial`. |
| Sign up / Splash / Component'ler | **Bilinmiyor** | MAC-7038, MAC-7036, MAC-7053 için spec eşlemesi `none`. Otomasyona uygun mu, karar verilmedi. |

## 4. Otomatik ve elle kapsam

- **Otomatik**: 88 case, 17 spec; kart↔spec eşlemesi 19 kartın 16'sında var
  (12 `full`, 5 `partial`).
- **Elle**: kapsam ağacındaki 24 case'in 23'ü **taslak** (`generated: true`,
  koşum kaydı yok) — yani henüz kanıt değil. Elle verilmiş karar (verdict)
  sayısı 1: MAC-7039 `pass`.
- **Ağaç durumu**: 147 düğümün tamamı `⬜`. Ağaç şu an bir *harita*, bir
  *sonuç defteri* değil.

## 5. Sonraki adım önerisi

1. **Ağacı suite ile hizala**: otomatik spec'i olan ama ağaçta case'i olmayan 8
   sayfa (Sepet, Formlar, Giriş, Hesabım, Adres, Favoriler, Siparişler, Ödeme)
   için panelden kart bazlı üretim çalıştır — spec'i olan sayfada üretim
   kartın kabul kriterlerine dayanıyor.
2. **Crawler modülünü temizle**: 132 düğümlük "Tepe Home | …" modülü sayfa
   `<title>`'larından üretilmiş; `homee-site-crawler` ile yeniden kurup gerçek
   bölge/eylem ayrımı yapılmalı, sonra kart eşlemesi bağlanmalı.
3. **`coverage: none` üç kart için karar**: eşleme editöründen spec bağla ya da
   "otomasyon dışı" olarak işaretle.
4. **Bilinen hataları düğüme bağla**: `known-issues.ts`'e `nodeId` alanı
   eklenirse panel "bu sayfada bilinen hata var" uyarısını ağaçta da
   gösterebilir.
5. **Taslakları koş**: 23 üretilmiş case koşulmadan kapsam artmıyor.
