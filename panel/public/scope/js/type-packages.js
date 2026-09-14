/*
 * TÜR PAKETLERİ — isimlendirilmiş test türü kombinasyonları (istemci).
 *
 * ⚠️ Sidebar'daki "Paketler" (js/packages.js) BAŞKA bir şey: o, var olan test
 * case'lerinin koşulabilir koleksiyonu. Bu dosya case ÜRETİLİRKEN seçilen
 * türlerin kombinasyonu. Aynı ekranda ikisi de "paket" dediği için etiketler
 * ayrıldı: burada "TÜR PAKETLERİ" / "+ tür paketi".
 *
 * Drawer'daki tür seçicisi (Happy Path · Negatif · Sınır Değerler · …) her
 * düğümde sıfırdan seçiliyordu. Aynı kombinasyonu ("regresyon için şu üçü")
 * onlarca düğümde elden kurmak, kullanıcının en çok tekrar eden işiydi.
 * Paket = o kombinasyonun bir ismi; tek tıkla uygulanır.
 *
 * Depo sunucuda (`panel-data/type-packages.json`, bkz. panel/type-packages.mjs);
 * localStorage DEĞİL — paket, panele giren herkes için aynı olmalı ve tarayıcı
 * profiline hapsolmamalı (Flowscope'un eski localStorage kalıcılığının
 * bıraktığı dersin aynısı).
 */
import { uiToast, uiConfirm, uiPrompt } from './dialog.js';

let PAKETLER = null;   // null = henüz okunmadı (boş liste ile karıştırma)

function headers() {
  return { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' };
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
}

/** Listeyi okur (önbellekli). `force` ile tazeler. */
export async function loadPackages(force = false) {
  if (PAKETLER && !force) return PAKETLER;
  try {
    const d = await (await fetch('/api/type-packages')).json();
    PAKETLER = d.ok ? (d.packages ?? []) : [];
  } catch {
    PAKETLER = [];   // sunucuya ulaşılamadı: paket yok, tür seçici çalışmaya devam eder
  }
  return PAKETLER;
}

/**
 * Paket satırını kurar.
 *
 * @param {object} p
 * @param {Set<string>} p.selected        o an seçili tür anahtarları
 * @param {Record<string,object>} p.meta  tür sözlüğü (bilinmeyen tür elenir)
 * @param {(types: string[]) => void} p.onApply  paket uygulanınca
 * @param {() => void} p.onChange         liste değişince (yeniden çiz)
 */
export function renderPackageRow({ selected, meta, onApply, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'qa-tpkg-row';

  const etiket = document.createElement('span');
  etiket.className = 'qa-tpkg-label';
  etiket.textContent = 'Tür paketleri';
  wrap.appendChild(etiket);

  const liste = document.createElement('span');
  liste.className = 'qa-tpkg-list';
  wrap.appendChild(liste);

  const ciz = () => {
    liste.innerHTML = '';
    const paketler = PAKETLER ?? [];
    if (!paketler.length) {
      const bos = document.createElement('span');
      bos.className = 'qa-tpkg-empty';
      bos.textContent = 'henüz tür paketi yok — türleri seçip "+ tür paketi" de';
      liste.appendChild(bos);
    }
    for (const paket of paketler) {
      /*
       * Paketteki türlerden kaçı BUGÜN hâlâ tanımlı: tür listesi kodda
       * değişebilir, eski paket yüzünden hata vermek yerine bilinmeyeni
       * sessizce eliyoruz ve rozete gerçek sayıyı yazıyoruz.
       */
      const gecerli = paket.types.filter(t => meta[t]);
      const aktif = gecerli.length && gecerli.every(t => selected.has(t)) && selected.size === gecerli.length;

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'qa-scope-pill qa-tpkg-pill' + (aktif ? ' active' : '');
      pill.textContent = `${paket.label} · ${gecerli.length}`;
      pill.title = gecerli.map(t => meta[t].label).join(' · ')
        + (gecerli.length < paket.types.length ? `\n(${paket.types.length - gecerli.length} tür artık tanımlı değil, atlanıyor)` : '')
        + '\nTıkla: bu türleri seç';
      pill.onclick = () => {
        if (!gecerli.length) { uiToast('Bu paketteki türlerin hiçbiri artık tanımlı değil.', { type: 'err' }); return; }
        onApply(gecerli);
      };
      liste.appendChild(pill);

      const sil = document.createElement('button');
      sil.type = 'button';
      sil.className = 'qa-tpkg-x';
      sil.textContent = '×';
      sil.title = `"${paket.label}" tür paketini sil`;
      sil.onclick = async () => {
        if (!await uiConfirm(`"${paket.label}" tür paketi silinsin mi?`, { title: 'Tür paketini sil', ok: 'Sil', danger: true })) return;
        const d = await post('/api/type-packages/delete', { id: paket.id });
        if (!d.ok) { uiToast(d.error || 'Silinemedi.', { type: 'err' }); return; }
        PAKETLER = d.packages ?? [];
        onChange();
      };
      liste.appendChild(sil);
    }
  };
  ciz();

  const kaydet = document.createElement('button');
  kaydet.type = 'button';
  kaydet.className = 'qa-tpkg-save';
  kaydet.textContent = '+ tür paketi';
  kaydet.disabled = selected.size === 0;
  kaydet.title = selected.size === 0
    ? 'Önce en az bir test türü seç'
    : `Seçili ${selected.size} türü bir isimle kaydet, sonra tek tıkla uygula`;
  kaydet.onclick = async () => {
    const ad = await uiPrompt('Tür paketi adı (ör. "Regresyon", "Yeni sayfa", "Form sayfası")', {
      title: 'Tür paketi kaydet', ok: 'Kaydet',
    });
    if (!ad) return;
    const d = await post('/api/type-packages', { label: ad, types: [...selected] });
    if (!d.ok) { uiToast(d.error || 'Kaydedilemedi.', { type: 'err', title: 'Paket kaydedilemedi' }); return; }
    PAKETLER = d.packages ?? [];
    uiToast(`"${d.package.label}" tür paketi kaydedildi (${d.package.types.length} tür).`, { type: 'ok' });
    onChange();
  };
  wrap.appendChild(kaydet);

  return wrap;
}
