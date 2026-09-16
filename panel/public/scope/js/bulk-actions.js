// Toplu seçim modu: birden fazla yaprak (alt öğesi olmayan) node seçip durumlarını tek
// hamlede değiştirmeyi ya da hepsine test case üretmeyi sağlar.
//
// SEÇİM KÜMESİ YAPRAKLARDIR. Üst öğelerin durumu alt öğelerinden otomatik hesaplanır
// (bkz. effectiveStatus), case'ler de yapraklara yazılır. Konteynerlerde (modül/sayfa/
// bölüm) de checkbox VAR (2026-09-16) ama işareti "kendini seç" değil, "alt ağacındaki
// tüm yaprakları seç" demektir: kullanıcı "x modülünü seçtiğimde altındaki y, z, b için
// case üretilsin, her biri kendi altına yazılsın" istedi. Konteynerin kutusu alt
// yaprakların hepsi seçiliyse dolu, bir kısmı seçiliyse "belirsiz" (indeterminate) çizilir.
//
// ⚠️ "Tümünü seç" de aynı kuralla YAPRAK sayar: eskiden konteyner id'leri de kümeye
// giriyordu, sayı (455) durum atamasının gerçekten dokunduğu öğe sayısından fazla
// gösteriliyordu ve konteynerler tek isteme "düğüm" olarak giriyordu.
import { state } from './state.js';
import { ICON, STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { findNode, setNodeStatus, persist, computeSearchVisibleIds, getLeafIds } from './data.js';
import { renderContent } from './shell.js';
import { applyGenerateLabel } from './testcase-request.js';
import { openBulkGenerateModal } from './bulk-generate.js';

export function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selectedIds.clear();
  renderContent();
}

export function toggleNodeSelected(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  renderContent();
}

/** Konteynerin alt yaprakları: hepsi seçiliyse kümeden çıkar, değilse hepsini ekle. */
export function toggleSubtreeSelected(node) {
  const yapraklar = getLeafIds(node);
  if (!yapraklar.length) return;
  const hepsi = yapraklar.every(id => state.selectedIds.has(id));
  yapraklar.forEach(id => hepsi ? state.selectedIds.delete(id) : state.selectedIds.add(id));
  renderContent();
}

/** Konteyner kutusunun durumu: 'all' | 'some' | 'none'. */
export function subtreeSelection(node) {
  const yapraklar = getLeafIds(node);
  const secili = yapraklar.filter(id => state.selectedIds.has(id)).length;
  return secili === 0 ? 'none' : secili === yapraklar.length ? 'all' : 'some';
}

export function clearSelection() {
  state.selectedIds.clear();
  renderContent();
}

export function applyBulkStatus(status) {
  state.selectedIds.forEach(id => {
    const node = findNode(state.tree, id);
    if (node && !node.children.length) setNodeStatus(node, status);
  });
  persist();
  clearSelection();
}

export function buildSelectCheckbox(node) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-checkbox';
  if (node.children.length) {
    const durum = subtreeSelection(node);
    const n = getLeafIds(node).length;
    cb.checked = durum === 'all';
    cb.indeterminate = durum === 'some';
    cb.classList.add('select-checkbox-subtree');
    cb.title = `Alt ağaçtaki ${n} yaprağı seç/kaldır — durum ve test case'ler her yaprağın kendi altına yazılır`;
    cb.onclick = (e) => { e.stopPropagation(); toggleSubtreeSelected(node); };
    return cb;
  }
  cb.checked = state.selectedIds.has(node.id);
  cb.title = 'Toplu güncelleme için seç';
  cb.onclick = (e) => { e.stopPropagation(); toggleNodeSelected(node.id); };
  return cb;
}

export function buildBulkBar() {
  const count = state.selectedIds.size;
  const bar = document.createElement('div');
  bar.className = 'bulk-bar';

  const label = document.createElement('span');
  label.className = 'bulk-bar-label';
  label.textContent = count ? `${count} öğe seçili` : 'Durumunu değiştirmek istediğin öğeleri işaretle';
  bar.appendChild(label);

  /*
   * TÜMÜNÜ SEÇ. 101 düğümlük bir ağaçta tek tek işaretlemek pratikte
   * imkânsızdı (kullanıcı bildirdi) — toplu işlemin varlık sebebi zaten bu.
   *
   * ⚠️ "Tümü" = SÜZGEÇTEN GEÇEN düğümler, ağacın tamamı değil. Arama ya da
   * facet açıkken ekranda 6 öğe görünüp 101'inin seçilmesi, kullanıcının
   * gördüğüyle yaptığının ayrışması demekti. `computeSearchVisibleIds` zaten
   * ağacın kendi görünürlük kuralını (eşleşen + ataları + eşleşen dalın altı)
   * hesaplıyor; aynı kural burada da geçerli.
   */
  const gorunen = computeSearchVisibleIds(state.tree, state.searchQuery.trim().toLowerCase(), state.activeFacets);
  // Yalnız yapraklar: konteyner id'leri kümeye girmez (üstteki başlık notu).
  const secilebilir = new Set();
  (function walk(list) {
    list.forEach(n => {
      if (gorunen.has(n.id) && !n.children.length) secilebilir.add(n.id);
      walk(n.children);
    });
  })(state.tree);
  const hepsiSecili = secilebilir.size > 0 && [...secilebilir].every(id => state.selectedIds.has(id));
  const suzgecVar = Boolean(state.searchQuery.trim() || state.activeFacets.size);

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'btn';
  allBtn.textContent = hepsiSecili
    ? 'Seçimi kaldır'
    : `Tümünü seç (${secilebilir.size})`;
  allBtn.title = suzgecVar
    ? 'Süzgeçten geçen yaprak öğelerin tamamını seçer — ekranda görünmeyen öğe seçilmez.'
    : 'Ağaçtaki tüm yaprak öğeleri seçer (modül/sayfa/bölüm başlıkları değil, altlarındaki öğeler).';
  allBtn.disabled = secilebilir.size === 0;
  allBtn.onclick = () => {
    if (hepsiSecili) secilebilir.forEach(id => state.selectedIds.delete(id));
    else secilebilir.forEach(id => state.selectedIds.add(id));
    renderContent();
  };
  bar.appendChild(allBtn);

  if (count) {
    const actions = document.createElement('div');
    actions.className = 'bulk-bar-actions';
    STATUS_ORDER.forEach(s => {
      const meta = STATUS_META[s];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip chip-status status-' + statusClass(s);
      btn.innerHTML = meta.icon + `<span>${meta.label}</span>`;
      btn.onclick = () => applyBulkStatus(s);
      actions.appendChild(btn);
    });
    bar.appendChild(actions);

    /**
     * TOPLU TEST CASE URETIMI. Dugme once secenek sormadan sabit
     * happy+negative · 4 ile gidiyordu; artik drawer'daki QA Analizi ile AYNI
     * secenekleri (preset · tur · tur paketi · dugum basina sinir) soran bir
     * modal acilir (bulk-generate.js). Uretimin kendisi yine tek yoldan
     * (testcase-request.js): secili dugumlerin hepsi tek isteme girer, donen
     * JSON ayni kapidan (allowedNodeIds) agaca yazilir.
     */
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'btn btn-primary';
    genBtn.innerHTML = ICON.sparkle + '<span>Test case iste (Claude Code)</span>';
    applyGenerateLabel(genBtn, ICON.sparkle);
    genBtn.title = 'Secili dugumler icin tur/sinir secip test case uretir';
    genBtn.onclick = () => openBulkGenerateModal({ nodeIds: [...state.selectedIds] });
    bar.appendChild(genBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn';
    clearBtn.textContent = 'Seçimi temizle';
    clearBtn.onclick = clearSelection;
    bar.appendChild(clearBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Seçim modundan çık';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = toggleSelectMode;
  bar.appendChild(closeBtn);

  return bar;
}
