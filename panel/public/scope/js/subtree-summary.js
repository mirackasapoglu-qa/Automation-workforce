// Drawer'da, alt öğeleri olan bir kart açıldığında görünen özet: alt öğelerin durum dağılımı,
// açık/çözülmüş hata sayısı, alt öğelerdeki tüm notların birleşik log listesi ve alt ağaçta
// test case'lerin hangi düğümlerde yaşadığı (bkz. collectDescendantStats::testCaseNodes).
import { state } from './state.js';
import { STATUS_META, ICON } from './constants.js';
import { collectDescendantStats, findNode } from './data.js';
import { formatNoteDate } from './notes.js';
import { openDrawer } from './drawer.js';

const LOG_PREVIEW_COUNT = 5;

export function renderDrawerSubtreeSummary(node) {
  const stats = collectDescendantStats(node);
  if (!stats.total) return null; // hiç alt öğe yoksa bu bölüm hiç gösterilmesin

  const section = document.createElement('div');
  section.className = 'drawer-section';

  const label = document.createElement('div');
  label.className = 'drawer-section-label';
  label.innerHTML = ICON.viewTree + `<span>Alt Öğeler Özeti</span> <span class="drawer-tab-count">${stats.total}</span>`;
  section.appendChild(label);

  const grid = document.createElement('div');
  grid.className = 'subtree-stat-grid';
  ['✅', '🔵', '⚠️', '❌', '⬜'].forEach(key => {
    const meta = STATUS_META[key];
    const tile = document.createElement('div');
    tile.className = 'subtree-stat-tile';
    tile.style.setProperty('--tile-color', meta.colorVar);
    tile.innerHTML = meta.icon
      + `<div class="subtree-stat-num">${stats[key]}</div><div class="subtree-stat-label">${meta.label}</div>`;
    grid.appendChild(tile);
  });
  section.appendChild(grid);

  const bugRow = document.createElement('div');
  bugRow.className = 'subtree-bug-row';
  bugRow.innerHTML = `
    <div class="subtree-bug-tile subtree-bug-open">
      <span class="subtree-bug-num">${stats.bugCount}</span><span class="subtree-bug-label">Açık Hata</span>
    </div>
    <div class="subtree-bug-tile subtree-bug-resolved">
      <span class="subtree-bug-num">${stats.resolvedBugCount}</span><span class="subtree-bug-label">Çözülen Hata</span>
    </div>`;
  section.appendChild(bugRow);

  if (stats.testCaseNodes.length) {
    const tcTotal = stats.testCaseNodes.reduce((sum, t) => sum + t.count, 0);
    const tcLabel = document.createElement('div');
    tcLabel.className = 'drawer-section-label subtree-log-label';
    tcLabel.innerHTML = `<span>Alt Öğelerde Test Case'ler</span> <span class="drawer-tab-count">${tcTotal}</span>`;
    section.appendChild(tcLabel);

    const tcHint = document.createElement('div');
    tcHint.className = 'subtree-testcase-hint';
    tcHint.textContent = 'Yeni bir test case eklemeden önce aynı davranışı zaten kapsayan bir case var mı diye bak:';
    section.appendChild(tcHint);

    const tcList = document.createElement('div');
    tcList.className = 'subtree-testcase-list';
    stats.testCaseNodes.forEach(t => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'subtree-testcase-row';
      row.innerHTML = `<span class="subtree-testcase-name">${t.nodeName || '(isimsiz)'}</span>`
        + `<span class="drawer-tab-count">${t.count}</span>`;
      row.onclick = () => {
        const target = findNode(state.tree, t.nodeId);
        if (target) openDrawer(target);
      };
      tcList.appendChild(row);
    });
    section.appendChild(tcList);
  }

  const logLabel = document.createElement('div');
  logLabel.className = 'drawer-section-label subtree-log-label';
  logLabel.innerHTML = `<span>Log Kayıtları</span>` + (stats.notes.length ? ` <span class="drawer-tab-count">${stats.notes.length}</span>` : '');
  section.appendChild(logLabel);

  const logList = document.createElement('div');
  logList.className = 'subtree-log-list';
  section.appendChild(logList);

  let expanded = false;
  function renderLog() {
    logList.innerHTML = '';
    if (!stats.notes.length) {
      const empty = document.createElement('div');
      empty.className = 'subtree-log-empty';
      empty.textContent = 'Alt öğelerde henüz log kaydı (not) yok.';
      logList.appendChild(empty);
      return;
    }
    const visible = expanded ? stats.notes : stats.notes.slice(0, LOG_PREVIEW_COUNT);
    visible.forEach(n => {
      const item = document.createElement('div');
      item.className = 'subtree-log-item';
      const meta = document.createElement('div');
      meta.className = 'subtree-log-meta';
      meta.innerHTML = `<span class="subtree-log-node">${n.nodeName || '(isimsiz)'}</span><span class="subtree-log-date">${formatNoteDate(n.createdAt)}</span>`;
      item.appendChild(meta);
      const text = document.createElement('div');
      text.className = 'subtree-log-text';
      text.textContent = n.text;
      item.appendChild(text);
      logList.appendChild(item);
    });
    if (stats.notes.length > LOG_PREVIEW_COUNT) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'subtree-log-toggle';
      toggleBtn.textContent = expanded ? 'Daha az göster' : `Tümünü göster (${stats.notes.length})`;
      toggleBtn.onclick = () => { expanded = !expanded; renderLog(); };
      logList.appendChild(toggleBtn);
    }
  }
  renderLog();

  return section;
}
