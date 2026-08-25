// Toplu seçim modu: birden fazla yaprak (alt öğesi olmayan) node seçip durumlarını tek
// hamlede değiştirmeyi sağlar. Sadece yaprak node'lar seçilebilir; üst öğelerin durumu zaten
// alt öğelerinden otomatik hesaplanıyor (bkz. effectiveStatus), o yüzden onlara doğrudan
// durum atamanın anlamı yok.
import { state } from './state.js';
import { ICON, STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { findNode, setNodeStatus, persist, loadPersisted } from './data.js';
import { renderContent } from './shell.js';

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
     * TOPLU TEST CASE URETIMI.
     *
     * Taramanin cikardigi baslik yapisi (h1/h2/h3 → bolum/islev) her dugumde
     * duruyor; uretici bunu baglam olarak kullaniyor. Tek tek basmak 131
     * dugumde anlamsiz oldugu icin secili dugumler tek istekte gonderiliyor.
     * Sunucu UST SINIR uyguluyor (25) ve kimlik yoksa ilk hatada duruyor —
     * bosuna cagri yapilmiyor.
     */
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'btn btn-primary';
    genBtn.innerHTML = ICON.sparkle + '<span>Test case uret</span>';
    genBtn.title = 'Secili dugumler icin model test case yazar (taslak; kosum kaydi yok)';
    genBtn.onclick = async () => {
      const ids = [...state.selectedIds];
      if (!ids.length) return;
      if (ids.length > 25 && !confirm(`${ids.length} dugum secili ama tek seferde en fazla 25 islenir. Ilk 25 icin devam edilsin mi?`)) return;
      const eski = genBtn.innerHTML;
      genBtn.disabled = true;
      genBtn.innerHTML = '<span>uretiliyor...</span>';
      const not = document.createElement('div');
      not.className = 'bulk-bar-label';
      not.style.whiteSpace = 'pre-line';
      bar.appendChild(not);
      try {
        const res = await fetch('/api/scope/testcases/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
          body: JSON.stringify({ nodeIds: ids, types: ['happy', 'negative'], limit: 4 }),
        });
        const data = await res.json();
        if (!data.ok) { not.textContent = data.error || 'Uretilemedi.'; return; }
        const hata = data.sonuc.find(x => x.error);
        const yazilan = data.sonuc.reduce((a, x) => a + (x.written || 0), 0);
        not.textContent = hata
          // Kimlik/paket eksikse SEBEBI goster — sessizce "0 case" deme.
          ? `${yazilan} case yazildi, sonra durdu: ${hata.error}`
          : `${yazilan} case yazildi (${data.sonuc.length} dugum)` +
            (data.note ? `\n${data.note}` : '') +
            `\ntoken: ${data.usage.input_tokens} girdi / ${data.usage.output_tokens} cikti`;
        if (yazilan) { await loadPersisted(); renderContent(); }
      } catch (e) {
        not.textContent = `Panel sunucusuna ulasilamadi: ${e.message}`;
      } finally {
        genBtn.disabled = false;
        genBtn.innerHTML = eski;
      }
    };
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
