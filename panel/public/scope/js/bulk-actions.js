// Toplu seçim modu: birden fazla yaprak (alt öğesi olmayan) node seçip durumlarını tek
// hamlede değiştirmeyi sağlar. Sadece yaprak node'lar seçilebilir; üst öğelerin durumu zaten
// alt öğelerinden otomatik hesaplanıyor (bkz. effectiveStatus), o yüzden onlara doğrudan
// durum atamanın anlamı yok.
import { state } from './state.js';
import { ICON, STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { findNode, setNodeStatus, persist } from './data.js';
import { renderContent } from './shell.js';
import { openTestCaseRequest } from './testcase-request.js';

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
     * TOPLU TEST CASE URETIMI — panel model CAGIRMAZ.
     *
     * Taramanin cikardigi baslik yapisi (h1/h2/h3 → bolum/islev) her dugumde
     * duruyor; prompt bunu baglam olarak kullaniyor. Tek tek basmak 131 dugumde
     * anlamsiz oldugu icin secili dugumlerin hepsi tek prompt'a giriyor; donen
     * JSON ayni modalden agaca yaziliyor.
     */
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'btn btn-primary';
    genBtn.innerHTML = ICON.sparkle + '<span>Test case iste (Claude Code)</span>';
    genBtn.title = 'Secili dugumler icin prompt uretir, donen JSON\'u agaca yazar';
    genBtn.onclick = () => openTestCaseRequest({
      nodeIds: [...state.selectedIds],
      types: ['happy', 'negative'],
      limit: 4,
    });
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
