// Kabuk: başlık, toolbar, görünüm anahtarı, ilerleme paneli, tüm içeriğin orkestrasyonu,
// ve yedekleme (JSON dışa/içe aktarım).
import { state } from './state.js';
import { ICON, STATUS_META } from './constants.js';
import {
  computeStats, addChild, clearAll, findNode, persist,
  migrateTypes, migrateLinks, migrateJira, migrateJiraAnalyses, migrateNotes, migrateResourceLinks, migrateStatusMeta,
  migrateTestCases, migrateTestCaseSteps, fixIdCounter, dedupeEntityIds, treeHasProgress, computeSearchVisibleIds, FACET_META
} from './data.js';
import { openAttentionPanel } from './attention-panel.js';
import { renderNode } from './tree-view.js';
import { renderDiagram, applyDiagramZoom } from './diagram-view.js';
import { renderBoard } from './board-view.js';
import { renderDrawer, closeDrawer } from './drawer.js';
import { openSitemapImportModal } from './sitemap-import.js';
import { toggleSelectMode, buildBulkBar } from './bulk-actions.js';

let indicatorEl, switchButtons = {}, selectBtnEl;

export function renderProgress() {
  const stats = computeStats(state.tree);
  const pctOk = stats.total ? (stats['✅'] / stats.total * 100) : 0;

  const wrap = document.createElement('div');
  wrap.className = 'fw-progress';

  const tiles = document.createElement('div');
  tiles.className = 'stat-tiles';
  [
    { key: '✅', cls: 'ok' }, { key: '⚠️', cls: 'warn' }, { key: '❌', cls: 'fail' }, { key: '⬜', cls: 'todo' }, { key: '🔵', cls: 'progress' }
  ].forEach(d => {
    const meta = STATUS_META[d.key];
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    tile.style.setProperty('--tile-color', meta.colorVar);
    tile.innerHTML = meta.icon + `<div class="stat-num">${stats[d.key]}</div><div class="stat-label">${meta.label}</div>`;
    tiles.appendChild(tile);
  });
  wrap.appendChild(tiles);

  const track = document.createElement('div');
  track.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  track.appendChild(fill);
  wrap.appendChild(track);
  void fill.offsetWidth; // senkron reflow zorla ki genişlik geçişi 0'dan gerçekten oynasın
  fill.style.width = pctOk + '%';

  const caption = document.createElement('div');
  caption.className = 'progress-caption';
  caption.textContent = `${stats['✅']}/${stats.total} tamamlandı · %${Math.round(pctOk)}`;
  wrap.appendChild(caption);

  return wrap;
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
      alert('Geçersiz yedek dosyası.');
    }
  };
  reader.readAsText(file);
}

export function buildHeader() {
  const header = document.createElement('div');
  header.className = 'fw-header';
  header.innerHTML = `
    <div class="fw-logo">${ICON.logo}</div>
    <div>
      <div class="fw-title">Flowscope</div>
      <div class="fw-subtitle">Proje bileşenlerini haritalayın, test durumunu izleyin</div>
    </div>`;
  return header;
}

export function buildToolbar() {
  const toolbar = document.createElement('div');
  toolbar.className = 'fw-toolbar';

  const left = document.createElement('div');
  left.className = 'toolbar-left';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary';
  addBtn.innerHTML = ICON.plus + '<span>Yeni modül</span>';
  addBtn.onclick = () => addChild(null);
  left.appendChild(addBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn';
  saveBtn.innerHTML = ICON.download + '<span>Yedek indir</span>';
  saveBtn.onclick = exportData;
  left.appendChild(saveBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.style.display = 'none';
  fileInput.onchange = () => {
    if (fileInput.files[0]) importData(fileInput.files[0]);
    fileInput.value = '';
  };
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn';
  importBtn.innerHTML = ICON.upload + '<span>İçe aktar</span>';
  importBtn.onclick = () => fileInput.click();
  left.appendChild(importBtn);
  left.appendChild(fileInput);

  /* "Dokümanlara Aktar" KALDIRILDI.
   *
   * Amacı, localStorage'daki ağacı agent'ların okuyabileceği bir dosyaya
   * dökmekti — elle tetiklenen tek yönlü bir anlık görüntü. Ağaç artık zaten
   * diskte (panel-data/scope/tree.json) ve her değişiklikte yazılıyor;
   * buton bugün yalnızca "bayat kopya" üretme riski taşırdı. */

  const sitemapBtn = document.createElement('button');
  sitemapBtn.type = 'button';
  sitemapBtn.className = 'btn';
  sitemapBtn.innerHTML = ICON.globe + '<span>URL’den İçe Aktar</span>';
  /* Crawler (crawler.py) henüz panele bağlanmadı — Faz 2. Butonu gizlemek
   * yerine ne olduğunu SÖYLÜYORUZ: sessizce çalışmayan buton, hata veren
   * butondan daha kötü. */
  sitemapBtn.title = 'Henüz bağlı değil (Faz 2): tarayıcı crawler paneldeki koşum motoruna taşınacak';
  sitemapBtn.onclick = () => alert(
    'URL’den içe aktarma henüz bağlı değil.\n\n' +
    'Tarayıcı tabanlı crawler panelin koşum motoruna taşınınca (Faz 2) burada çalışacak. ' +
    'Şimdilik ağaç, proje profilindeki rota haritasından tohumlanıyor.');
  left.appendChild(sitemapBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn btn-danger';
  clearBtn.innerHTML = ICON.trash + '<span>Temizle</span>';
  clearBtn.onclick = clearAll;
  left.appendChild(clearBtn);

  selectBtnEl = document.createElement('button');
  selectBtnEl.type = 'button';
  selectBtnEl.className = 'btn' + (state.selectMode ? ' btn-primary' : '');
  selectBtnEl.innerHTML = ICON.checkSquare + '<span>Seç</span>';
  selectBtnEl.title = 'Toplu durum güncelleme için öğe seç';
  selectBtnEl.onclick = toggleSelectMode;
  left.appendChild(selectBtnEl);

  const attentionBtn = document.createElement('button');
  attentionBtn.type = 'button';
  attentionBtn.className = 'btn';
  attentionBtn.innerHTML = ICON.statusWarn + '<span>Bayat/Bekleyen Test Case\'ler</span>';
  attentionBtn.title = 'Hiç koşulmamış veya uzun süredir yeniden doğrulanmamış test case\'leri tek listede göster';
  attentionBtn.onclick = openAttentionPanel;
  left.appendChild(attentionBtn);

  toolbar.appendChild(left);

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
  toolbar.appendChild(searchWrap);

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
  toolbar.appendChild(facetRow);

  const switcher = document.createElement('div');
  switcher.className = 'view-switch';
  indicatorEl = document.createElement('div');
  indicatorEl.className = 'vs-indicator';
  switcher.appendChild(indicatorEl);

  const VIEWS = [
    { key: 'tree', label: 'Ağaç', icon: ICON.viewTree },
    { key: 'diagram', label: 'Diyagram', icon: ICON.viewDiagram },
    { key: 'board', label: 'Pano', icon: ICON.viewBoard }
  ];
  switchButtons = {};
  VIEWS.forEach(v => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.currentView === v.key ? 'active' : '';
    btn.innerHTML = v.icon + `<span>${v.label}</span>`;
    btn.onclick = () => setView(v.key);
    switcher.appendChild(btn);
    switchButtons[v.key] = btn;
  });
  toolbar.appendChild(switcher);

  return toolbar;
}

export function positionIndicator() {
  const btn = switchButtons[state.currentView];
  if (btn && indicatorEl) {
    indicatorEl.style.left = btn.offsetLeft + 'px';
    indicatorEl.style.width = btn.offsetWidth + 'px';
  }
}

export function setView(key) {
  state.currentView = key;
  Object.entries(switchButtons).forEach(([k, btn]) => btn.classList.toggle('active', k === key));
  positionIndicator();
  renderContent();
}

export function renderContent() {
  if (selectBtnEl) selectBtnEl.classList.toggle('btn-primary', state.selectMode);

  const scrollX = window.scrollX, scrollY = window.scrollY;
  const oldScrollable = state.root.querySelector('.diagram-scroll, .board');
  const innerScroll = oldScrollable ? { left: oldScrollable.scrollLeft, top: oldScrollable.scrollTop } : null;

  const old = state.root.querySelector('.fw-content');
  const fresh = document.createElement('div');
  fresh.className = 'fw-content';
  fresh.appendChild(renderProgress());

  if (state.selectMode) fresh.appendChild(buildBulkBar());

  const q = state.searchQuery.trim().toLowerCase();
  const hasFilter = q || state.activeFacets.size;
  const visibleIds = hasFilter ? computeSearchVisibleIds(state.tree, q, state.activeFacets) : null;

  if (state.currentView === 'diagram') {
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

  if (old) old.replaceWith(fresh); else state.root.appendChild(fresh);

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
  state.root.appendChild(buildHeader());
  state.root.appendChild(buildToolbar());
  requestAnimationFrame(positionIndicator);
  window.addEventListener('resize', positionIndicator);
  renderContent();
}
