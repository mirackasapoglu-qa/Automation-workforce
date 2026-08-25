// Ağaç/diyagram/pano satır ve kartlarında ortak kullanılan yapı taşları:
// tip chip'i, durum chip'i, isim input'u, ekle/sil butonları.
import { ICON, TYPE_ORDER, TYPE_META, STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { persist, persistDebounced, addChild, removeNode, effectiveStatus, setNodeStatus } from './data.js';
import { newJiraId } from './state.js';
import { renderContent } from './shell.js';
import { openMenu } from './dropdown.js';
import { openJiraPrompt } from './jira.js';

export function buildTypeChip(node) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip chip-type';
  btn.innerHTML = TYPE_META[node.type].icon + `<span>${TYPE_META[node.type].label}</span>` + ICON.chevronDown;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu(btn, TYPE_ORDER.map(t => ({ value: t, label: TYPE_META[t].label, icon: TYPE_META[t].icon })), node.type, (val) => {
      node.type = val; persist(); renderContent();
    });
  };
  return btn;
}

export function buildStatusChip(node) {
  const status = effectiveStatus(node);
  const meta = STATUS_META[status];
  const btn = document.createElement('button');
  btn.type = 'button';

  if (node.children.length) {
    btn.className = 'chip chip-status status-' + statusClass(status) + ' chip-status-auto';
    btn.innerHTML = meta.icon + `<span>${meta.label}</span>`;
    btn.title = 'Otomatik: alt öğelerin en kötü durumuna göre hesaplanır';
    btn.disabled = true;
    return btn;
  }

  btn.className = 'chip chip-status status-' + statusClass(status);
  btn.innerHTML = meta.icon + `<span>${meta.label}</span>` + ICON.chevronDown;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu(btn, STATUS_ORDER.map(s => ({ value: s, label: STATUS_META[s].label, icon: STATUS_META[s].icon })), node.status, (val) => {
      if (val === '❌' && !node.jiraTasks.length) {
        openJiraPrompt(btn, node, (jiraId) => {
          setNodeStatus(node, val);
          node.jiraTasks.push({ id: newJiraId(), taskId: jiraId, createdAt: new Date().toISOString(), analyses: [] });
          persist();
          renderContent();
        });
        return;
      }
      setNodeStatus(node, val);
      persist();
      renderContent();
    });
  };
  return btn;
}

export function buildNameInput(node, placeholder, className) {
  const input = document.createElement('input');
  input.className = className;
  input.value = node.name;
  input.placeholder = placeholder;
  input.oninput = (e) => { node.name = e.target.value; persistDebounced(); };
  return input;
}

export function buildActionButtons(node) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'icon-btn';
  addBtn.title = 'Alt öğe ekle';
  addBtn.innerHTML = ICON.plus;
  addBtn.onclick = () => addChild(node.id);
  wrap.appendChild(addBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn icon-btn-danger';
  delBtn.title = 'Sil';
  delBtn.innerHTML = ICON.trash;
  delBtn.onclick = () => {
    const savedX = window.scrollX, savedY = window.scrollY;
    const restore = () => window.scrollTo(savedX, savedY);
    if (confirm(`"${node.name}" silinsin mi?`)) removeNode(node.id);
    restore();
    requestAnimationFrame(restore);
    requestAnimationFrame(() => requestAnimationFrame(restore));
  };
  wrap.appendChild(delBtn);

  return wrap;
}
