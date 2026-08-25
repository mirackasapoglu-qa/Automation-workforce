// Durum geçmişi: salt-okunur zaman çizelgesi. Kayıtların kendisi data.js:setNodeStatus
// tarafından her durum değişikliğinde otomatik olarak tutulur, burada sadece render edilir.
import { ICON, STATUS_META } from './constants.js';
import { formatNoteDate } from './notes.js';

export function renderDrawerStatusHistory(node) {
  if (!node.statusHistory.length) return null;

  const section = document.createElement('div');
  section.className = 'drawer-section';

  const label = document.createElement('div');
  label.className = 'drawer-section-label';
  label.innerHTML = ICON.history + '<span>Durum Geçmişi</span>';
  section.appendChild(label);

  const list = document.createElement('div');
  list.className = 'drawer-status-history';
  [...node.statusHistory].reverse().forEach(h => {
    const toMeta = STATUS_META[h.to] || STATUS_META['⬜'];
    const fromMeta = STATUS_META[h.from] || STATUS_META['⬜'];
    const item = document.createElement('div');
    item.className = 'drawer-status-history-item';
    const change = document.createElement('span');
    change.className = 'drawer-status-history-change';
    change.innerHTML = `<span>${fromMeta.label}</span><span class="drawer-status-history-arrow">→</span>` + toMeta.icon + `<span>${toMeta.label}</span>`;
    item.appendChild(change);
    const time = document.createElement('span');
    time.className = 'drawer-status-history-time';
    time.textContent = formatNoteDate(h.at);
    item.appendChild(time);
    list.appendChild(item);
  });
  section.appendChild(list);

  return section;
}
