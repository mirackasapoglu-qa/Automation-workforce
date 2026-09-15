// Test Repository — Xray'deki aynı isimli kavrama benzeyen tek liste: ağaçtaki
// BÜTÜN test case'ler, hangi sayfaya bağlı olursa olsun ve hangi pakette olursa
// olsun burada görünür.
//
// NEDEN AYRI SAYFA: case'ler bugüne kadar yalnızca ait oldukları düğümün
// drawer'ında görülebiliyordu. 101 düğümlük bir ağaçta "nerede case var, hangisi
// hiç koşulmadı, hangisi hiçbir pakette değil" sorusunun cevabı yoktu —
// düğüm düğüm gezmek gerekiyordu.
//
// Veri ağaçtan ve paket listesinden OKUNUR, burada hiçbir şey yazılmaz; tek
// yazma yolu pakete ekleme ve o da packages-data.js üzerinden (tek yazma kapısı).
import { state } from './state.js';
import { ICON, STATUS_META } from './constants.js';
import { effectiveTestCaseStatus, findNode } from './data.js';
import { allTestCases, collectEffectiveTestCaseItems, dedupeTestCaseItems } from './packages-data.js';
import { openDrawer, renderDrawer } from './drawer.js';
import { renderContent } from './shell.js';

/** Sayfa içi (kalıcı olmayan) süzgeç durumu — sekme değişince sıfırlanmasın. */
const filtre = { q: '', durum: 'hepsi', kapsam: 'hepsi' };

/**
 * case anahtarı → içinde bulunduğu paketler.
 * Paketler iç içe olabildiği için DOĞRUDAN değil ETKİN içerik sayılır
 * (`collectEffectiveTestCaseItems`): bir case, alt pakete eklendiyse üst paketin
 * de içindedir; burada "hiçbir pakette değil" demek yanlış olurdu.
 */
function paketDizini() {
  const idx = new Map();
  for (const pkg of state.packages ?? []) {
    for (const it of dedupeTestCaseItems(collectEffectiveTestCaseItems(pkg))) {
      const key = `${it.nodeId}::${it.testCaseId}`;
      if (!idx.has(key)) idx.set(key, []);
      if (!idx.get(key).some((p) => p.id === pkg.id)) idx.get(key).push({ id: pkg.id, name: pkg.name });
    }
  }
  return idx;
}

function sonKosum(tc) {
  const r = (tc.runs ?? []).at(-1);
  if (!r) return null;
  const t = new Date(r.at);
  return { status: r.status, not: (r.note ?? '').split('\n')[0], ne: Number.isNaN(+t) ? '' : t.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) };
}

function eslesiyor(kayit) {
  const q = filtre.q.trim().toLowerCase();
  if (q) {
    const havuz = `${kayit.testCase.title} ${kayit.nodeName} ${kayit.paketler.map((p) => p.name).join(' ')}`.toLowerCase();
    if (!havuz.includes(q)) return false;
  }
  if (filtre.durum !== 'hepsi' && effectiveTestCaseStatus(kayit.testCase) !== filtre.durum) return false;
  if (filtre.kapsam === 'paketsiz' && kayit.paketler.length) return false;
  if (filtre.kapsam === 'kosulmamis' && (kayit.testCase.runs ?? []).length) return false;
  if (filtre.kapsam === 'otomatik' && !kayit.testCase.automated) return false;
  if (filtre.kapsam === 'elle' && kayit.testCase.automated) return false;
  return true;
}

export function renderTestCasesView() {
  const wrap = document.createElement('div');
  wrap.className = 'pkg-list-page';

  const idx = paketDizini();
  const hepsi = allTestCases(state.tree).map((x) => ({
    ...x,
    paketler: idx.get(`${x.nodeId}::${x.testCase.id}`) ?? [],
  }));

  // ---- baslik + sayaclar
  const header = document.createElement('div');
  header.className = 'pkg-page-header';
  const h2 = document.createElement('h2');
  h2.textContent = "Test Repository";
  const p = document.createElement('p');
  const kosulmus = hepsi.filter((x) => (x.testCase.runs ?? []).length).length;
  const paketsiz = hepsi.filter((x) => !x.paketler.length).length;
  p.textContent = hepsi.length
    ? `Kapsamdaki ${hepsi.length} case · ${kosulmus} koşuldu · ${paketsiz} hiçbir pakette değil · ${(state.packages ?? []).length} paket`
    : 'Kapsam ağacında henüz test case yok.';
  header.append(h2, p);
  wrap.appendChild(header);

  if (!hepsi.length) {
    const bos = document.createElement('div');
    bos.className = 'board-col-empty';
    bos.textContent = 'Bir düğüm seçip "Test Case Üret" ile başlayabilirsin.';
    wrap.appendChild(bos);
    return wrap;
  }

  // ---- arama + suzgecler
  const bar = document.createElement('div');
  bar.className = 'tc-bar';

  const ara = document.createElement('input');
  ara.type = 'search';
  ara.className = 'pkg-create-input tc-search';
  ara.placeholder = 'Case, sayfa ya da paket adı ara...';
  ara.value = filtre.q;
  // Yeniden çizim odağı kaybetmesin: değer state'te, odak ve imleç geri konuyor.
  ara.addEventListener('input', () => {
    filtre.q = ara.value;
    const konum = ara.selectionStart;
    renderContent();
    const yeni = document.querySelector('.tc-search');
    if (yeni) { yeni.focus(); try { yeni.setSelectionRange(konum, konum); } catch { /* search alaninda desteklenmeyebilir */ } }
  });
  bar.appendChild(ara);

  const grup = (mevcut, secenekler, uygula) => {
    const kutu = document.createElement('div');
    kutu.className = 'tc-pills';
    for (const [deger, etiket] of secenekler) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'facet-pill' + (mevcut === deger ? ' active' : '');
      b.textContent = etiket;
      b.onclick = () => { uygula(deger); renderContent(); };
      kutu.appendChild(b);
    }
    return kutu;
  };

  bar.appendChild(grup(filtre.durum, [
    ['hepsi', 'Tüm durumlar'], ['⬜', 'Bekliyor'], ['✅', 'Geçti'], ['⚠️', 'Uyarılı'], ['❌', 'Hatalı'],
  ], (v) => { filtre.durum = v; }));

  bar.appendChild(grup(filtre.kapsam, [
    ['hepsi', 'Tümü'], ['paketsiz', 'Pakette değil'], ['kosulmamis', 'Hiç koşulmamış'],
    ['otomatik', 'Otomatik'], ['elle', 'Elle'],
  ], (v) => { filtre.kapsam = v; }));

  wrap.appendChild(bar);

  // ---- liste
  const gorunen = hepsi.filter(eslesiyor);
  const sayac = document.createElement('div');
  sayac.className = 'tc-count';
  sayac.textContent = `${gorunen.length}/${hepsi.length} case`;
  wrap.appendChild(sayac);

  if (!gorunen.length) {
    const bos = document.createElement('div');
    bos.className = 'board-col-empty';
    bos.textContent = 'Süzgece uyan case yok.';
    wrap.appendChild(bos);
    return wrap;
  }

  const liste = document.createElement('div');
  liste.className = 'tc-list';
  for (const kayit of gorunen) liste.appendChild(satir(kayit));
  wrap.appendChild(liste);

  return wrap;
}

function satir(kayit) {
  const { nodeId, nodeName, testCase, paketler } = kayit;
  const row = document.createElement('div');
  row.className = 'pkg-item-row tc-row';

  const durum = effectiveTestCaseStatus(testCase);
  const dot = document.createElement('span');
  dot.className = 'pkg-item-status';
  dot.style.setProperty('--tile-color', (STATUS_META[durum] || STATUS_META['⬜']).colorVar);
  dot.title = (STATUS_META[durum] || {}).label || durum;
  row.appendChild(dot);

  // Gövde: tıklayınca case'in AİT OLDUĞU DÜĞÜMÜN drawer'ı açılır — case'i
  // duzenlemenin tek yeri orasi, burada ikinci bir duzenleme yuzeyi acmiyoruz.
  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'pkg-item-body pkg-item-jump';
  const baslik = document.createElement('div');
  baslik.className = 'pkg-item-title';
  baslik.textContent = testCase.title || '(isimsiz case)';
  const meta = document.createElement('div');
  meta.className = 'pkg-item-meta';
  const kosum = sonKosum(testCase);
  meta.textContent = [
    nodeName,
    `${(testCase.steps ?? []).length} adım`,
    testCase.automated ? 'otomatik' : null,
    testCase.draft ? 'taslak' : null,
    kosum ? `son koşum ${kosum.status} ${kosum.ne}` : 'hiç koşulmadı',
  ].filter(Boolean).join(' · ');
  body.append(baslik, meta);
  body.title = kosum?.not ? `${nodeName}\n${kosum.not}` : nodeName;
  body.onclick = () => {
    const node = findNode(state.tree, nodeId);
    if (!node) return;
    // ⚠️ SIRA: openDrawer sekmeyi 'genel'e SIFIRLIYOR — sekme ondan SONRA
    // secilmeli, yoksa kullanici case listesinden geldigi halde Genel sekmesine
    // dusuyor (olculdu).
    openDrawer(node);
    state.drawerTab = 'testcase';
    renderDrawer();
  };
  row.appendChild(body);

  // Paket rozetleri — bos ise bu da bir sinyal ("pakette degil").
  const sag = document.createElement('div');
  sag.className = 'tc-packages';
  if (paketler.length) {
    for (const pkg of paketler.slice(0, 3)) {
      const chip = document.createElement('span');
      chip.className = 'tc-pkg-chip';
      chip.innerHTML = ICON.package;
      chip.append(document.createTextNode(pkg.name));
      chip.title = `"${pkg.name}" paketinde`;
      sag.appendChild(chip);
    }
    if (paketler.length > 3) {
      const fazla = document.createElement('span');
      fazla.className = 'tc-pkg-more';
      fazla.textContent = `+${paketler.length - 3}`;
      sag.appendChild(fazla);
    }
  } else {
    const yok = document.createElement('span');
    yok.className = 'tc-pkg-none';
    yok.textContent = 'pakette değil';
    sag.appendChild(yok);
  }
  row.appendChild(sag);

  return row;
}
