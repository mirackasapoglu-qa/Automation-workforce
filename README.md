# Homee QA — Playwright E2E Regresyon Suite

Tepe Home redesign (`redesign-prod.test.tepehome.com.tr`) için genel regresyon otomasyonu.
Mimari NadirGold QA suite'inden taşındı; Homee'ye özgü farklar `CLAUDE.md`'de.

## Kurulum

```bash
npm install
cp .env.example .env     # GATE_*, TEST_EMAIL, TEST_PASSWORD doldur
npm test
```

Bundled Playwright tarayıcısı gerekmez — sistemdeki Chrome kullanılır (`channel: "chrome"`).

## Koşum

| Komut | Ne koşar |
|---|---|
| `npm test` | tüm testler |
| `npm run test:guest` | misafir seti (01–09) |
| `npm run test:member` | üye seti (20–25) |
| `npm run test:sepet` | tek grup örneği (headed) |
| `npm run panel` | QA paneli → http://localhost:4646 |
| `npm run report:create` | HTML koşum raporu |

## Kapsam

**Misafir (login gerektirmez)**
`01` anasayfa · `02` navigasyon + rota sağlığı + domain sızması · `03` kategori/liste (filtre,
sıralama, daha fazla göster) · `04` arama · `05` ürün detay · `06` sepet (ekle/adet/sil/toplam) ·
`07` mağazalar · `08` statik sayfalar · `09` formlar (validasyon)

**Üye**
`20` giriş pozitif/negatif · `21` hesabım özeti + çıkış · `22` adres CRUD · `23` favoriler ·
`24` siparişler/iadeler · `25` ödeme adımı

⚠️ **Sipariş tamamlanmaz.** `25` ödeme adımına kadar gider; `ÖDEME YAP` butonuna basılmaz.
Tam sipariş için `ALLOW_HOMEE_ORDERS=1` gerekir.

## Bulgular

İlk regresyon taramasının ürün bulguları: **[FINDINGS.md](FINDINGS.md)**
(6 kırık rota, 5 boş kategori, HOMEE-001…005).

Bilinen hatalar `tests/known-issues.ts`'te kayıtlı ve ilgili testlerde `test.fail()` ile
işaretli — hata düzeldiğinde test "beklenmedik geçti" diye kırmızı olur ve kaydın silinmesini zorlar.
