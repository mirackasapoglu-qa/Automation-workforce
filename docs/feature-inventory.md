# Özellik Envanteri — Homee (Tepe Home redesign)

> Bu dosya `homee-pm-analyst` agent'ının ürettiği belgedir. Kapsam ağacındaki
> modül / sayfa / bölüm / fonksiyon dökümünü, durum ve test kapsamıyla birlikte
> verir. Girdisi `node scripts/scope-snapshot.mjs` çıktısıdır.

**Son güncelleme:** 2026-08-26
**Kaynak veri:** `docs/scope-tree.json` (`exportedAt: 2026-08-26T14:20Z`) ·
`tests/jira-map.ts` · `tests/known-issues.ts` · panel `/api/specs` ·
`panel-data/verdicts/`
**Ortam:** `HOMEE_ENV=test` → `https://redesign-prod.test.tepehome.com.tr`

## Durum lejantı

`⬜` henüz test edilmedi · `🔵` devam ediyor · `✅` doğrulandı · `⚠️` dikkat ·
`❌` hata bulundu

⚠️ **Kapsam ağacındaki 147 düğümün tamamı şu an `⬜`.** Yani ağaç üzerinden
"doğrulandı" denebilecek hiçbir düğüm yok; doğrulama bilgisi şimdilik Playwright
suite'inin koşum sonuçlarında ve tek bir verdict kaydında duruyor.

## Genel bakış

| Ölçü | Değer | Kaynak |
|---|---|---|
| Düğüm | **147** | scope-tree.json |
| Tip dağılımı | 2 modül · 43 sayfa · 45 bölüm · 57 fonksiyon | scope-tree.json |
| Durum dağılımı | 147 × `⬜` | scope-tree.json |
| Ağaçtaki test case | **24** (23 üretilmiş taslak · **1** koşum kaydı olan) | scope-tree.json |
| Otomatik suite | **17 spec · 88 case** | panel `/api/specs` |
| Bağlı Jira kartı (ağaçta) | 15 | scope-tree.json |
| Eşlenmiş Jira kartı (kart↔spec) | 19 → 12 `full`, 5 `partial`, 3 `none` | tests/jira-map.ts |
| Bilinen hata kaydı | 11 (HOMEE-001…011) | tests/known-issues.ts |
| Elle verilmiş karar (verdict) | 1 (MAC-7039 · pass) | panel-data/verdicts/ |

### İki modül var, ikisi aynı şey değil

| Modül | Düğüm | Nasıl oluştu |
|---|---|---|
| **Homee** | 15 | Profilden tohumlandı (`panel/projects/homee.mjs → routes.rules`); adlar suite'in spec numaralarıyla hizalı (`01 Anasayfa`, `25 Ödeme adımı`) |
| **Tepe Home \| Modern Mobilya…** | 132 | Panelin DOM-sezgisel crawler'ı (`/api/crawl`) ile eklendi |

⚠️ **Bulgu:** ikinci modülün adı sayfanın `<title>` etiketi, düğüm adları da
sayfa başlıkları — yani gezinme menüsü ile gerçek özellik ayrımı yapılmamış. Bu,
`homee-site-crawler` agent'ının çözmek için eklendiği zaaf. Envanterin
"gerçek" tarafı şimdilik **Homee** modülü.

## Suite ile hizalı sayfalar (Homee modülü)

| Sayfa | Ağaçtaki case | Bağlı Jira | Doğrulayan spec (jira-map) |
|---|---|---|---|
| 01 Anasayfa | 1 | MAC-7037, MAC-7040, MAC-7041 | 01-homepage, 02-navigation, 04-search, 08-static-pages, 09-forms |
| 03 Kategori/liste | 7 | MAC-7039, MAC-7072 | 03-category-listing, 02-navigation |
| 04 Arama | 2 | MAC-7040 | 04-search |
| 05 Ürün detay | 3 | — | 05-product-detail (MAC-7073 üzerinden) |
| 06 Sepet | 0 | MAC-7074 | 06-cart |
| 07 Mağazalar | 2 | MAC-7078 | 07-stores |
| 08 Statik sayfalar | 2 | MAC-7071, MAC-7079, MAC-7116 | 08-static-pages |
| 09 Formlar | 0 | MAC-7080 | 09-forms |
| 20 Giriş | 0 | MAC-7043 | 20-login |
| 21 Hesabım özeti | 0 | MAC-7077 | 21-account-overview |
| 22 Adres yönetimi | 0 | MAC-7077 | 22-addresses |
| 23 Favoriler | 0 | MAC-7077 | 23-favorites |
| 24 Siparişler/iadeler | 0 | MAC-7077 | 24-orders |
| 25 Ödeme adımı | 0 | MAC-7075 | 25-checkout-to-payment |

## Kapsam boşlukları

1. **Ağaçta case'i olmayan 34 sayfa** (43 sayfanın 9'unda case var). Suite ile
   hizalı olanlardan 8'i boş: Sepet, Formlar, Giriş, Hesabım özeti, Adres,
   Favoriler, Siparişler, Ödeme adımı. Bu sayfaların otomatik spec'i VAR —
   yani boşluk "test yok" değil, **ağaçta karşılığı yok**.
2. **Jira kartı da case'i de olmayan 26 sayfa** — hepsi crawler'ın eklediği
   modülde. Önce adlandırma temizliği gerekiyor, sonra kart eşlemesi.
3. **Spec eşlemesi olmayan 3 kart** (`coverage: none`): MAC-7038 (Sign up),
   MAC-7053 (Component'lerin oluşturulması), MAC-7036 (Splash ekranı).
   MAC-7038 için panelde eşleme editörü var; diğer ikisi ürün tarafında
   otomasyona uygun olmayabilir — karar gerekiyor.
4. **Kısmi kapsam 5 kart** (`partial`): MAC-7072, MAC-7075, MAC-7076,
   MAC-7079, MAC-7116. Bunların hangi kısmının kapsamda olmadığı `jira-map.ts`
   içindeki `note` alanlarında yazılı; envantere taşımak için kart kart okumak
   gerekiyor (bu turda yapılmadı).
5. **Üretilmiş 23 case'in 0'ı koşuldu.** Taslaklar kanıt değildir; koşum kaydı
   olan tek case `03 Kategori/liste` altında.

## Bilinen hatalar (11 kayıt)

Kayıtlar `tests/known-issues.ts` içinde `id` + `where` + `detail` olarak duruyor
ve panelin "Bilinen hatalar — hâlâ tekrarlıyor mu?" tablosunu besliyor. Bu
turda **kayıt bazında düğüm eşlemesi yapılmadı**: `where` alanı serbest metin,
ağaç düğümüyle otomatik eşleşmiyor. Bir sonraki güncellemede eşleme kurulmalı
(ya da `known-issues.ts`'e `nodeId` alanı eklenmeli).

## Bu güncellemede

Belgenin ilk sürümü. Sonraki turda kapatılacaklar: `partial` kartların
eksik kısımları, bilinen hata ↔ düğüm eşlemesi, crawler modülünün adlandırma
temizliği.
