// Ağaç görünümü.
import { state } from './state.js';
import { ICON, STATUS_META, statusClass } from './constants.js';
import { effectiveStatus, persistDebounced, isStale, nodeMatchesQuery } from './data.js';
import { renderContent } from './shell.js';
import { buildTypeChip, buildStatusChip, buildNameInput, buildActionButtons, buildJiraIndicator } from './chips.js';
import { attachDrawerOpener } from './drawer.js';
import { buildSelectCheckbox } from './bulk-actions.js';

// `visibleIds`: arama aktifken hangi node'ların gösterileceğini belirten set (bkz.
// computeSearchVisibleIds). null ise filtre yok, her şey gösterilir.
export function renderNode(node, isRoot, visibleIds) {
  if (visibleIds && !visibleIds.has(node.id)) return document.createDocumentFragment();

  const q = state.searchQuery.trim().toLowerCase();
  const isHit = q && nodeMatchesQuery(node, q);

  const wrap = document.createElement('div');
  wrap.className = 'node' + (isRoot ? ' root' : '');

  const row = document.createElement('div');
  row.className = 'node-row status-' + statusClass(effectiveStatus(node)) + (!node.children.length && isStale(node) ? ' is-stale' : '') + (isHit ? ' search-hit' : '');
  row.setAttribute('data-node-id', node.id);
  row.style.setProperty('--row-color', STATUS_META[effectiveStatus(node)].colorVar);
  attachDrawerOpener(row, node);

  if (node.children.length) {
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'caret' + ((node.open || visibleIds) ? ' open' : '');
    caret.innerHTML = ICON.chevronDown;
    caret.onclick = () => { node.open = !node.open; persistDebounced(); renderContent(); };
    row.appendChild(caret);
  } else {
    if (state.selectMode) row.appendChild(buildSelectCheckbox(node));
    const spacer = document.createElement('span');
    spacer.className = 'caret-spacer';
    row.appendChild(spacer);
  }

  row.appendChild(buildTypeChip(node));
  row.appendChild(buildNameInput(node, 'Öğe adı', 'name-input'));
  row.appendChild(buildStatusChip(node));
  const jiraBadge = buildJiraIndicator(node);
  if (jiraBadge) row.appendChild(jiraBadge);
  row.appendChild(buildActionButtons(node));

  wrap.appendChild(row);

  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'children' + ((node.open || visibleIds) ? ' open' : '');
  node.children.forEach(c => childrenWrap.appendChild(renderNode(c, false, visibleIds)));
  wrap.appendChild(childrenWrap);

  return wrap;
}
