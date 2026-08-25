# Homee QA — bekleyen işler

Öncelik sırasına göre. Tamamlananı buradan sil.

## 1. Jira — checkout turu TAMAMLANDI (2026-08-22)

Yazılanlar: **MAC-7303** yeni hata kartı (havale açıklama bloğu, 3 hata, kanıt görseli ekli)
+ 7 yorum → MAC-7268 (düzeltme + sıklık), MAC-7269 (WCAG AA ölçümü),
MAC-7248 ve MAC-7251 (Test statüsündeki alt görevler, ölçüm sonucu + kanıt),
MAC-7074 / 7075 / 7076 (koşum sonucu + açılan sipariş numaraları).

Statü geçişleri de yapıldı: **MAC-7248** ve **MAC-7251** → `Test` → **Ready For Release**
(gerekçe her ikisinde ayrı yorum olarak; MAC-7251'de ikon/yerleşim teyidi tasarımda açık kaldı).

Ekipten gelen tepki (aynı gün):
- **MAC-7303** ECOM Sprint 16'ya alındı, Okan Atayurt'a atandı, başlık ekip konvansiyonuna çevrildi.
- **MAC-7268** (sözleşme metinleri) `Tamam`a taşındı. ⚠️ Hata **aralıklı** (8 koşumun 1'i);
  suite'teki assertion susturulmadı, tekrar ederse koşum kırmızı olur ve kart yeniden açılmalı.

Kalan: **panelin "Test kolonu" görünümü alt görevleri kaçırıyor.** JQL yalnızca epic'in
doğrudan çocuklarına bakıyor; `MAC-7074` altındaki Test statüsündeki alt görevler
(MAC-7248, MAC-7251) panelde görünmüyordu, elle bulundu. Sorgu genişletilmeli.
⚠️ Yeri değişti (2026-08-24): JQL'ler artık `panel/projects/homee.mjs → jira.views`
içinde, `panel/jira.mjs`'de değil.

## 2. Diğer bulgular için kart durumu

| Bulgu | Kart | Durum |
|---|---|---|
| HOMEE-001 ürün detayda `parameters is not iterable` | MAC-7261 | açık |
| HOMEE-003 iletişim formunda validasyon yok | MAC-7258 | açık |
| HOMEE-004 checkout sözleşme metinleri | MAC-7268 | açık, 2026-08-22'de yorumlandı |
| HOMEE-005 arama sonuçları prod domain'ine link veriyor | MAC-7259 | açık |
| HOMEE-009 varyantlı üründe `/null` isteği | MAC-7260 | açık |
| HOMEE-011 havale açıklama bloğu | **MAC-7303** | 2026-08-22'de açıldı |
| Sepete eklenen ürün bazen görünmüyor | — | **ÇÖZÜLDÜ 2026-08-22.** Kök neden suite'teydi (boşluk kararı DOM'dan veriliyordu); `CartPage` artık API'ye soruyor. Ürün tarafındaki yan bulgu (boş durum, basket yanıtı geldikten sonra da saniyelerce duruyor, ~%17) → **MAC-7304**, Okan Atayurt |

## 3. Figma tasarım diff'i — DONDURULDU (2026-08-24 rakip analizi sonrası)

**Karar: mevcut hâliyle kalsın, büyütmeye yatırım yapılmasın.** Uiprobe aynı
konumlandırmayı satıyor (property-level diff, beklenen↔gerçek değer, login arkasındaki
sayfa dahil, $39/ay, Free planda 5 probe/ay). Bizim gerçek üstünlüğümüz yalnızca
kart→frame `node-id` otomasyonu ve ölçülmüş kota kontrolü. Eksik bir şey çıkarsa
önce Uiprobe'un Free planıyla karşılaştır, kod yazma. 2026-08-18'deki erteleme
kararı doğruymuş.

Aşağıdaki plan, iş yeniden açılırsa diye duruyor — kendiliğinden başlatılmaz:

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

## 3b. Panel ürün kararı — rakip analizi (2026-08-24)

Beş katman, dört rakip, satır satır matris:
https://claude.ai/code/artifact/3f4c43de-dc17-4c24-8ac3-06e390b7da3c

**Yazmaya devam:** Jira döngüsü (kimse çift yönlü yapmıyor — TestDino fail'den issue
açıyor ama karta dönüp yorum yazmıyor, statü geçirmiyor) · V1↔V2 flag diff'i · koşum
tetikleme + tek case kilidi · sıfır bağımlılık taşınabilirliği.

**Hazır al — SIRADAKI İŞ:** flaky kök-neden kümeleme + gömülü trace viewer + trend
analitiği için **Piwi** (piwitests.dev, MIT, self-hosted, telemetrisiz, 1 Docker
konteyner ya da masaüstü app). Bizde bunların hiçbiri yok; `flaky-analyzer` agent'ı
yerine geçmiyor. Yapılacak: yanına kur, panelden link ver. Tahmin: 1 gün.
Sıfırdan yazmak: haftalar.

**Bırak:** Figma diff (bkz. §3).

**Mimari eksik (tek seferlik iş değil):** panelde kimlik doğrulama yok, tek kullanıcı
varsayımı üzerine kurulu (güvenlik whitelist + token/Origin ile). İkinci bir kişi
kullanacaksa Piwi'nin opsiyonel RBAC'ı ile aramızdaki fark buradan başlıyor.

**Zaman baskısı:** "Jira kartını oku → testi koş → kanıtı karta yaz → statüyü geçir"
döngüsü 2026'da ürünleşiyor (TestDino zaten MCP'den koşum tetikliyor). Bugün ayırt
edici olan Jira döngüsü 6–12 ayda standart özellik olabilir.

## 4. Kapsam dışı kalanlar (karar bekliyor)

- **Kredi kartı ile sipariş tamamlama** (`MAC-7076`): test kartı bilgisi gerekiyor.
  Havale akışı kapsandı ve **2026-08-22'de yeşil koşum alındı**
  (`26-order-transfer.spec.ts`, `ALLOW_HOMEE_ORDERS=1` → `ORD-20260821-122521`, ₺55.755;
  sipariş no UTC tarihini kullanıyor, bu yüzden 0821 görünüyor — hata değil).
- **İndirim kodu / kupon adımı**: kasıtlı olarak kapsam dışı (kullanıcı kararı, 2026-08-21)
- **Mobil viewport**: config'de `mobile` projesi hazır, spec'ler ayarlanmadı.
  Onaylanırsa ilk bakılacak yer: mobil `/odeme`'de etkileşimli öğe sayısı masaüstünün
  yarısı (18 ↔ 30) — eksik kontrol var mı doğrulanmalı (bkz. FINDINGS.md → Gözlemler 11).
  Erişilebilirlik tarafı kapandı: WCAG 2.2 AA ihlali her iki viewport'ta 0.
- **CI**: suite `workers:1` ve sistem Chrome'u ile koşuyor; CI'da tarayıcı kurulumu gerekir
- **Testin tarayıcısını panelde aynalamak**: CDP `Page.startScreencast` ile mümkün
  (iframe testin tarayıcısı değil, ayrı oturum)
