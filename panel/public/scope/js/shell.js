// Kabuk: sidebar (marka, ekle, görünüm anahtarı, kompakt durum özeti), ince üst bar
// (arama, facet, seç, diğer işlemler menüsü), tüm içeriğin orkestrasyonu, yedekleme.
import { state } from './state.js';
import { ICON, STATUS_META } from './constants.js';
import {
  computeStats, addChild, clearAll, findNode, persist,
  migrateTypes, migrateLinks, migrateJira, migrateJiraAnalyses, migrateNotes, migrateResourceLinks, migrateStatusMeta,
  migrateTestCases, migrateTestCaseSteps, fixIdCounter, dedupeEntityIds, treeHasProgress, computeSearchVisibleIds, FACET_META
} from './data.js';
import { renderAttentionView, attentionBadgeCount } from './attention-view.js';
import { renderNode } from './tree-view.js';
import { renderDiagram, applyDiagramZoom } from './diagram-view.js';
import { renderBoard } from './board-view.js';
import { renderDrawer, closeDrawer } from './drawer.js';
import { openSitemapImportModal } from './sitemap-import.js';
import { toggleSelectMode, buildBulkBar } from './bulk-actions.js';
import { openMenu } from './dropdown.js';
import { uiToast } from './dialog.js';
import { renderPackagesView } from './packages.js';
import { renderTestCasesView } from './testcases.js';
import { genStatus, onGenStatus, genSeen } from './gen-status.js';

let indicatorEl, toolsIndicatorEl, switchButtons = {}, selectBtnEl, attentionBadgeEl;
let genBadgeEl; // "Test Case'ler" öğesindeki üretim rozeti (bkz. gen-status.js)
let sidebarStatusEl, topbarFacetsEl, topbarSearchWrapEl, fileInputEl;

// "Dikkat" ve "Paketler" ağacın bir GÖRÜNÜMÜ değil, kendi kendine yeten ayrı
// sayfalar — arama/facet/durum özeti/toplu seçim ikisinde de anlamsız (bkz.
// updateTopbarVisibility, updateSidebarStatus, renderContent).
const AUX_VIEWS = new Set(['attention', 'packages', 'testcases']);

/** Sidebar'daki kompakt durum ozeti — eski buyuk kutucuklarin yerine, tek kolonda. */
function renderSidebarStatus() {
  const stats = computeStats(state.tree);
  const pctOk = stats.total ? (stats['✅'] / stats.total * 100) : 0;

  const wrap = document.createElement('div');
  wrap.className = 'fw-sb-status';

  ['✅', '🔵', '⚠️', '❌', '⬜'].forEach(key => {
    const meta = STATUS_META[key];
    const row = document.createElement('div');
    row.className = 'fw-sb-status-row';
    const dot = document.createElement('span');
    dot.className = 'fw-sb-status-dot';
    dot.style.setProperty('--tile-color', meta.colorVar);
    const label = document.createElement('span');
    label.className = 'fw-sb-status-label';
    label.append(dot, document.createTextNode(meta.label));
    const num = document.createElement('b');
    num.textContent = stats[key];
    row.append(label, num);
    wrap.appendChild(row);
  });

  const track = document.createElement('div');
  track.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  track.appendChild(fill);
  wrap.appendChild(track);
  void fill.offsetWidth;
  fill.style.width = pctOk + '%';

  const caption = document.createElement('div');
  caption.className = 'progress-caption';
  caption.textContent = `${stats['✅']}/${stats.total} tamamlandı · %${Math.round(pctOk)}`;
  wrap.appendChild(caption);

  return wrap;
}

/** İçerik değiştikçe (renderContent) sidebar'daki durum özetini yerinde günceller. */
function updateSidebarStatus() {
  if (!sidebarStatusEl) return;
  if (AUX_VIEWS.has(state.currentView)) { sidebarStatusEl.hidden = true; return; }
  sidebarStatusEl.hidden = false;
  sidebarStatusEl.replaceChildren(...renderSidebarStatus().childNodes);
}

/** Arama/facet/Seç, sadece Ağaç/Diyagram/Pano'da anlamlı — Dikkat kendi kategorilerini,
 *  Paketler kendi arama kutusunu kullanır; toplu seçim de yaprak düğüm gerektirir,
 *  ikisinde de seçilecek bir düğüm yok. Görünüm değişince ölü kontrolleri göstermemek
 *  için gizleniyorlar. */
function updateTopbarVisibility() {
  const hide = AUX_VIEWS.has(state.currentView);
  if (topbarSearchWrapEl) topbarSearchWrapEl.hidden = hide;
  if (topbarFacetsEl) topbarFacetsEl.hidden = hide;
  if (selectBtnEl) selectBtnEl.hidden = hide;
}

export function exportData() {
  const blob = new Blob([JSON.stringify(state.tree, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flowscope-yedek.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error('invalid backup shape');
      state.tree = parsed;
      // eski bir yedek olabilir: migration'ları savunmacı biçimde tekrar çalıştır
      migrateTypes(state.tree);
      migrateLinks(state.tree);
      migrateJira(state.tree);
      migrateJiraAnalyses(state.tree);
      migrateNotes(state.tree);
      migrateResourceLinks(state.tree);
      migrateStatusMeta(state.tree);
      migrateTestCases(state.tree);
      migrateTestCaseSteps(state.tree);
      fixIdCounter(state.tree);
      dedupeEntityIds(state.tree);
      persist();
      renderContent();
    } catch (e) {
      uiToast(`Geçersiz yedek dosyası: ${e?.message ?? 'JSON okunamadı'}`, { type: 'err', title: 'İçe aktarılamadı' });
    }
  };
  reader.readAsText(file);
}

/**
 * Sol sidebar — marka, birincil ekleme eylemi, görünüm anahtarı, kompakt durum özeti.
 * "Panele don" ve "Landing" dugmeleri burada YOK — yuzeyler arasi gecis ortak barda
 * (shared/nav/nav.js). Yeni bir hedef eklemek istersen buraya degil SURFACES'e ekle.
 */
function buildSidebar() {
  const sidebar = document.createElement('div');
  sidebar.className = 'fw-sidebar';

  const brand = document.createElement('div');
  brand.className = 'fw-sb-brand';
  brand.innerHTML = `<div class="fw-logo">${ICON.logo}</div><span class="fw-sb-brand-text">Flowscope</span>`;
  sidebar.appendChild(brand);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'fw-sb-add';
  addBtn.innerHTML = ICON.plus + '<span>Yeni modül</span>';
  addBtn.title = 'Ağaca yeni bir kök modül ekler — her görünümde görünür';
  addBtn.onclick = () => addChild(null);
  sidebar.appendChild(addBtn);

  // Ayrı bir GRUP: ileride "Test Paketleri" gibi başka bir grup eklenince aynı
  // etiket + liste deseni tekrarlanır, düz/etiketsiz bir liste yerine.
  const group = document.createElement('div');
  group.className = 'fw-sb-group';
  const groupLabel = document.createElement('div');
  groupLabel.className = 'fw-sb-group-label';
  groupLabel.textContent = 'Görünüm';
  group.appendChild(groupLabel);

  const nav = document.createElement('nav');
  nav.className = 'fw-sb-nav';
  indicatorEl = document.createElement('div');
  indicatorEl.className = 'fw-sb-indicator';
  nav.appendChild(indicatorEl);

  const VIEWS = [
    { key: 'tree', label: 'Ağaç', icon: ICON.viewTree },
    { key: 'diagram', label: 'Diyagram', icon: ICON.viewDiagram },
    { key: 'board', label: 'Pano', icon: ICON.viewBoard },
    { key: 'attention', label: 'Dikkat', icon: ICON.statusWarn },
  ];
  switchButtons = {};
  VIEWS.forEach(v => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = state.currentView === v.key;
    btn.className = isActive ? 'active' : '';
    if (isActive) btn.setAttribute('aria-current', 'true');
    btn.title = v.label;
    btn.innerHTML = v.icon + `<span>${v.label}</span>`;
    if (v.key === 'attention') {
      attentionBadgeEl = document.createElement('span');
      attentionBadgeEl.className = 'vs-badge';
      btn.appendChild(attentionBadgeEl);
    }
    btn.onclick = () => setView(v.key);
    nav.appendChild(btn);
    switchButtons[v.key] = btn;
  });
  group.appendChild(nav);
  sidebar.appendChild(group);
  refreshAttentionBadge();

  // İkinci grup: ağacın bir GÖRÜNÜMÜ olmayan, kendi başına sayfalar. "Test
  // Case'ler" henüz İÇİ BOŞ (bkz. testcases.js) — sidebar'da yeri bilerek
  // şimdiden ayrıldı, tasarımı ayrı bir turda yapılacak. İki öğeli bir grup
  // olduğu için kayan vurgu çubuğunu hak ediyor artık (Görünüm grubuyla aynı desen).
  const toolsGroup = document.createElement('div');
  toolsGroup.className = 'fw-sb-group';
  const toolsLabel = document.createElement('div');
  toolsLabel.className = 'fw-sb-group-label';
  toolsLabel.textContent = 'Test Suite';
  toolsGroup.appendChild(toolsLabel);

  const toolsNav = document.createElement('nav');
  toolsNav.className = 'fw-sb-nav';
  toolsIndicatorEl = document.createElement('div');
  toolsIndicatorEl.className = 'fw-sb-indicator';
  toolsNav.appendChild(toolsIndicatorEl);

  const TOOLS = [
    { key: 'packages', label: 'Paketler', icon: ICON.package },
    { key: 'testcases', label: "Test Case'ler", icon: ICON.typeStep },
  ];
  TOOLS.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = state.currentView === t.key;
    btn.className = isActive ? 'active' : '';
    if (isActive) btn.setAttribute('aria-current', 'true');
    btn.title = t.label;
    btn.innerHTML = t.icon + `<span>${t.label}</span>`;
    if (t.key === 'testcases') {
      // Üretim rozeti: sürerken nabız, bitince yeşil "üretildi". Sidebar
      // yeniden kurulunca eleman da yeniden kurulur; durum modülde kalır.
      genBadgeEl = document.createElement('span');
      genBadgeEl.className = 'fw-gen-badge';
      genBadgeEl.hidden = true;
      btn.appendChild(genBadgeEl);
    }
    btn.onclick = () => setView(t.key);
    toolsNav.appendChild(btn);
    switchButtons[t.key] = btn;
  });
  toolsGroup.appendChild(toolsNav);
  renderGenBadge(genStatus);
  sidebar.appendChild(toolsGroup);

  sidebarStatusEl = document.createElement('div');
  sidebarStatusEl.className = 'fw-sb-status';
  sidebar.appendChild(sidebarStatusEl);

  return sidebar;
}

/** İnce üst bar — arama + facet (Dikkat'te gizli) + seç + "diğer işlemler" menüsü. */
function buildTopbar() {
  const topbar = document.createElement('div');
  topbar.className = 'fw-topbar';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-box';
  searchWrap.innerHTML = ICON.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Ara...';
  searchInput.value = state.searchQuery;
  searchInput.oninput = (e) => { state.searchQuery = e.target.value; renderContent(); };
  searchWrap.appendChild(searchInput);
  topbar.appendChild(searchWrap);
  topbarSearchWrapEl = searchWrap;

  const facetRow = document.createElement('div');
  facetRow.className = 'facet-row';
  Object.keys(FACET_META).forEach(key => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'facet-pill' + (state.activeFacets.has(key) ? ' active' : '');
    pill.textContent = FACET_META[key].label;
    pill.onclick = () => {
      if (state.activeFacets.has(key)) state.activeFacets.delete(key); else state.activeFacets.add(key);
      pill.classList.toggle('active');
      renderContent();
    };
    facetRow.appendChild(pill);
  });
  topbar.appendChild(facetRow);
  topbarFacetsEl = facetRow;

  const spacer = document.createElement('div');
  spacer.style.marginLeft = 'auto';
  topbar.appendChild(spacer);

  selectBtnEl = document.createElement('button');
  selectBtnEl.type = 'button';
  selectBtnEl.className = 'btn' + (state.selectMode ? ' btn-primary' : '');
  selectBtnEl.innerHTML = ICON.checkSquare + '<span>Seç</span>';
  selectBtnEl.title = 'Toplu durum güncelleme için öğe seç';
  selectBtnEl.onclick = toggleSelectMode;
  topbar.appendChild(selectBtnEl);

  // "Yedek indir / İçe aktar / URL'den İçe Aktar / Temizle" — günlük kullanılmayan
  // bakım eylemleri; hepsi tek bir "Diğer işlemler" menüsünde (bkz. dropdown.js).
  // Gizli dosya input'u DOM'da kalıcı duruyor, menü her açılışta yeniden kurulmuyor.
  fileInputEl = document.createElement('input');
  fileInputEl.type = 'file';
  fileInputEl.accept = 'application/json';
  fileInputEl.style.display = 'none';
  fileInputEl.onchange = () => {
    if (fileInputEl.files[0]) importData(fileInputEl.files[0]);
    fileInputEl.value = '';
  };
  topbar.appendChild(fileInputEl);

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'btn';
  moreBtn.innerHTML = ICON.more;
  moreBtn.title = 'Diğer işlemler';
  moreBtn.onclick = () => openMenu(moreBtn, [
    { value: 'export', label: 'Yedek indir', icon: ICON.download },
    { value: 'import', label: 'İçe aktar', icon: ICON.upload },
    { value: 'sitemap', label: 'URL’den İçe Aktar', icon: ICON.globe },
    { value: 'clear', label: 'Temizle', icon: ICON.trash, danger: true },
  ], null, (value) => {
    if (value === 'export') exportData();
    else if (value === 'import') fileInputEl.click();
    else if (value === 'sitemap') openSitemapImportModal();
    else if (value === 'clear') clearAll();
  });
  topbar.appendChild(moreBtn);

  /*
   * `/scope#import` ile dogrudan ice aktarma kutusu acilir. Baglantilar
   * panelindeki "Oturum aç" kurtarmasi buraya yonlendiriyor: oturum ancak
   * gorunur bir pencerede insan giris yaparak aciliyor, o akis burada.
   */
  openImportFromHash();

  return topbar;
}

/** "Dikkat" sekmesindeki sayı rozeti — taranmış her şeyin toplamı (bkz. attention-view.js). */
export function refreshAttentionBadge() {
  if (!attentionBadgeEl) return;
  const n = attentionBadgeCount();
  attentionBadgeEl.textContent = n || '';
  attentionBadgeEl.hidden = !n;
}

/**
 * Üretim rozeti (sidebar → "Test Case'ler"):
 *   sürüyor  → nabız atan nokta, "N üretim sürüyor"
 *   bitti    → yeşil onay + yazılan case sayısı; görünüme girilince söner
 * Kullanıcı zaten Test Case'ler sayfasındayken biten üretim rozet bırakmaz —
 * liste gözünün önünde tazelendi, ayrıca "bak" demek gürültü olurdu.
 */
function renderGenBadge(st) {
  if (!genBadgeEl) return;
  if (!st.running && st.unseenRuns && state.currentView === 'testcases') { genSeen(); return; }
  if (st.running) {
    genBadgeEl.className = 'fw-gen-badge running';
    genBadgeEl.innerHTML = '<i></i>';
    genBadgeEl.title = st.running > 1 ? `${st.running} test case üretimi sürüyor…` : 'Test case üretiliyor…';
    genBadgeEl.hidden = false;
  } else if (st.unseenRuns) {
    genBadgeEl.className = 'fw-gen-badge done';
    genBadgeEl.innerHTML = ICON.check + (st.unseen ? `<span>${st.unseen}</span>` : '');
    genBadgeEl.title = st.unseen
      ? `${st.unseen} yeni case üretildi — görmek için tıkla`
      : 'Üretim bitti (yeni case yok: hepsi tekrar diye atlandı)';
    genBadgeEl.hidden = false;
  } else {
    genBadgeEl.hidden = true;
    genBadgeEl.title = '';
  }
}
onGenStatus(renderGenBadge);

export function positionIndicator() {
  const btn = switchButtons[state.currentView];
  // İki grup, iki bağımsız vurgu çubuğu — aktif düğüme sahip OLMAYAN grubun
  // çubuğu sıfır yüksekliğe çekilip gizleniyor (ör. Paketler aktifken Görünüm
  // grubunda gösterilecek bir şey yok).
  [indicatorEl, toolsIndicatorEl].forEach((el) => {
    if (!el) return;
    if (!btn || !el.parentElement.contains(btn)) { el.style.height = '0px'; return; }
    el.style.top = btn.offsetTop + 'px';
    el.style.height = btn.offsetHeight + 'px';
  });
}

export function setView(key) {
  state.currentView = key;
  if (key === 'testcases') genSeen();   // rozet "bakıldı" — bildirim deseni
  Object.entries(switchButtons).forEach(([k, btn]) => {
    const isActive = k === key;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
  });
  positionIndicator();
  updateTopbarVisibility();
  renderContent();
}

export function renderContent() {
  if (selectBtnEl) selectBtnEl.classList.toggle('btn-primary', state.selectMode);
  updateSidebarStatus();

  const scrollX = window.scrollX, scrollY = window.scrollY;
  const oldScrollable = state.root.querySelector('.diagram-scroll, .board');
  const innerScroll = oldScrollable ? { left: oldScrollable.scrollLeft, top: oldScrollable.scrollTop } : null;

  const old = state.root.querySelector('.fw-content');
  const fresh = document.createElement('div');
  fresh.className = 'fw-content';

  // "Dikkat"/"Paketler" toplu seçim çubuğunu paylaşmaz — ikisi de kendi kendine
  // yeten ayrı sayfalar (bkz. attention-view.js, packages.js).
  if (!AUX_VIEWS.has(state.currentView) && state.selectMode) {
    fresh.appendChild(buildBulkBar());
  }

  const q = state.searchQuery.trim().toLowerCase();
  const hasFilter = q || state.activeFacets.size;
  const visibleIds = hasFilter ? computeSearchVisibleIds(state.tree, q, state.activeFacets) : null;

  if (state.currentView === 'attention') {
    fresh.appendChild(renderAttentionView(renderContent));
  } else if (state.currentView === 'packages') {
    fresh.appendChild(renderPackagesView());
  } else if (state.currentView === 'testcases') {
    fresh.appendChild(renderTestCasesView());
  } else if (state.currentView === 'diagram') {
    fresh.appendChild(renderDiagram(visibleIds));
  } else if (state.currentView === 'board') {
    fresh.appendChild(renderBoard(visibleIds));
  } else if (!state.tree.length) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Henüz modül eklenmedi. Başlamak için "+ Yeni modül" butonuna tıkla.';
    fresh.appendChild(empty);
  } else if (visibleIds && !visibleIds.size) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Arama/filtreyle eşleşen öğe bulunamadı.';
    fresh.appendChild(empty);
  } else {
    const treeContainer = document.createElement('div');
    if (treeHasProgress(state.tree)) treeContainer.classList.add('tree-has-progress');
    state.tree.forEach(n => treeContainer.appendChild(renderNode(n, true, visibleIds)));
    fresh.appendChild(treeContainer);
  }

  if (old) old.replaceWith(fresh); else state.root.querySelector('.fw-main').appendChild(fresh);
  refreshAttentionBadge();

  if (state.drawerNode) {
    if (findNode(state.tree, state.drawerNode.id)) renderDrawer();
    else closeDrawer();
  }

  const applyScroll = () => {
    window.scrollTo(scrollX, scrollY);
    if (innerScroll) {
      const ns = state.root.querySelector('.diagram-scroll, .board');
      if (ns) { ns.scrollLeft = innerScroll.left; ns.scrollTop = innerScroll.top; }
    }
    if (state.currentView === 'diagram') applyDiagramZoom();
  };
  applyScroll();
  requestAnimationFrame(applyScroll);
  setTimeout(applyScroll, 0);
}

export function init() {
  state.root.innerHTML = '';
  state.root.appendChild(buildSidebar());
  const main = document.createElement('div');
  main.className = 'fw-main';
  main.appendChild(buildTopbar());
  state.root.appendChild(main);
  requestAnimationFrame(positionIndicator);
  window.addEventListener('resize', positionIndicator);
  updateTopbarVisibility();
  renderContent();
}

/**
 * `/scope#import` → içe aktarma kutusu boş açılır (eski davranış).
 * `/scope#import&url=<enc>` → kutu o adresle dolu açılır ve tarama HEMEN başlar
 *   (landing'deki "URL'i gir, başla" kutusu). `&auto=0` eklenirse başlatmaz, formu gösterir.
 *
 * Hash okunur okunmaz temizlenir: sayfa yenilendiğinde ya da geri/ileri ile
 * dönüldüğünde ikinci bir tarama başlamasın. Adres güvenilmez girdidir;
 * sitemap-import.js yalnızca http/https kabul eder, gerisi düz forma düşer.
 */
function openImportFromHash() {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)import(&|$)/.test(h)) return;
  const params = new URLSearchParams(h.split('&').filter(x => x !== 'import').join('&'));
  const url = params.get('url') || '';
  const auto = params.get('auto') !== '0';
  history.replaceState(null, '', location.pathname + location.search);
  openSitemapImportModal(url ? { url, autoStart: auto } : undefined);
}
