// Pano (kanban) görünümü: durum bazlı sütunlar + sürükle-bırak.
import { state, newJiraId } from './state.js';
import { STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { flattenWithPath, findNode, effectiveStatus, persist, setNodeStatus, isStale, nodeMatchesQuery } from './data.js';
import { openJiraPrompt } from './jira.js';
import { renderContent } from './shell.js';
import { buildTypeChip, buildStatusChip, buildNameInput, buildActionButtons, buildJiraIndicator } from './chips.js';
import { attachDrawerOpener } from './drawer.js';
import { buildSelectCheckbox } from './bulk-actions.js';

// `visibleIds`: arama aktifken hangi node'ların gösterileceğini belirten set (bkz.
// computeSearchVisibleIds). null ise filtre yok, her şey gösterilir.
export function renderBoard(visibleIds) {
  const wrap = document.createElement('div');
  wrap.className = 'board';
  let flat = flattenWithPath(state.tree, [], []);
  if (visibleIds) flat = flat.filter(f => visibleIds.has(f.node.id));

  STATUS_ORDER.forEach(statusVal => {
    const meta = STATUS_META[statusVal];
    const colEl = document.createElement('div');
    colEl.className = 'board-col';
    colEl.style.setProperty('--col-color', meta.colorVar);

    colEl.ondragover = (e) => { e.preventDefault(); colEl.classList.add('drag-over'); };
    colEl.ondragleave = () => colEl.classList.remove('drag-over');
    colEl.ondrop = (e) => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const node = findNode(state.tree, id);
      if (!node || node.children.length || node.status === statusVal) return;
      if (statusVal === '❌' && !node.jiraTasks.length) {
        const dropX = e.clientX, dropY = e.clientY;
        const fakeAnchor = { getBoundingClientRect: () => ({ left: dropX, right: dropX, top: dropY, bottom: dropY, width: 0, height: 0 }) };
        openJiraPrompt(fakeAnchor, node, (jiraId) => {
          setNodeStatus(node, statusVal);
          node.jiraTasks.push({ id: newJiraId(), taskId: jiraId, createdAt: new Date().toISOString(), analyses: [] });
          persist();
          renderContent();
        });
        return;
      }
      setNodeStatus(node, statusVal);
      persist();
      renderContent();
    };

    const items = flat.filter(f => effectiveStatus(f.node) === statusVal);

    const head = document.createElement('div');
    head.className = 'board-col-head';
    head.innerHTML = `<span class="board-col-head-label">${meta.icon}${meta.label}</span><span class="board-col-count">${items.length}</span>`;
    colEl.appendChild(head);

    const list = document.createElement('div');
    list.className = 'board-col-list';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'board-col-empty';
      empty.textContent = 'Öğe yok';
      list.appendChild(empty);
    } else {
      items.forEach(item => list.appendChild(renderBoardCard(item.node, item.path)));
    }
    colEl.appendChild(list);

    wrap.appendChild(colEl);
  });

  return wrap;
}

export function renderBoardCard(node, path) {
  const card = document.createElement('div');
  const status = effectiveStatus(node);
  const isLeaf = !node.children.length;
  const q = state.searchQuery.trim().toLowerCase();
  const isHit = q && nodeMatchesQuery(node, q);
  card.className = 'board-card status-' + statusClass(status) + (isLeaf ? '' : ' board-card-auto') + (isLeaf && isStale(node) ? ' is-stale' : '') + (isHit ? ' search-hit' : '');
  card.setAttribute('data-node-id', node.id);
  card.style.setProperty('--card-color', STATUS_META[status].colorVar);
  card.draggable = isLeaf;
  card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', node.id); card.classList.add('dragging'); };
  card.ondragend = () => card.classList.remove('dragging');
  attachDrawerOpener(card, node);

  const top = document.createElement('div');
  top.className = 'board-card-top';
  const topLeft = document.createElement('div');
  topLeft.className = 'board-card-top-left';
  if (isLeaf && state.selectMode) topLeft.appendChild(buildSelectCheckbox(node));
  topLeft.appendChild(buildTypeChip(node));
  top.appendChild(topLeft);
  top.appendChild(buildActionButtons(node));
  card.appendChild(top);

  if (path.length) {
    const bc = document.createElement('div');
    bc.className = 'board-card-path';
    bc.textContent = path.join(' › ');
    card.appendChild(bc);
  }

  card.appendChild(buildNameInput(node, 'Ad', 'board-name-input'));

  const bottom = document.createElement('div');
  bottom.className = 'board-card-bottom';
  bottom.appendChild(buildStatusChip(node));
  const jiraBadge = buildJiraIndicator(node);
  if (jiraBadge) bottom.appendChild(jiraBadge);
  card.appendChild(bottom);

  return card;
}
