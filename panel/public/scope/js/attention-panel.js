// Ağaç genelinde "dikkat gerektiren" test case'leri (hiç koşulmamış / bayat) tek bir modalda
// listeler — data.js::collectAttentionTestCases'ın ürettiği veriyi render eder. Tek düğümün
// drawer'ını açmadan "bugün ne koşturmalıyım" sorusuna cevap vermek için (bkz. CLAUDE.md).
//
// Panel açılışı AYNI ZAMANDA ağaç genelinde bir Jira taraması tetikler (bkz.
// runJiraSweep — CLAUDE.md → "Flowscope: Jira durumu → otomatik 'Hatalı'"): kimse
// tek tek drawer açmasa da Jira'da statü değişen kartlar burada yakalanır.
import { state } from './state.js';
import { ICON } from './constants.js';
import { collectAttentionTestCases, findNode, flattenWithPath } from './data.js';
import { formatNoteDate } from './notes.js';
import { openDrawer } from './drawer.js';
import { runJiraSweep } from './jira.js';
import { runDesignDriftSweep } from './design-drift.js';
import { runConfluenceDriftSweep } from './confluence-drift.js';

function closeAttentionPanel() {
  const overlay = state.root.querySelector('.attention-overlay');
  if (overlay) overlay.remove();
}

function buildTestCaseList(entries) {
  const frag = document.createDocumentFragment();
  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = 'Hiç koşulmamış (Bekliyor) ve son koşumu 30 günden eski (Bayat) test case\'ler — '
    + 'zaten Hatalı/Uyarılı olanlar burada değil, onlar durum kartlarında zaten görünüyor.';
  frag.appendChild(desc);

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = 'Şu an dikkat gerektiren bir test case yok — hepsi ya koşulmuş ya da güncel.';
    frag.appendChild(empty);
    return frag;
  }
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
  frag.appendChild(list);
  return frag;
}

/**
 * Jira taraması bölümü. `runJiraSweep()` ağaç genelinde tek istekte tarar,
 * yeni ❌'ları uygular (ekranı `reloadPersistedTree` ile tazeler) ve TERSİNİ
 * (Jira Done ama düğüm hâlâ Hatalı — insan onayı bekliyor) raporlar. Burada
 * SADECE rapor edilir, hiçbir düğüm ✅'ya çekilmez (bkz. CLAUDE.md → "tek yönlü").
 */
async function renderJiraSweepSection(container) {
  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'drawer-placeholder';
  loading.textContent = 'Jira durumları taranıyor…';
  container.appendChild(loading);

  const result = await runJiraSweep();
  container.innerHTML = '';

  if (!result) {
    const err = document.createElement('div');
    err.className = 'drawer-placeholder';
    err.textContent = 'Jira taraması yapılamadı (tracker tanımlı değil ya da sunucuya ulaşılamadı).';
    container.appendChild(err);
    return;
  }

  if (result.flagged.length) {
    const note = document.createElement('p');
    note.className = 'attention-desc';
    note.textContent = `${result.flagged.length} düğüm, Jira'da "Tamamlandı" olmayan bir Task ID'ye sahip olduğu için otomatik "Hatalı"ya çekildi.`;
    container.appendChild(note);
  }

  if (!result.reviewSuggested.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = result.flagged.length
      ? 'İnsan onayı bekleyen bir kart yok.'
      : 'Jira tarafında dikkat gerektiren bir şey yok — bilinen tüm kartlar ya "Hatalı" değil ya da hâlâ açık.';
    container.appendChild(empty);
    return;
  }

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = 'Bu düğümler "Hatalı" işaretli ama bağlı Jira kartlarının TÜMÜ artık "Tamamlandı" — '
    + 'sistem bunları otomatik olarak geri almaz, gözden geçirip kararı sen ver.';
  container.appendChild(desc);

  const flat = flattenWithPath(state.tree, [], []);
  const list = document.createElement('div');
  list.className = 'attention-list';
  result.reviewSuggested.forEach(entry => {
    const found = flat.find(f => f.node.id === entry.nodeId);
    if (!found) return; // düğüm bu arada silinmiş olabilir
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'attention-row';
    row.onclick = () => { closeAttentionPanel(); openDrawer(found.node); };

    const badge = document.createElement('span');
    badge.className = 'attention-badge attention-badge-review';
    badge.textContent = 'ONAY BEKLİYOR';
    row.appendChild(badge);

    const info = document.createElement('span');
    info.className = 'attention-info';
    const title = document.createElement('span');
    title.className = 'attention-title';
    title.textContent = found.node.name;
    info.appendChild(title);
    const path = document.createElement('span');
    path.className = 'attention-path';
    path.textContent = found.path.join(' › ');
    info.appendChild(path);
    row.appendChild(info);

    const meta = document.createElement('span');
    meta.className = 'attention-meta';
    meta.textContent = entry.doneTaskIds.join(', ') + ' · Done';
    row.appendChild(meta);

    list.appendChild(row);
  });
  container.appendChild(list);
}

/**
 * Ortak Drift Radarı bölüm oluşturucusu — Figma VE Confluence AYNI şekli
 * paylaşır (sadece hangi sweep'in çağrıldığı ve metinler değişir). Jira
 * bölümünün tersine burada "gözden geçir" tersi bir liste yok — ⚠️'den çıkış
 * her zaman insan elinden.
 * @param {() => Promise<{flagged:{nodeId:string,url:string,lastModified:string}[]}|null>} runSweep
 * @param {{loading:string, error:string, empty:string, desc:string, badge:string}} texts
 */
async function renderDriftSection(container, runSweep, texts) {
  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'drawer-placeholder';
  loading.textContent = texts.loading;
  container.appendChild(loading);

  const result = await runSweep();
  container.innerHTML = '';

  if (!result) {
    const err = document.createElement('div');
    err.className = 'drawer-placeholder';
    err.textContent = texts.error;
    container.appendChild(err);
    return;
  }

  if (!result.flagged.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = texts.empty;
    container.appendChild(empty);
    return;
  }

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = texts.desc;
  container.appendChild(desc);

  const flat = flattenWithPath(state.tree, [], []);
  const list = document.createElement('div');
  list.className = 'attention-list';
  result.flagged.forEach(entry => {
    const found = flat.find(f => f.node.id === entry.nodeId);
    if (!found) return; // düğüm bu arada silinmiş olabilir
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'attention-row';
    row.onclick = () => { closeAttentionPanel(); openDrawer(found.node); };

    const badge = document.createElement('span');
    badge.className = 'attention-badge attention-badge-drift';
    badge.textContent = texts.badge;
    row.appendChild(badge);

    const info = document.createElement('span');
    info.className = 'attention-info';
    const title = document.createElement('span');
    title.className = 'attention-title';
    title.textContent = found.node.name;
    info.appendChild(title);
    const path = document.createElement('span');
    path.className = 'attention-path';
    path.textContent = found.path.join(' › ');
    info.appendChild(path);
    row.appendChild(info);

    const meta = document.createElement('span');
    meta.className = 'attention-meta';
    meta.textContent = 'Son değişiklik: ' + formatNoteDate(entry.lastModified);
    row.appendChild(meta);

    list.appendChild(row);
  });
  container.appendChild(list);
}

function renderDesignDriftSection(container) {
  return renderDriftSection(container, runDesignDriftSweep, {
    loading: 'Tasarım (Figma) değişiklikleri taranıyor…',
    error: 'Tasarım taraması yapılamadı (Figma kimliği yok/koparılmış ya da sunucuya ulaşılamadı).',
    empty: 'Doğrulanmış (✅) hiçbir düğümün tasarımı son onaydan sonra değişmemiş.',
    desc: 'Bu düğümler "Tamamlandı" işaretliydi ama bağlı Figma dosyaları senin doğruladığın '
      + 'tarihten SONRA değişmiş — otomatik "Uyarılı"ya çekildi, yeniden gözden geçir.',
    badge: 'TASARIM GÜNCELLENDİ',
  });
}

function renderConfluenceDriftSection(container) {
  return renderDriftSection(container, runConfluenceDriftSweep, {
    loading: 'Confluence dokümanları taranıyor…',
    error: 'Doküman taraması yapılamadı (Confluence kimliği yok/koparılmış ya da sunucuya ulaşılamadı).',
    empty: 'Doğrulanmış (✅) hiçbir düğümün bağlı dokümanı son onaydan sonra değişmemiş.',
    desc: 'Bu düğümler "Tamamlandı" işaretliydi ama bağlı Confluence sayfaları senin doğruladığın '
      + 'tarihten SONRA düzenlenmiş — otomatik "Uyarılı"ya çekildi, yeniden gözden geçir.',
    badge: 'DOKÜMAN GÜNCELLENDİ',
  });
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
  body.appendChild(buildTestCaseList(entries));

  const jiraHeading = document.createElement('div');
  jiraHeading.className = 'attention-subheading';
  jiraHeading.innerHTML = ICON.jira + '<span>Jira</span>';
  body.appendChild(jiraHeading);

  const jiraSection = document.createElement('div');
  body.appendChild(jiraSection);
  renderJiraSweepSection(jiraSection);

  const designHeading = document.createElement('div');
  designHeading.className = 'attention-subheading';
  designHeading.innerHTML = ICON.figma + '<span>Tasarım</span>';
  body.appendChild(designHeading);

  const designSection = document.createElement('div');
  body.appendChild(designSection);
  renderDesignDriftSection(designSection);

  const docsHeading = document.createElement('div');
  docsHeading.className = 'attention-subheading';
  docsHeading.innerHTML = ICON.confluence + '<span>Dokümantasyon</span>';
  body.appendChild(docsHeading);

  const docsSection = document.createElement('div');
  body.appendChild(docsSection);
  renderConfluenceDriftSection(docsSection);

  modal.appendChild(body);
  state.root.appendChild(overlay);
}
