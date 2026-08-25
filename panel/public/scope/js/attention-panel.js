// Ağaç genelinde "dikkat gerektiren" test case'leri (hiç koşulmamış / bayat) tek bir modalda
// listeler — data.js::collectAttentionTestCases'ın ürettiği veriyi render eder. Tek düğümün
// drawer'ını açmadan "bugün ne koşturmalıyım" sorusuna cevap vermek için (bkz. CLAUDE.md).
import { state } from './state.js';
import { ICON } from './constants.js';
import { collectAttentionTestCases, findNode } from './data.js';
import { formatNoteDate } from './notes.js';
import { openDrawer } from './drawer.js';

function closeAttentionPanel() {
  const overlay = state.root.querySelector('.attention-overlay');
  if (overlay) overlay.remove();
}

export function openAttentionPanel() {
  closeAttentionPanel();
  const entries = collectAttentionTestCases(state.tree);

  const overlay = document.createElement('div');
  overlay.className = 'attention-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeAttentionPanel(); };

  const modal = document.createElement('div');
  modal.className = 'attention-modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'attention-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'attention-title-bar';
  titleEl.innerHTML = ICON.statusWarn + `<span>Bayat/Bekleyen Test Case'ler</span>`
    + (entries.length ? ` <span class="drawer-tab-count">${entries.length}</span>` : '');
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drawer-close';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = closeAttentionPanel;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'attention-body';

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = 'Hiç koşulmamış (Bekliyor) ve son koşumu 30 günden eski (Bayat) test case\'ler — '
    + 'zaten Hatalı/Uyarılı olanlar burada değil, onlar durum kartlarında zaten görünüyor.';
  body.appendChild(desc);

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = 'Şu an dikkat gerektiren bir test case yok — hepsi ya koşulmuş ya da güncel.';
    body.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'attention-list';
    entries.forEach(entry => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'attention-row';
      row.onclick = () => {
        const target = findNode(state.tree, entry.nodeId);
        if (target) { closeAttentionPanel(); openDrawer(target); }
      };

      const badge = document.createElement('span');
      badge.className = 'attention-badge attention-badge-' + entry.reason;
      badge.textContent = entry.reason === 'pending' ? 'BEKLİYOR' : 'BAYAT';
      row.appendChild(badge);

      const info = document.createElement('span');
      info.className = 'attention-info';
      const title = document.createElement('span');
      title.className = 'attention-title';
      title.textContent = entry.title || '(başlıksız test case)';
      info.appendChild(title);
      const path = document.createElement('span');
      path.className = 'attention-path';
      path.textContent = entry.nodePath;
      info.appendChild(path);
      row.appendChild(info);

      const meta = document.createElement('span');
      meta.className = 'attention-meta';
      meta.textContent = entry.reason === 'pending'
        ? 'Eklendi: ' + formatNoteDate(entry.at)
        : 'Son koşum: ' + formatNoteDate(entry.at);
      row.appendChild(meta);

      list.appendChild(row);
    });
    body.appendChild(list);
  }

  modal.appendChild(body);
  state.root.appendChild(overlay);
}
