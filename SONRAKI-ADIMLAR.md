# Homee QA — bekleyen işler

Öncelik sırasına göre. Tamamlananı buradan sil.

## 1. Jira'ya sonuç yazma (kullanıcı onayı bekliyor)

12 `Test` statüsündeki karta koşum sonucunu yorum olarak yazmak.
Panel → Jira sekmesi → kart → "Yorum yaz" hazır; her yorum onay diyaloğu arkasında.
Kart ↔ spec eşlemesi `tests/jira-map.ts`.

## 2. Yeni bug kartı açma (kullanıcı onayı bekliyor)

Jira'da karşılığı bulunamayan bulgular (arama yapıldı, mükerrer değil):

| Bulgu | Kart açılacak yer | Not |
|---|---|---|
| HOMEE-001 ürün detayda `parameters is not iterable` | MAC-7073 altına | — |
| HOMEE-003 iletişim formunda hiç validasyon yok | MAC-7080 altına | — |
| HOMEE-004 checkout sözleşme metinleri yüklenmiyor | MAC-7075 altına | Android karşılığı `MAC-6817` var (Test Blocked) |
| HOMEE-005 arama sonuçları prod domain'ine link veriyor | MAC-7039/7072 altına | 50/50 kart prod'a gidiyor |

İsim kalıbı: `TEPE - Redesign > <Alan> > <problem>`

## 3. Figma tasarım diff'i — BEKLEMEDE (2026-08-18'de kullanıcı erteledi)

Karar: **spec diff + yan yana görsel** birlikte. Piksel diff yapılmayacak (tasarım↔kod
arasında gürültü üretir: font hinting, gerçek ürün görselleri, dinamik fiyat/stok).

Başlamak için gerekenler:
1. **Figma personal access token** → `~/.figma-credentials` içine `FIGMA_TOKEN=...`
   (repoya girmez). figma.com linki tek başına yetmez: sayfa JS ile render olan,
   oturum gerektiren bir uygulama; WebFetch ile tasarım verisi çıkmaz.
2. `?node-id=` içeren frame linkleri (hangi frame hangi sayfa belli olsun)
3. Frame ↔ rota eşlemesi (Main Page → `/`, PLP → `/tum-urunler`, PDP → `/<slug>-p-<sku>`,
   Sepetim → `/sepet`, Checkout → `/odeme`)

Kurulacak yapı:
- `panel/figma.mjs` — token, dosya ağacı (`/v1/files/:key`), frame render (`/v1/images/:key`)
- `scripts/figma-diff.mjs` — frame ↔ rota için: renk/font/boyut/spacing/radius farkları
  (`getComputedStyle` ile), metin katmanı farkları, yan yana + saydamlık raporu
- `tests/figma-map.ts` — frame ↔ rota ↔ Jira kartı eşlemesi
- Panele "Tasarım diff" sekmesi

Kısayol: Jira kart açıklamalarında `Tepe Home UI/UX Design` linki var — token gelince
dosya key'i oradan çıkarılıp kart↔frame eşlemesi otomatik kurulabilir.

## 4. Kapsam dışı kalanlar (karar bekliyor)

- **Sipariş tamamlama** (`MAC-7076` Order Confirmation test edilemiyor):
  `ALLOW_HOMEE_ORDERS=1` + test kartı bilgisi gerekiyor
- **Mobil viewport**: config'de `mobile` projesi hazır, spec'ler ayarlanmadı
- **CI**: suite `workers:1` ve sistem Chrome'u ile koşuyor; CI'da tarayıcı kurulumu gerekir
- **Testin tarayıcısını panelde aynalamak**: CDP `Page.startScreencast` ile mümkün
  (iframe testin tarayıcısı değil, ayrı oturum)
