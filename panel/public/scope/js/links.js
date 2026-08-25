// Sayfa/öğe içi çapraz bağlantı (navigasyon) özelliği.
import { state } from './state.js';
import { ICON, TYPE_META } from './constants.js';
import { getDescendantIds, flattenWithPath, findNode, persist } from './data.js';
import { openMultiMenu } from './dropdown.js';
import { renderContent, setView } from './shell.js';
import { renderDrawer } from './drawer.js';

export function openLinkPicker(anchor, node) {
  const excluded = getDescendantIds(node, new Set());
  const flat = flattenWithPath(state.tree, [], []).filter(f => !excluded.has(f.node.id));
  const items = flat.map(f => ({
    value: f.node.id,
    label: (f.path.length ? f.path.join(' › ') + ' › ' : '') + f.node.name,
    icon: TYPE_META[f.node.type].icon
  }));
  openMultiMenu(anchor, items, node.linkTos, (id) => {
    const idx = node.linkTos.indexOf(id);
    if (idx > -1) node.linkTos.splice(idx, 1); else node.linkTos.push(id);
    persist();
    renderContent();
  });
}

export function jumpToNode(id) {
  setView('diagram');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = state.root.querySelector('.diag-card[data-node-id="' + id + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1300);
    }
  }));
}

export function renderDrawerLinksSection(node) {
  const section = document.createElement('div');
  section.className = 'drawer-section';

  const label = document.createElement('div');
  label.className = 'drawer-section-label';
  label.innerHTML = ICON.link + '<span>Bağlantılar</span>';
  section.appendChild(label);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn';
  addBtn.innerHTML = ICON.plus + '<span>Bağlantı ekle</span>';
  addBtn.style.marginBottom = '10px';
  addBtn.onclick = (e) => { e.stopPropagation(); openLinkPicker(addBtn, node); };
  section.appendChild(addBtn);

  const list = document.createElement('div');
  list.className = 'drawer-jira-list';
  if (!node.linkTos.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.style.padding = '16px 12px';
    empty.textContent = 'Henüz bağlantı eklenmedi.';
    list.appendChild(empty);
  } else {
    node.linkTos.forEach(targetId => {
      const target = findNode(state.tree, targetId);
      if (!target) return;
      const chip = document.createElement('span');
      chip.className = 'drawer-link-chip';
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'drawer-link-chip-jump';
      jumpBtn.innerHTML = TYPE_META[target.type].icon + `<span>${target.name}</span>`;
      jumpBtn.onclick = () => jumpToNode(target.id);
      chip.appendChild(jumpBtn);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'drawer-jira-chip-remove';
      removeBtn.title = 'Bağlantıyı kaldır';
      removeBtn.innerHTML = ICON.close;
      removeBtn.onclick = () => {
        node.linkTos = node.linkTos.filter(id => id !== targetId);
        persist();
        renderDrawer();
      };
      chip.appendChild(removeBtn);
      list.appendChild(chip);
    });
  }
  section.appendChild(list);

  return section;
}
