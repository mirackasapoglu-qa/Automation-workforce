// native <select> yerine geçen özel açılır menü sistemi. Aynı anda tek bir panel açık
// olabilir (state.openMenuEl); jira.js kendi panellerini de bu mekanizmayla takip eder.
import { state } from './state.js';
import { ICON } from './constants.js';

export function closeOpenMenu() {
  if (state.openMenuEl) { state.openMenuEl.remove(); state.openMenuEl = null; }
  document.removeEventListener('mousedown', onDocClick, true);
  document.removeEventListener('keydown', onDocKey, true);
}

export function onDocClick(e) { if (state.openMenuEl && !state.openMenuEl.contains(e.target)) closeOpenMenu(); }
export function onDocKey(e) { if (e.key === 'Escape') closeOpenMenu(); }

export function positionMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 172;
  const mh = menu.offsetHeight || 0;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = r.left;
  if (left + mw > vw - 8) left = vw - mw - 8;
  left = Math.max(left, 8);

  let top = r.bottom + 6;
  if (top + mh > vh - 8 && r.top - mh - 6 >= 8) {
    top = r.top - mh - 6; // altta yer yoksa yukarı doğru aç
  } else {
    top = Math.min(top, vh - mh - 8);
  }
  top = Math.max(top, 8);

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.maxHeight = (vh - 16) + 'px';
  menu.style.overflowY = 'auto';
}

// dropdown.js VE jira.js'in kendi özel panellerini açarken paylaştığı ortak adımlar:
// DOM'a ekle, konumlandır, reflow zorla, aç, tek-panel takibini güncelle, dış tık/Esc dinleyicilerini bağla.
export function openOverlayCommon(menu, anchor, focusEl) {
  state.root.appendChild(menu);
  positionMenu(menu, anchor);
  void menu.offsetHeight; // senkron reflow zorla ki transition gerçekten oynasın
  menu.classList.add('open');
  if (focusEl) focusEl.focus();
  state.openMenuEl = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onDocKey, true);
  }, 0);
}

export function openMenu(anchor, items, currentValue, onSelect) {
  closeOpenMenu();
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  items.forEach(it => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dd-item' + (it.value === currentValue ? ' selected' : '');
    row.innerHTML = it.icon + `<span>${it.label}</span>` + (it.value === currentValue ? '<span class="dd-check">' + ICON.check + '</span>' : '');
    row.onclick = () => { closeOpenMenu(); onSelect(it.value); };
    menu.appendChild(row);
  });
  openOverlayCommon(menu, anchor);
}

export function openMultiMenu(anchor, items, selected, onToggle) {
  closeOpenMenu();
  const menu = document.createElement('div');
  menu.className = 'dd-menu';

  function renderRows() {
    menu.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'dd-item dd-item-empty';
      empty.textContent = 'Bağlanacak başka öğe yok';
      menu.appendChild(empty);
      return;
    }
    items.forEach(it => {
      const row = document.createElement('button');
      row.type = 'button';
      const isSel = selected.includes(it.value);
      row.className = 'dd-item' + (isSel ? ' selected' : '');
      row.innerHTML = it.icon + `<span>${it.label}</span>` + (isSel ? '<span class="dd-check">' + ICON.check + '</span>' : '');
      row.onclick = (e) => {
        e.stopPropagation();
        onToggle(it.value);
        renderRows();
      };
      menu.appendChild(row);
    });
  }
  renderRows();
  openOverlayCommon(menu, anchor);
}
