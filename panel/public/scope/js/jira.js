// Jira Task ID özelliği: çoklu kayıt, "Hatalı" durumunda zorunluluk, tıklanabilir linkler,
// Jira durumu "Tamamlandı" değilse kartın otomatik "Hatalı"ya çekilmesi (bkz. autoFlagFromJiraStatus).
import { state, newJiraId, newJiraAnalysisId } from './state.js';
import { ICON } from './constants.js';
import { persist, setNodeStatus, jiraTaskIsKnownNotDone, reloadPersistedTree } from './data.js';
import { closeOpenMenu, openOverlayCommon } from './dropdown.js';
import { renderDrawer } from './drawer.js';
import { renderContent } from './shell.js';
import { formatNoteDate } from './notes.js';

export function openJiraPrompt(anchor, node, onDone) {
  closeOpenMenu();
  const panel = document.createElement('div');
  panel.className = 'dd-menu jira-prompt';

  const label = document.createElement('div');
  label.className = 'jira-prompt-label';
  label.textContent = '"Hatalı" için Jira Task ID gerekli';
  panel.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'jira-prompt-input';
  input.placeholder = 'örn. PROJ-123';
  input.value = '';
  panel.appendChild(input);

  const errorEl = document.createElement('div');
  errorEl.className = 'jira-prompt-error';
  errorEl.style.display = 'none';
  panel.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'jira-prompt-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Vazgeç';
  cancelBtn.onclick = () => closeOpenMenu();
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Kaydet';
  saveBtn.disabled = !input.value.trim();
  const submit = async () => {
    const val = input.value.trim();
    if (!val) return;
    errorEl.style.display = 'none';
    input.classList.remove('drawer-input-error');

    // Diğer eklenme yoluyla (drawer'daki Jira bölümü) aynı kurala tabi: Jira "kesin olarak
    // bulunamadı" derse kabul edilmez. Doğrulama yapılamazsa (config/ağ sorunu) engellenmez.
    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = 'Kontrol ediliyor…';
    try {
      const res = await fetch('/api/tracker/status?keys=' + encodeURIComponent(val));
      const data = await res.json();
      if (data.ok && data.statuses[val] && data.statuses[val].found === false) {
        errorEl.textContent = 'Bu Jira Task ID Jira’da bulunamadı. Geçerli bir ID girin.';
        errorEl.style.display = 'block';
        input.classList.add('drawer-input-error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
        return;
      }
    } catch (e) {
      // Doğrulama isteği başarısız oldu — Jira'nın kendisiyle ilgili bir sorun olmadığından
      // ekleme engellenmez.
    }
    closeOpenMenu();
    onDone(val);
  };
  saveBtn.onclick = submit;
  actions.appendChild(saveBtn);

  input.oninput = () => { saveBtn.disabled = !input.value.trim(); errorEl.style.display = 'none'; input.classList.remove('drawer-input-error'); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) submit();
  });
  panel.appendChild(actions);

  openOverlayCommon(panel, anchor, input);
}

export function openJiraUrlPrompt(anchor) {
  closeOpenMenu();
  const panel = document.createElement('div');
  panel.className = 'dd-menu jira-prompt';

  const label = document.createElement('div');
  label.className = 'jira-prompt-label';
  label.textContent = 'Jira bağlantı adresi';
  panel.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'jira-prompt-input';
  input.placeholder = 'https://sirket.atlassian.net/browse/';
  input.value = state.jiraBaseUrl;
  panel.appendChild(input);

  const hint = document.createElement('div');
  hint.className = 'drawer-hint';
  hint.textContent = 'Ayarlanırsa Jira ID etiketleri tıklanınca burada + ID ile açılır.';
  panel.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'jira-prompt-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Vazgeç';
  cancelBtn.onclick = () => closeOpenMenu();
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Kaydet';
  saveBtn.onclick = () => {
    state.jiraBaseUrl = input.value.trim();
    // Kalici DEGIL: taban URL proje profilinden gelir (connectors.tracker),
    // buradaki degisiklik yalnizca bu oturum icin gecerlidir.
    closeOpenMenu();
    renderDrawer();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') saveBtn.click(); });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  openOverlayCommon(panel, anchor, input);
}

let jiraPollTimer = null;
const JIRA_POLL_INTERVAL_MS = 60000;

// Eklenmiş Task ID'lerden BİLİNEN (gerçekten Jira'da bulunmuş ve statüsü çekilmiş) herhangi
// biri "done" kategorisinde değilse kartı otomatik "Hatalı"ya çeker. Henüz kontrol edilmemiş
// ya da "bulunamadı" damgalı ID'ler bu kararı ETKİLEMEZ — belirsiz veriyle karar verilmez.
// Tek yönlü: Jira "Done" olunca kart otomatik geri alınmıyor, bu bir insan kararı olarak kalıyor.
function autoFlagFromJiraStatus(node) {
  if (node.children.length || !node.jiraTasks.length) return false;
  const anyKnownNotDone = node.jiraTasks.some(t => jiraTaskIsKnownNotDone(state.jiraStatusCache[t.taskId]));
  if (anyKnownNotDone && node.status !== '❌') {
    setNodeStatus(node, '❌');
    return true;
  }
  return false;
}

async function refreshJiraStatuses(node) {
  const keys = node.jiraTasks.map(t => t.taskId);
  if (!keys.length) return;
  // Jira bölümü yalnızca "Genel" sekmesinde görünür. Kullanıcı "Notlar" sekmesinde henüz
  // kaydedilmemiş bir form dolduruyor olabilir — oradayken renderDrawer() çağırmak tüm paneli
  // yeniden kurup o taslağı sessizce siler. Bu yüzden görünmez şekilde arka planda güncelleriz;
  // veriler state.jiraStatusCache'te kalır, kullanıcı "Genel" sekmesine dönünce güncel görünür.
  const canRerender = () => state.drawerNode === node && state.drawerTab === 'jira';
  state.jiraStatusLoading = true;
  if (canRerender()) renderDrawer();
  let statusChanged = false;
  try {
    const res = await fetch('/api/tracker/status?keys=' + encodeURIComponent(keys.join(',')));
    const data = await res.json();
    if (state.drawerNode !== node) return;
    if (data.ok) {
      Object.assign(state.jiraStatusCache, data.statuses);
      state.jiraStatusError = '';
      statusChanged = autoFlagFromJiraStatus(node);
    } else {
      state.jiraStatusError = data.error || 'Jira durumu alınamadı.';
    }
  } catch (e) {
    if (state.drawerNode !== node) return;
    state.jiraStatusError = 'Panel sunucusuna ulaşılamadı.';
  }
  state.jiraStatusLoading = false;
  if (statusChanged) {
    // Sadece drawer'ın Jira sekmesi degil, kartin agac/pano/diyagramdaki chip'i de
    // etkileniyor — persist() + renderContent() burada zorunlu (renderDrawer() aksi
    // halde "Genel" sekmesinde bile yeni durumu gostermez).
    persist();
    renderContent();
  }
  if (canRerender()) renderDrawer();
}

export function startJiraStatusPolling(node) {
  stopJiraStatusPolling();
  if (node.children.length || !node.jiraTasks.length) return;
  refreshJiraStatuses(node);
  jiraPollTimer = setInterval(() => refreshJiraStatuses(node), JIRA_POLL_INTERVAL_MS);
}

export function stopJiraStatusPolling() {
  if (jiraPollTimer) { clearInterval(jiraPollTimer); jiraPollTimer = null; }
  state.jiraStatusLoading = false;
}

/**
 * Ağaç genelinde Jira taraması — `POST /api/scope/jira/sweep` (sunucu tarafı:
 * `panel/scope.mjs → sweepJiraStatuses`). `refreshJiraStatuses`/`startJiraStatusPolling`
 * yalnızca O AN drawer'ı açık olan tek düğüm için çalışır; bu, ağaçtaki TÜM
 * jiraTasks'ları tek istekte tarar — kimse drawer'ı açmasa bile Jira'da statü
 * değişikliği fark edilsin diye (bkz. CLAUDE.md → "Flowscope: Jira durumu →
 * otomatik 'Hatalı'"). Tetikleyici: attention-view.js'daki "Tara" düğmesi.
 *
 * Sunucu ağacı DOĞRUDAN diskte değiştirebildiği için (flagged.length>0 ise),
 * bir şey değiştiyse istemcinin bellekteki kopyası `reloadPersistedTree()` ile
 * tazelenir — yoksa ekran, diskteki gerçek durumla senkron kalmaz.
 *
 * @returns {{scannedNodes:number, flagged:string[], reviewSuggested:{nodeId:string,doneTaskIds:string[]}[]}|null}
 *   sunucuya ulaşılamazsa/token yoksa null (çağıran taraf "taranamadı" göstermeli).
 */
export async function runJiraSweep() {
  try {
    const res = await fetch('/api/scope/jira/sweep', {
      method: 'POST',
      headers: { 'x-panel-token': window.PANEL_TOKEN ?? '' },
    });
    const data = await res.json();
    if (!data.ok) return null;
    Object.assign(state.jiraStatusCache, data.statuses ?? {});
    if (data.flagged.length) await reloadPersistedTree();
    return { scannedNodes: data.scannedNodes, flagged: data.flagged, reviewSuggested: data.reviewSuggested };
  } catch (e) {
    return null;
  }
}

function buildJiraLiveBadge(taskId) {
  const info = state.jiraStatusCache[taskId];
  if (!info) return null;
  const badge = document.createElement('span');
  if (!info.found) {
    badge.className = 'drawer-jira-live-badge cat-missing';
    badge.textContent = 'Bulunamadı';
    return badge;
  }
  const catClass = { new: 'cat-new', indeterminate: 'cat-progress', done: 'cat-done' }[info.statusCategory] || 'cat-new';
  badge.className = 'drawer-jira-live-badge ' + catClass;
  badge.textContent = info.statusName || '—';
  if (info.summary) badge.title = info.summary;
  return badge;
}

// En az bir Jira Task ID'si var mı ve bunlardan en az biri Jira'da KESİN OLARAK "bulunamadı"
// damgalanmamış mı (yani ya doğrulanmış ya da henüz kontrol edilmemiş)? "Bulunamadı" onaylanan
// ID'ler zorunluluğu karşılamış sayılmaz — geçersiz bir ID'yle "gereklilik" kutusunun işaretli
// kalmasını istemiyoruz.
function hasUsableJiraTask(node) {
  return node.jiraTasks.some(t => {
    const info = state.jiraStatusCache[t.taskId];
    return !(info && info.found === false);
  });
}

export function renderDrawerJiraSection(node) {
  const section = document.createElement('div');
  section.className = 'drawer-section';

  const needsJira = node.status === '❌' && !hasUsableJiraTask(node);
  const label = document.createElement('div');
  label.className = 'drawer-section-label' + (needsJira ? ' drawer-section-label-danger' : '');
  label.innerHTML = ICON.jira + '<span>Jira Task ID’leri' + (needsJira ? ' (zorunlu)' : '') + '</span>'
    + (node.jiraTasks.length ? ` <span class="drawer-tab-count">${node.jiraTasks.length}</span>` : '');
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'drawer-jira-settings-btn';
  settingsBtn.title = 'Jira bağlantı adresini ayarla';
  settingsBtn.innerHTML = ICON.gear;
  settingsBtn.onclick = (e) => { e.stopPropagation(); openJiraUrlPrompt(settingsBtn); };
  label.appendChild(settingsBtn);
  section.appendChild(label);

  const addRow = document.createElement('div');
  addRow.className = 'drawer-jira-add';
  const input = document.createElement('input');
  input.className = 'drawer-input';
  input.placeholder = 'örn. PROJ-123';
  addRow.appendChild(input);
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Ekle';
  const inputError = document.createElement('div');
  inputError.className = 'drawer-jira-dup-error';
  inputError.style.display = 'none';
  const showInputError = (msg) => {
    inputError.textContent = msg;
    inputError.style.display = 'block';
    input.classList.add('drawer-input-error');
  };
  const clearInputError = () => {
    inputError.style.display = 'none';
    input.classList.remove('drawer-input-error');
  };
  const submit = async () => {
    const val = input.value.trim();
    if (!val) return;
    const isDuplicate = node.jiraTasks.some(t => t.taskId.trim().toLowerCase() === val.toLowerCase());
    if (isDuplicate) {
      showInputError('Bu Jira Task ID zaten eklenmiş.');
      return;
    }
    clearInputError();

    // Eklemeden önce ID'nin gerçekten Jira'da var olup olmadığını doğrula. Jira entegrasyonu
    // kurulu değilse veya doğrulama sırasında bir sorun çıkarsa (config eksik, ağ hatası vb.)
    // engellemiyoruz — sadece Jira kesin olarak "bulunamadı" derse eklemeyi reddediyoruz.
    addBtn.disabled = true;
    const originalLabel = addBtn.textContent;
    addBtn.textContent = 'Kontrol ediliyor…';
    try {
      const res = await fetch('/api/tracker/status?keys=' + encodeURIComponent(val));
      const data = await res.json();
      if (data.ok && data.statuses[val] && data.statuses[val].found === false) {
        showInputError('Bu Jira Task ID Jira’da bulunamadı. Geçerli bir ID girin.');
        addBtn.disabled = false;
        addBtn.textContent = originalLabel;
        return;
      }
    } catch (e) {
      // Doğrulama isteği başarısız oldu (ör. proxy kapalı) — Jira'nın kendisiyle ilgili bir
      // sorun olmadığından ekleme engellenmez.
    }
    addBtn.disabled = false;
    addBtn.textContent = originalLabel;

    node.jiraTasks.push({ id: newJiraId(), taskId: val, createdAt: new Date().toISOString(), analyses: [] });
    persist();
    renderDrawer();
    startJiraStatusPolling(node);
  };
  addBtn.onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.addEventListener('input', clearInputError);
  addRow.appendChild(addBtn);
  section.appendChild(addRow);
  section.appendChild(inputError);

  if (node.jiraTasks.length) {
    const liveBar = document.createElement('div');
    liveBar.className = 'drawer-jira-live-bar';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'drawer-jira-refresh-btn' + (state.jiraStatusLoading ? ' spinning' : '');
    refreshBtn.title = 'Jira durumunu şimdi yenile';
    refreshBtn.innerHTML = ICON.refresh;
    refreshBtn.disabled = state.jiraStatusLoading;
    refreshBtn.onclick = () => refreshJiraStatuses(node);
    liveBar.appendChild(refreshBtn);
    const liveText = document.createElement('span');
    liveText.className = 'drawer-jira-live-text' + (state.jiraStatusError ? ' is-error' : '');
    liveText.textContent = state.jiraStatusError
      || (state.jiraStatusLoading ? 'Jira durumu kontrol ediliyor…' : 'Jira durumları otomatik olarak ~60 sn’de bir güncellenir.');
    liveBar.appendChild(liveText);
    section.appendChild(liveBar);
  }

  const list = document.createElement('div');
  list.className = 'drawer-jira-list';
  if (!node.jiraTasks.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-jira-empty';
    empty.textContent = 'Henüz Jira Task ID eklenmedi.';
    list.appendChild(empty);
  } else {
    const sorted = [...node.jiraTasks].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    sorted.forEach(t => {
      const chip = document.createElement('div');
      chip.className = 'drawer-jira-chip';

      const main = document.createElement('div');
      main.className = 'drawer-jira-chip-main';
      const text = state.jiraBaseUrl ? document.createElement('a') : document.createElement('span');
      text.textContent = t.taskId;
      if (state.jiraBaseUrl) {
        text.href = state.jiraBaseUrl + t.taskId;
        text.target = '_blank';
        text.rel = 'noopener';
        text.className = 'drawer-jira-chip-link';
      }
      main.appendChild(text);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'drawer-jira-chip-remove';
      // "Hatalı" durumda en az bir Jira Task ID zorunlu — eklerken bunu zaten dayatıyoruz,
      // o yüzden geriye dönük olarak son kaydı silip bu kuralı delmeye de izin vermiyoruz.
      const isLastRequired = node.status === '❌' && node.jiraTasks.length === 1;
      removeBtn.disabled = isLastRequired;
      removeBtn.title = isLastRequired
        ? 'Hatalı durumdaki bir kart için en az bir Jira Task ID gerekir — önce durumu değiştirin ya da başka bir ID ekleyin.'
        : 'Kaldır';
      removeBtn.innerHTML = ICON.close;
      removeBtn.onclick = () => {
        if (isLastRequired) return;
        node.jiraTasks = node.jiraTasks.filter(x => x.id !== t.id);
        persist();
        renderDrawer();
        startJiraStatusPolling(node);
      };
      const badge = buildJiraLiveBadge(t.taskId);
      if (badge) main.appendChild(badge);
      main.appendChild(removeBtn);
      chip.appendChild(main);

      const date = document.createElement('div');
      date.className = 'drawer-jira-chip-date';
      date.textContent = t.createdAt ? formatNoteDate(t.createdAt) : '';
      chip.appendChild(date);

      list.appendChild(chip);
    });
  }
  section.appendChild(list);

  const hint = document.createElement('div');
  hint.className = 'drawer-hint';
  hint.textContent = 'Bu öğe "Hatalı" olarak işaretli olduğu sürece en az bir Jira Task ID gerekir. '
    + 'Eklenen bir Task ID Jira’da "Tamamlandı" değilse kart otomatik olarak "Hatalı"ya çekilir '
    + '(Jira "Tamamlandı" olduğunda kart kendiliğinden geri alınmaz — bu bir insan kararıdır).';
  section.appendChild(hint);

  return section;
}

// CSS sınıf adlarında Türkçe karakter/aksan kullanmaktan kaçınmak için durum -> ASCII eşlemesi.
const ANALYSIS_STATUS_CLASS = { beklemede: 'pending', 'onaylandı': 'approved', reddedildi: 'rejected' };

export function addJiraAnalysis(node, jiraTask, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  jiraTask.analyses.push({
    id: newJiraAnalysisId(), text: trimmed, createdAt: new Date().toISOString(),
    status: 'beklemede', jiraCommentPostedAt: null, jiraCommentError: null
  });
  persist();
  renderDrawer();
}

export function removeJiraAnalysis(node, jiraTask, analysisId) {
  jiraTask.analyses = jiraTask.analyses.filter(a => a.id !== analysisId);
  persist();
  renderDrawer();
}

export function rejectJiraAnalysis(node, jiraTask, analysisId) {
  const a = jiraTask.analyses.find(x => x.id === analysisId);
  if (!a) return;
  a.status = 'reddedildi';
  a.jiraCommentError = null;
  persist();
  renderDrawer();
}

// Kullanıcının "Onayla" tıklamasıyla tetiklenir — Jira'ya gerçek bir yorum POST edilir.
// Bu, dışarıya görünür/geri alınamaz bir eylem olduğu için hiçbir yerde otomatik çağrılmaz.
export async function approveJiraAnalysis(node, jiraTask, analysisId, btn) {
  const a = jiraTask.analyses.find(x => x.id === analysisId);
  if (!a) return;
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor…'; }
  try {
    const res = await fetch('/api/tracker/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
      body: JSON.stringify({ key: jiraTask.taskId, text: a.text })
    });
    const data = await res.json();
    if (data.ok) {
      a.status = 'onaylandı';
      a.jiraCommentPostedAt = new Date().toISOString();
      a.jiraCommentError = null;
    } else {
      a.jiraCommentError = data.error || 'Jira’ya gönderilemedi.';
    }
  } catch (e) {
    a.jiraCommentError = 'Panel sunucusuna ulaşılamadı.';
  }
  if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  persist();
  renderDrawer();
}

export function renderDrawerJiraAnalysesSection(node) {
  const section = document.createElement('div');
  section.className = 'drawer-section';

  const label = document.createElement('div');
  label.className = 'drawer-section-label';
  const totalAnalyses = node.jiraTasks.reduce((sum, t) => sum + t.analyses.length, 0);
  label.innerHTML = ICON.history + '<span>İncelemeler</span>'
    + (totalAnalyses ? ` <span class="drawer-tab-count">${totalAnalyses}</span>` : '');
  section.appendChild(label);

  if (!node.jiraTasks.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-jira-empty';
    empty.textContent = 'Önce en az bir Jira Task ID ekleyin, incelemeler ona bağlı olarak tutulur.';
    section.appendChild(empty);
    return section;
  }

  const sorted = [...node.jiraTasks].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  sorted.forEach(t => {
    const group = document.createElement('div');
    group.className = 'jira-analysis-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'jira-analysis-group-title';
    groupTitle.textContent = t.taskId;
    group.appendChild(groupTitle);

    const list = document.createElement('div');
    list.className = 'jira-analysis-list';
    if (!t.analyses.length) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'jira-analysis-empty';
      emptyItem.textContent = 'Henüz inceleme eklenmedi.';
      list.appendChild(emptyItem);
    } else {
      const sortedAnalyses = [...t.analyses].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      sortedAnalyses.forEach(a => {
        const statusClass = ANALYSIS_STATUS_CLASS[a.status] || 'pending';
        const item = document.createElement('div');
        item.className = 'jira-analysis-item status-' + statusClass;

        const statusRow = document.createElement('div');
        statusRow.className = 'jira-analysis-item-status';
        const badge = document.createElement('span');
        badge.className = 'jira-analysis-status-badge status-' + statusClass;
        badge.textContent = { beklemede: 'Onay Bekliyor', onaylandı: 'Onaylandı · Jira’ya gönderildi', reddedildi: 'Reddedildi' }[a.status] || a.status;
        statusRow.appendChild(badge);
        item.appendChild(statusRow);

        const text = document.createElement('div');
        text.className = 'jira-analysis-item-text';
        text.textContent = a.text;
        item.appendChild(text);

        if (a.jiraCommentError) {
          const err = document.createElement('div');
          err.className = 'jira-analysis-item-error';
          err.textContent = a.jiraCommentError;
          item.appendChild(err);
        }

        if (a.status === 'beklemede') {
          const actions = document.createElement('div');
          actions.className = 'jira-analysis-item-actions';
          const approveBtn = document.createElement('button');
          approveBtn.type = 'button';
          approveBtn.className = 'btn btn-primary';
          approveBtn.textContent = a.jiraCommentError ? 'Tekrar Gönder' : 'Onayla ve Jira’ya Gönder';
          approveBtn.onclick = () => approveJiraAnalysis(node, t, a.id, approveBtn);
          actions.appendChild(approveBtn);
          const rejectBtn = document.createElement('button');
          rejectBtn.type = 'button';
          rejectBtn.className = 'btn btn-danger';
          rejectBtn.textContent = 'Reddet';
          rejectBtn.onclick = () => rejectJiraAnalysis(node, t, a.id);
          actions.appendChild(rejectBtn);
          item.appendChild(actions);
        }

        const meta = document.createElement('div');
        meta.className = 'jira-analysis-item-meta';
        const date = document.createElement('span');
        date.textContent = a.createdAt ? formatNoteDate(a.createdAt) : '';
        meta.appendChild(date);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'jira-analysis-item-remove';
        removeBtn.title = 'İncelemeyi kaldır (yalnızca yerel kaydı siler)';
        removeBtn.innerHTML = ICON.close;
        removeBtn.onclick = () => removeJiraAnalysis(node, t, a.id);
        meta.appendChild(removeBtn);
        item.appendChild(meta);
        list.appendChild(item);
      });
    }
    group.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'jira-analysis-add';
    const textarea = document.createElement('textarea');
    textarea.className = 'jira-analysis-add-input';
    textarea.placeholder = 'Bu göreve ait inceleme ekle…';
    textarea.rows = 2;
    addRow.appendChild(textarea);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Ekle';
    addBtn.onclick = () => {
      if (!textarea.value.trim()) return;
      addJiraAnalysis(node, t, textarea.value);
    };
    addRow.appendChild(addBtn);
    group.appendChild(addRow);

    section.appendChild(group);
  });

  return section;
}
