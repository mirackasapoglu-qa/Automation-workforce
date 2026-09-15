/*
 * TEST CASE ÜRETİM SEÇENEKLERİ — tür sözlüğü, presetler ve TÜR SEÇİCİ bileşeni.
 *
 * NEDEN AYRI DOSYA (2026-09-15): drawer'daki "QA Analizi" bölümü (presetler ·
 * tür checkbox'ları · tür paketleri) tek düğüm için çalışıyordu; toplu seçim
 * çubuğundaki "Test case üret" ise seçenek sormadan sabit happy+negative ile
 * gidiyordu. Kullanıcı toplu üretimde de AYNI seçenekleri istedi. İki yerde
 * aynı arayüzü ayrı ayrı kurmak birinin diğerinden sapmasıyla biterdi — tür
 * listesi, preset mantığı ve paket satırı artık tek yerden çiziliyor.
 *
 * Modele giden talimat metni burada DEĞİL: sunucudaki testcase-gen.mjs → TYPES
 * (istem orada kuruluyor, tek kaynak). Buradaki `instruction` yalnız tooltip.
 *
 * Bileşen durumsuz: seçimi çağıran tutar (drawer'da module-scope, toplu
 * modalda modal-scope) ve her değişiklikte `onChange` ile yeniden çizer —
 * drawer'ın renderDrawer() deseniyle aynı.
 */
import { loadPackages, renderPackageRow } from './type-packages.js';

export const TEST_TYPE_META = {
  happy: {
    label: 'Happy Path',
    instruction: 'Temel, hatasız, başarıyla tamamlanan senaryo(lar) için case yaz (genelde 1-2 case yeterli).'
  },
  negative: {
    label: 'Negatif / Validasyon',
    instruction: 'Zorunlu alan eksikliği, format hatası, izin verilmeyen değer, hata mesajı gibi tespit '
      + 'ettiğin HER validasyon/hata kuralı için ayrı bir case yaz — sayıyı yapay şekilde sınırlama.'
  },
  boundary: {
    label: 'Sınır Değerler',
    instruction: 'Minimum/maksimum uzunluk, 0, negatif değer, aşırı büyük değer gibi sınır (boundary) '
      + 'durumları için case yaz (uygulanabilirse).'
  },
  emptyFull: {
    label: 'Boş/Dolu Veri',
    instruction: 'Hiç veri yokken (boş durum mesajı) ve çok fazla veri varken (kaydırma/sayfalama, performans) '
      + 'davranışı test eden case\'ler yaz (uygulanabilirse).'
  },
  regression: {
    label: 'Regresyon',
    instruction: 'Bu bileşene bağlı geçmiş Jira görevlerini (jiraTasks) ve durum geçmişini kontrol et; daha '
      + 'önce hataya düşmüş bir davranış varsa, bunun tekrar etmediğini doğrulayan bir regresyon case\'i yaz '
      + '(bkz. tc37/TP-123 örneği) — geçmişte hata yoksa bu türü atla.'
  },
  recovery: {
    label: 'Hata Kurtarma',
    instruction: 'Ağ hatası/timeout/API hatası gibi durumlarda kullanıcının ne gördüğünü ve toparlanabildiğini '
      + '(retry, hata mesajı) test eden case yaz (uygulanabilirse).'
  },
  ui: {
    label: 'UI / Görsel Tutarlılık',
    instruction: 'Responsive davranış, hover/focus/disabled görsel durumları, layout bozulmaları için case '
      + 'yaz (uygulanabilirse).'
  },
  a11y: {
    label: 'Erişilebilirlik',
    instruction: 'Klavye ile gezinme, görünür focus durumu, temel okunabilirlik/kontrast için case yaz '
      + '(uygulanabilirse).'
  },
  performance: {
    label: 'Performans',
    instruction: 'Büyük veri setinde yükleme/kaydırma/render performansını test eden case yaz (uygulanabilirse).'
  },
  security: {
    label: 'Güvenlik',
    instruction: 'Yetkisiz erişim, girdi enjeksiyonu (XSS vb.) gibi TEMEL güvenlik kontrollerini test eden case '
      + 'yaz (uygulanabilirse) — kapsamlı bir pentest değil, temel QA seviyesinde bir kontrol.'
  }
};

/**
 * Üç kademeli preset — QA pratiğindeki smoke→standart→tam-regresyon sırasına
 * karşılık gelir. "Temel" varsayılan seçimle (happy+negative) birebir aynı.
 * Presete tıklamak TÜM seçimi o kombinasyona EŞİTLER (aç/kapa değil; tür
 * paketi pilleriyle aynı "uygula" davranışı — üç düğme de tutarlı).
 */
export const TEST_TYPE_PRESETS = [
  { key: 'happy', label: 'Happy Path', types: ['happy'] },
  { key: 'temel', label: 'Temel', types: ['happy', 'negative'] },
  { key: 'tumu', label: 'Tümü', types: Object.keys(TEST_TYPE_META) },
];

/** Varsayılan seçim — drawer ve toplu modal aynı yerden başlar. */
export const DEFAULT_TYPES = ['happy', 'negative'];

/**
 * Tür seçici: "Test kapsamı" etiketi · preset pilleri · (açıksa) tür
 * checkbox'ları · tür paketleri satırı.
 *
 * @param {object} p
 * @param {Set<string>} p.selected   seçili türler (çağıran tutar, burada mutasyona uğrar)
 * @param {boolean} p.expanded       checkbox listesi açık mı
 * @param {(next: {selected: Set<string>, expanded: boolean}) => void} p.onChange
 *        her değişiklikte çağrılır; çağıran yeniden çizer
 * @param {() => void} [p.onPackagesLoaded]  tür paketleri İLK kez okunduğunda (yeniden çizim için)
 * @returns {DocumentFragment}
 */
export function buildTypeSelector({ selected, expanded, onChange, onPackagesLoaded }) {
  const frag = document.createDocumentFragment();

  const scopeLabel = document.createElement('div');
  scopeLabel.className = 'qa-scope-label';
  scopeLabel.textContent = 'Test kapsamı';
  frag.appendChild(scopeLabel);

  const presetRow = document.createElement('div');
  presetRow.className = 'qa-scope-row';
  TEST_TYPE_PRESETS.forEach((preset) => {
    const isActive = selected.size === preset.types.length && preset.types.every(t => selected.has(t));
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'qa-scope-pill qa-scope-preset' + (isActive ? ' active' : '');
    pill.textContent = preset.label;
    pill.title = 'Kapsar: ' + preset.types.map(t => TEST_TYPE_META[t].label).join(' · ');
    pill.onclick = () => onChange({ selected: new Set(preset.types), expanded: true });
    presetRow.appendChild(pill);
  });
  frag.appendChild(presetRow);

  // 10 tekil tür checkbox'ı bir preset'e tıklanana kadar HİÇ görünmüyor —
  // "hangi preset neyi kapsıyor" sorusunun cevabı burada, ama varsayılan
  // kapalı ("çok seçenek, kafa karıştırıyor" şikâyeti). Açıldıktan sonra tek
  // tek sapılabilir; o an hiçbir preset pili aktif görünmez.
  if (expanded) {
    const checklistLabel = document.createElement('div');
    checklistLabel.className = 'qa-scope-checklist-label';
    checklistLabel.textContent = 'Kapsanan türler — istersen tek tek değiştir';
    frag.appendChild(checklistLabel);
    const checklist = document.createElement('div');
    checklist.className = 'qa-scope-checklist';
    Object.keys(TEST_TYPE_META).forEach(key => {
      const row = document.createElement('label');
      row.className = 'qa-scope-check-row';
      row.title = TEST_TYPE_META[key].instruction;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(key);
      cb.onchange = () => {
        const next = new Set(selected);
        if (cb.checked) next.add(key); else next.delete(key);
        onChange({ selected: next, expanded: true });
      };
      const span = document.createElement('span');
      span.textContent = TEST_TYPE_META[key].label;
      row.append(cb, span);
      checklist.appendChild(row);
    });
    frag.appendChild(checklist);
  }

  /*
   * TÜR PAKETLERİ: isimlendirilmiş tür kombinasyonları (sidebar'daki case
   * koleksiyonu "Paketler" ile KARIŞTIRMA, bkz. js/packages.js). Liste
   * sunucudan, önbellekli; ilk okumada satır boş çizilir, okuma bitince
   * çağıran yeniden çizer — çizim ağ isteğine bekletilmez.
   */
  frag.appendChild(renderPackageRow({
    selected,
    meta: TEST_TYPE_META,
    onApply: (types) => onChange({ selected: new Set(types), expanded: true }),
    onChange: () => onChange({ selected: new Set(selected), expanded }),
  }));
  loadPackages().then((liste) => { if (liste && onPackagesLoaded) onPackagesLoaded(); });

  return frag;
}
