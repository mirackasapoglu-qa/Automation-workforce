// Paketler — GÖRÜNÜM katmanı. Veri/model kuralları packages-data.js'te, gerçek
// koşumu tetikleyen motor packages-run.js'te; burada yalnızca DOM kurulumu ve
// bu iki katmanın çağrılması var.
//
// Paketler: kullanıcının test case'leri gruplamak için oluşturduğu adlandırılmış
// koleksiyonlar (ör. "Regresyon paketi", "Validasyon paketi"). Bir paket başka
// paketleri de içerebilir ("x paketi y'nin içinden çağrılabilir") — bkz.
// packages-data.js'teki isPackageRefItem notu.
import { state } from './state.js';
import { ICON, STATUS_META } from './constants.js';
import { findNode, isTestCaseRunStale, DEFAULT_STALE_DAYS, effectiveTestCaseStatus } from './data.js';
import { formatNoteDate } from './notes.js';
import { uiConfirm, uiToast } from './dialog.js';
import { renderContent } from './shell.js';
import { openDrawer } from './drawer.js';
import {
  nowIso, validatePackageName, createPackage, deletePackage, renamePackage, setPackageDescription,
  addTestCaseToPackage, removeItemFromPackage, addPackageToPackage, clonePackage,
  resolvePackageItem, allTestCases, isPackageRefItem, canNestPackage,
  collectEffectiveTestCaseItems, dedupeTestCaseItems, computePackageStats, recordPackageRun,
} from './packages-data.js';
import { runPackage } from './packages-run.js';

export { loadPackages } from './packages-data.js';

const MAX_CANDIDATES_SHOWN = 60;

function renderPackageStats(pkg) {
  const stats = computePackageStats(pkg);
  const wrap = document.createElement('div');
  wrap.className = 'pkg-stats';
  ['✅', '🔵', '⚠️', '❌', '⬜'].forEach((key) => {
    const meta = STATUS_META[key];
    const chip = document.createElement('span');
    chip.className = 'pkg-stat-chip';
    chip.title = meta.label;
    const dot = document.createElement('span');
    dot.className = 'pkg-stat-dot';
    dot.style.setProperty('--tile-color', meta.colorVar);
    chip.append(dot, document.createTextNode(String(stats[key])));
    wrap.appendChild(chip);
  });
  if (stats.ghosts) {
    const ghostChip = document.createElement('span');
    ghostChip.className = 'pkg-stat-chip pkg-stat-ghost';
    ghostChip.textContent = `${stats.ghosts} kaynağı silinmiş`;
    wrap.appendChild(ghostChip);
  }
  return wrap;
}

/**
 * Bir test case satırına tıklayınca ilgili düğümün drawer'ını açar — Paketler
 * sayfasından HİÇ ayrılmadan (attention-view.js → goToNode() ile AYNI desen:
 * drawer state.root'a bağımsız bir katman olarak ekleniyor, hangi görünümde
 * olduğunu bilmiyor/önemsemiyor). Ağaç'a geçmek kullanıcının bulunduğu sayfayı
 * kaybettirirdi; drawer zaten üst bilgide "SAYFA · Homee › ..." gibi tam yolu
 * gösteriyor, ayrıca bir "ağaçta aç" gerekmiyor.
 */
function jumpToNode(node) {
  openDrawer(node);
}

export function renderPackagesView() {
  const wrap = document.createElement('div');
  wrap.className = 'pkg-view';

  let openPkg = null;
  if (state.openPackageId) {
    openPkg = state.packages.find((p) => p.id === state.openPackageId) || null;
    if (!openPkg) state.openPackageId = null; // paket silinmiş olabilir — listeye düş
  }

  wrap.appendChild(openPkg ? renderPackageDetail(openPkg) : renderPackageList());
  return wrap;
}

function renderPackageList() {
  const wrap = document.createElement('div');
  wrap.className = 'pkg-list-page';

  const header = document.createElement('div');
  header.className = 'pkg-page-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Paketler';
  const p = document.createElement('p');
  p.textContent = "Test case'leri regresyon, validasyon gibi kendi koleksiyonlarında grupla.";
  header.append(h2, p);
  wrap.appendChild(header);

  wrap.appendChild(buildCreateArea());

  if (!state.packages.length) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Henüz paket yok. Başlamak için "+ Yeni paket" butonuna tıkla.';
    wrap.appendChild(empty);
    return wrap;
  }

  // Paket sayısı arttıkça grid'de gözle taramak zorlaşıyor — ad/açıklamaya göre
  // düz metin araması (bkz. data.js'in tree araması, aynı basit .toLowerCase deseni).
  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-box pkg-list-search';
  searchWrap.innerHTML = ICON.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Paket ara...';
  searchInput.value = state.packageListQuery;
  searchWrap.appendChild(searchInput);
  wrap.appendChild(searchWrap);

  // Sonuçlar kendi sabit kabında güncelleniyor — arama kutusu dahil TÜM
  // sayfayı yeniden kurmak (renderContent()) her tuşta hem odağı kaybettiriyor
  // hem de .fw-content'in giriş animasyonunu (fwFadeIn) yeniden oynatıp
  // sayfayı "zıplatıyordu" (ölçüldü — 100+ kez/gün olan bir etkileşimde
  // animasyon hiç olmamalı). Filtre değiştikçe sadece bu kap güncellenir.
  const resultsHolder = document.createElement('div');
  wrap.appendChild(resultsHolder);

  function renderResults() {
    const q = state.packageListQuery.trim().toLowerCase();
    const filtered = q
      ? state.packages.filter((pkg) => pkg.name.toLowerCase().includes(q) || (pkg.description || '').toLowerCase().includes(q))
      : state.packages;

    resultsHolder.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'board-col-empty';
      empty.textContent = 'Aramayla eşleşen paket yok.';
      resultsHolder.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'pkg-grid';
    filtered.forEach((pkg) => grid.appendChild(renderPackageCard(pkg)));
    resultsHolder.appendChild(grid);
  }

  searchInput.oninput = (e) => { state.packageListQuery = e.target.value; renderResults(); };
  renderResults();
  return wrap;
}

/**
 * "+ Yeni paket" artık DİREKT oluşturmuyor — adı önce sorulur, "Oluştur"a
 * basınca (ya da Enter'a) gerçekten oluşur. Bir tree node eklemekten farklı:
 * burada isim baştan anlamlı olsun isteniyor, sonradan yeniden adlandırma değil.
 */
function buildCreateArea() {
  const holder = document.createElement('div');
  holder.className = 'pkg-create-holder';

  function showButton() {
    holder.replaceChildren();
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary pkg-add-btn';
    addBtn.innerHTML = ICON.plus + '<span>Yeni paket</span>';
    addBtn.onclick = showForm;
    holder.appendChild(addBtn);
  }

  function showForm() {
    holder.replaceChildren();
    const form = document.createElement('form');
    form.className = 'pkg-create-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pkg-create-input';
    input.placeholder = 'Paket adı — ör. Regresyon Paketi';

    const createBtn = document.createElement('button');
    createBtn.type = 'submit';
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = 'Oluştur';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'icon-btn';
    cancelBtn.innerHTML = ICON.close;
    cancelBtn.title = 'Vazgeç';
    cancelBtn.onclick = showButton;

    form.append(input, createBtn, cancelBtn);

    const error = document.createElement('div');
    error.className = 'pkg-inline-error';
    error.hidden = true;

    form.onsubmit = (e) => {
      e.preventDefault();
      const msg = validatePackageName(input.value, null);
      if (msg) {
        input.classList.add('pkg-input-invalid');
        error.textContent = msg;
        error.hidden = false;
        return;
      }
      createPackage(input.value);
      renderContent();
    };
    input.addEventListener('input', () => {
      input.classList.remove('pkg-input-invalid');
      error.hidden = true;
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') showButton(); });

    holder.append(form, error);
    input.focus();
  }

  showButton();
  return holder;
}

function renderPackageCard(pkg) {
  const card = document.createElement('div');
  card.className = 'pkg-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const icon = document.createElement('div');
  icon.className = 'pkg-card-icon';
  icon.innerHTML = ICON.package;
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'pkg-card-body';
  const name = document.createElement('div');
  name.className = 'pkg-card-name';
  name.textContent = pkg.name || 'İsimsiz paket';
  const meta = document.createElement('div');
  meta.className = 'pkg-card-meta';
  const nestedCount = pkg.items.filter(isPackageRefItem).length;
  meta.textContent = `${computePackageStats(pkg).total} test case`
    + (nestedCount ? ` · ${nestedCount} paket dahil` : '')
    + ` · ${formatNoteDate(pkg.updatedAt)}`;
  body.append(name, meta, renderPackageStats(pkg));
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'pkg-card-actions';

  const cloneBtn = document.createElement('button');
  cloneBtn.type = 'button';
  cloneBtn.className = 'icon-btn';
  cloneBtn.innerHTML = ICON.copy;
  cloneBtn.title = 'Paketi kopyala';
  cloneBtn.onclick = (e) => { e.stopPropagation(); clonePackage(pkg); renderContent(); };
  actions.appendChild(cloneBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn icon-btn-danger';
  delBtn.innerHTML = ICON.trash;
  delBtn.title = 'Paketi sil';
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    const ok = await uiConfirm(
      `"${pkg.name}" paketini silmek istediğine emin misin? Bu, içindeki test case'lerin kendisini silmez — sadece bu koleksiyondan çıkarır.`,
      { title: 'Paketi sil', ok: 'Sil' },
    );
    if (!ok) return;
    deletePackage(pkg.id);
    renderContent();
  };
  actions.appendChild(delBtn);
  card.appendChild(actions);

  const open = () => { state.openPackageId = pkg.id; renderContent(); };
  card.onclick = open;
  card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };

  return card;
}

function renderPackageDetail(pkg) {
  const wrap = document.createElement('div');
  wrap.className = 'pkg-detail';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pkg-back';
  backBtn.innerHTML = ICON.back + '<span>Paketler</span>';
  backBtn.onclick = () => { state.openPackageId = null; renderContent(); };
  wrap.appendChild(backBtn);

  const head = document.createElement('div');
  head.className = 'pkg-detail-head';

  const nameField = document.createElement('div');
  nameField.className = 'pkg-name-field';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'pkg-name-input';
  nameInput.value = pkg.name;
  nameInput.placeholder = 'Paket adı';
  const nameError = document.createElement('div');
  nameError.className = 'pkg-inline-error';
  nameError.hidden = true;
  // Geçersizken (boş / başka bir paketle aynı isim) KAYDEDİLMEZ — diskteki son
  // geçerli isim korunur, kullanıcı düzeltene kadar hata görünür kalır.
  nameInput.oninput = () => {
    const msg = validatePackageName(nameInput.value, pkg.id);
    nameInput.classList.toggle('pkg-input-invalid', Boolean(msg));
    nameError.textContent = msg || '';
    nameError.hidden = !msg;
    if (msg) return;
    renamePackage(pkg, nameInput.value);
  };
  nameField.append(nameInput, nameError);
  head.appendChild(nameField);

  const descInput = document.createElement('textarea');
  descInput.className = 'pkg-desc-input';
  descInput.rows = 2;
  descInput.value = pkg.description || '';
  descInput.placeholder = 'Açıklama (opsiyonel) — ör. hangi durumda koşulur';
  descInput.oninput = () => setPackageDescription(pkg, descInput.value);
  head.appendChild(descInput);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger pkg-delete';
  deleteBtn.innerHTML = ICON.trash + '<span>Paketi sil</span>';
  deleteBtn.onclick = async () => {
    const ok = await uiConfirm(`"${pkg.name}" paketini silmek istediğine emin misin?`, { title: 'Paketi sil', ok: 'Sil' });
    if (!ok) return;
    deletePackage(pkg.id);
    state.openPackageId = null;
    renderContent();
  };

  const cloneBtn = document.createElement('button');
  cloneBtn.type = 'button';
  cloneBtn.className = 'btn pkg-clone';
  cloneBtn.innerHTML = ICON.copy + '<span>Paketi kopyala</span>';
  cloneBtn.onclick = () => {
    const clone = clonePackage(pkg);
    state.openPackageId = clone.id;
    renderContent();
  };
  head.append(cloneBtn, deleteBtn);
  wrap.appendChild(head);

  wrap.appendChild(buildRunSection(pkg));
  wrap.appendChild(renderPackageRunHistory(pkg));

  // `pkg.items` iki tür referans karışık tutar (bkz. packages-data.js →
  // isPackageRefItem) — ama KARIŞIK gösterilmez: hangi kapsamın nereden
  // geldiği belli olsun diye iki ayrı bölüm. `idx` her iki grupta da
  // pkg.items'taki GERÇEK indeks (silme ondan çalışıyor, filtrelenmiş
  // dizideki sıradan değil).
  const indexed = pkg.items.map((item, idx) => ({ item, idx }));
  const testCaseEntries = indexed.filter(({ item }) => !isPackageRefItem(item));
  const packageRefEntries = indexed.filter(({ item }) => isPackageRefItem(item));

  wrap.appendChild(buildTestCaseSection(pkg, testCaseEntries));
  wrap.appendChild(buildNestedPackagesSection(pkg, packageRefEntries));
  wrap.appendChild(buildAddPackageSection(pkg));
  wrap.appendChild(buildAddTestCaseSection(pkg));

  return wrap;
}

/** Paketin doğrudan test case'lerinin listesi ("Mevcut test case'ler"). */
function buildTestCaseSection(pkg, testCaseEntries) {
  const section = document.createElement('div');
  section.className = 'pkg-section';
  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = `Test case'ler (${testCaseEntries.length})`;
  section.append(label, renderPackageStats(pkg));

  if (!testCaseEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Henüz test case eklenmedi. Aşağıdan arayıp ekleyebilirsin.';
    section.appendChild(empty);
  } else {
    testCaseEntries.forEach(({ item, idx }) => section.appendChild(renderPackageItemRow(pkg, item, idx)));
  }
  return section;
}

/**
 * "İçerdiği paketler" — "x paketi y'nin içinden çağrılabilir" burada. Her
 * satır tıklanabilir kendi paketi olarak kalır (test case'lerine "eritilip"
 * yukarıdaki listeye karışmaz) — kullanıcı kapsamın nereden geldiğini
 * görebilsin, gerekirse içine girip düzenleyebilsin diye (bkz.
 * renderPackageRefRow). Koşum/durum özeti (buildTestCaseSection'daki stats,
 * "Paketi Çalıştır") ise bunları özyinelemeli olarak KENDİ kapsamına katıyor.
 */
function buildNestedPackagesSection(pkg, packageRefEntries) {
  const section = document.createElement('div');
  section.className = 'pkg-section';
  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = `İçerdiği paketler (${packageRefEntries.length})`;
  section.appendChild(label);

  if (!packageRefEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Henüz başka paket eklenmedi. Aşağıdan arayıp ekleyebilirsin.';
    section.appendChild(empty);
  } else {
    packageRefEntries.forEach(({ item, idx }) => section.appendChild(renderPackageRefRow(pkg, item, idx)));
  }
  return section;
}

/** "Paket ekle" — arayıp iç içe paket referansı ekleme. */
function buildAddPackageSection(pkg) {
  const section = document.createElement('div');
  section.className = 'pkg-section';
  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = 'Paket ekle';
  section.appendChild(label);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-box pkg-search';
  searchWrap.innerHTML = ICON.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Paket adıyla ara...';
  searchInput.value = state.packageNestSearchQuery;
  searchWrap.appendChild(searchInput);
  section.appendChild(searchWrap);

  // Aynı gerekçeyle (bkz. renderPackageList → renderResults): aday listesi
  // kendi sabit kabında güncellenir, arama kutusu ve giriş animasyonu her
  // tuşta yeniden kurulmaz.
  const candidateHolder = document.createElement('div');
  candidateHolder.className = 'pkg-candidate-list';
  section.appendChild(candidateHolder);

  function renderCandidates() {
    // Kendisi, zaten eklenenler VE çevrim oluşturacaklar hiç LİSTELENMEZ —
    // geçersiz bir seçeneği gösterip tıklayınca reddetmek yerine baştan
    // görünmez (bkz. packages-data.js → canNestPackage).
    const candidates = state.packages.filter((p) =>
      p.id !== pkg.id
      && !pkg.items.some((it) => it.packageId === p.id)
      && canNestPackage(pkg, p.id));
    const q = state.packageNestSearchQuery.trim().toLowerCase();
    const filtered = q ? candidates.filter((p) => p.name.toLowerCase().includes(q)) : candidates;

    candidateHolder.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'board-col-empty';
      empty.textContent = q ? 'Eşleşen paket yok.' : 'Eklenebilir başka paket yok.';
      candidateHolder.appendChild(empty);
      return;
    }
    filtered.forEach((p) => candidateHolder.appendChild(renderPackageCandidateRow(pkg, p)));
  }

  searchInput.oninput = (e) => { state.packageNestSearchQuery = e.target.value; renderCandidates(); };
  renderCandidates();
  return section;
}

/** "Test case ekle" — arayıp doğrudan test case referansı ekleme. */
function buildAddTestCaseSection(pkg) {
  const section = document.createElement('div');
  section.className = 'pkg-section';
  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = 'Test case ekle';
  section.appendChild(label);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-box pkg-search';
  searchWrap.innerHTML = ICON.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Test case veya sayfa adıyla ara...';
  searchInput.value = state.packageSearchQuery;
  searchWrap.appendChild(searchInput);
  section.appendChild(searchWrap);

  // Aynı gerekçeyle (bkz. renderPackageList → renderResults): aday listesi
  // kendi sabit kabında güncellenir, arama kutusu ve giriş animasyonu her
  // tuşta yeniden kurulmaz.
  const candidateHolder = document.createElement('div');
  candidateHolder.className = 'pkg-candidate-list';
  section.appendChild(candidateHolder);

  function renderCandidates() {
    const candidates = allTestCases(state.tree)
      .filter((c) => !pkg.items.some((it) => it.nodeId === c.nodeId && it.testCaseId === c.testCase.id));
    const q = state.packageSearchQuery.trim().toLowerCase();
    const filtered = q
      ? candidates.filter((c) => (c.testCase.title || '').toLowerCase().includes(q) || c.nodeName.toLowerCase().includes(q))
      : candidates;

    candidateHolder.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'board-col-empty';
      empty.textContent = q ? 'Eşleşen test case yok.' : 'Ağaçta hiç test case yok.';
      candidateHolder.appendChild(empty);
      return;
    }
    filtered.slice(0, MAX_CANDIDATES_SHOWN).forEach((c) => candidateHolder.appendChild(renderCandidateRow(pkg, c)));
    if (filtered.length > MAX_CANDIDATES_SHOWN) {
      const more = document.createElement('div');
      more.className = 'pkg-candidate-more';
      more.textContent = `+${filtered.length - MAX_CANDIDATES_SHOWN} sonuç daha — daraltmak için ara`;
      candidateHolder.appendChild(more);
    }
  }

  searchInput.oninput = (e) => { state.packageSearchQuery = e.target.value; renderCandidates(); };
  renderCandidates();
  return section;
}

/**
 * "Paketi Çalıştır" popup'ı. Eskiden koşum sürerken tek görünen şey sayfanın
 * kendi içindeki küçük bir ilerleme satırıydı — kullanıcı "gerçekten bir şey
 * oluyor mu" sorusunu sorabiliyordu. Bu popup ekranın ortasına oturur, paketin
 * her sayfasını bekliyor→koşuyor (dönen ikon)→bitti (✅/❌/atlandı) olarak
 * canlı gösterir. `drawer.js → renderDrawer()` ile AYNI desen: `state.root`'a
 * doğrudan eklenir, `state.currentView`'dan bağımsızdır — `renderContent()`
 * `.fw-content`'i yeniden kursa da popup etkilenmez.
 *
 * @returns {{setStatus, setRowRunning, setRowDone, setRowSkipped, showDone, disableStop, destroy, destroyed}}
 */
function openPackageRunModal(pkg, nodes, { onStop } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'pkgrun-overlay';
  const modal = document.createElement('div');
  modal.className = 'pkgrun-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  overlay.appendChild(modal);

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === 'Escape') destroy(); }
  overlay.onclick = (e) => { if (e.target === overlay) destroy(); };
  document.addEventListener('keydown', onKeydown);

  const head = document.createElement('div');
  head.className = 'pkgrun-head';
  const headText = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'pkgrun-title';
  title.textContent = 'Paket çalıştırılıyor';
  const sub = document.createElement('div');
  sub.className = 'pkgrun-sub';
  sub.textContent = pkg.name;
  headText.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Kapat (koşum arka planda sürer)';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = destroy;
  head.append(headText, closeBtn);
  modal.appendChild(head);

  const spinnerWrap = document.createElement('div');
  spinnerWrap.className = 'pkgrun-spinner-wrap';
  const ring = document.createElement('div');
  ring.className = 'pkgrun-ring';
  spinnerWrap.appendChild(ring);
  modal.appendChild(spinnerWrap);

  const statusLine = document.createElement('div');
  statusLine.className = 'pkgrun-status-line';
  statusLine.textContent = 'Başlatılıyor…';
  modal.appendChild(statusLine);

  const list = document.createElement('div');
  list.className = 'pkgrun-list';
  const rows = new Map();
  nodes.forEach((node) => {
    const row = document.createElement('div');
    row.className = 'pkgrun-row';
    const icon = document.createElement('span');
    icon.className = 'pkgrun-row-icon';
    icon.textContent = '·';
    const name = document.createElement('span');
    name.className = 'pkgrun-row-name';
    name.textContent = node.name;
    const note = document.createElement('span');
    note.className = 'pkgrun-row-note';
    row.append(icon, name, note);
    list.appendChild(row);
    rows.set(node.id, { row, icon, note });
  });
  modal.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'pkgrun-actions';
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn btn-danger';
  stopBtn.textContent = 'Durdur';
  stopBtn.onclick = () => { stopBtn.disabled = true; statusLine.textContent = 'Durduruluyor…'; onStop?.(); };
  actions.appendChild(stopBtn);
  modal.appendChild(actions);

  state.root.appendChild(overlay);

  return {
    get destroyed() { return destroyed; },
    setStatus(text) { statusLine.textContent = text; },
    setRowRunning(nodeId) {
      const r = rows.get(nodeId);
      if (!r) return;
      r.row.className = 'pkgrun-row is-active';
      r.icon.innerHTML = ICON.refresh;
    },
    setRowDone(nodeId, result) {
      const r = rows.get(nodeId);
      if (!r) return;
      const failed = result.entries.some((e) => e.status === '❌');
      r.row.className = 'pkgrun-row is-done' + (failed ? ' is-fail' : '');
      r.icon.textContent = failed ? '❌' : (result.entries[0]?.status || '✅');
      r.note.textContent = result.entries.map((e) => e.note.split('\n')[0]).join(' · ');
    },
    setRowSkipped(nodeId, reason) {
      const r = rows.get(nodeId);
      if (!r) return;
      r.row.className = 'pkgrun-row is-skip';
      r.icon.textContent = '—';
      r.note.textContent = reason;
    },
    disableStop() { stopBtn.disabled = true; },
    showDone({ ok, summaryText }) {
      const doneIcon = document.createElement('div');
      doneIcon.className = 'pkgrun-done-icon';
      doneIcon.textContent = ok ? '✅' : '❌';
      ring.replaceWith(doneIcon);
      statusLine.textContent = summaryText;
      stopBtn.textContent = 'Kapat';
      stopBtn.className = 'btn btn-primary';
      stopBtn.disabled = false;
      stopBtn.onclick = destroy;
    },
    destroy,
  };
}

/**
 * "Paketi Çalıştır" bölümü — paketteki farklı sayfaların GERÇEK, whitelist'li
 * koşumlarını sırayla tetikler (bkz. packages-run.js → runPackage). Tıklamadan
 * ÖNCE hangi sayfaların koşulacağını ve kaçının otomatik koşumu olmadığı için
 * atlanacağını gösterir — sessiz bir "hiçbir şey olmadı" durumu yaşanmasın.
 */
function buildRunSection(pkg) {
  const sec = document.createElement('div');
  sec.className = 'pkg-section';

  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = 'Paketi çalıştır';
  sec.appendChild(label);

  const nodes = [...new Set(dedupeTestCaseItems(collectEffectiveTestCaseItems(pkg)).map((it) => it.nodeId))]
    .map((id) => findNode(state.tree, id))
    .filter(Boolean);
  const runnable = nodes.filter((n) => n.runRef?.runId);
  const notRunnable = nodes.filter((n) => !n.runRef?.runId);

  const info = document.createElement('div');
  info.className = 'pkg-run-info';
  info.textContent = !nodes.length
    ? 'Pakette koşulacak bir sayfa yok.'
    : `${runnable.length} sayfa koşulacak` + (notRunnable.length ? ` · ${notRunnable.length} sayfada otomatik koşum tanımlı değil` : '');
  sec.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'pkg-run-actions';

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'btn btn-primary';
  runBtn.innerHTML = ICON.play + '<span>Paketi Çalıştır</span>';
  runBtn.disabled = !runnable.length;
  actions.appendChild(runBtn);

  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn btn-danger';
  stopBtn.textContent = 'Durdur';
  stopBtn.hidden = true;
  actions.appendChild(stopBtn);
  sec.appendChild(actions);

  // İkon ayrı bir düğüm — ilerleme metni her adımda değişiyor, tek innerHTML
  // ile ikonu da yeniden yazsaydık dönme animasyonu her adımda sıfırlanıp
  // görsel olarak "takılıyor" gibi görünürdü (bkz. bu dosyadaki arama kutusu
  // dersi: canlı güncellenen kısmı ayrı tut, sabit kalanı yeniden kurma).
  const progress = document.createElement('div');
  progress.className = 'pkg-run-progress';
  progress.hidden = true;
  const progressIcon = document.createElement('span');
  progressIcon.className = 'pkg-run-spin-icon';
  progressIcon.innerHTML = ICON.refresh;
  const progressText = document.createElement('span');
  progress.append(progressIcon, progressText);
  sec.appendChild(progress);

  // "Durdur" hem popup'taki hem sayfadaki buton tarafından tetiklenir — tek
  // kod yolu (bkz. openPackageRunModal'ın onStop callback'i). stopFlag her
  // koşumda taze bir nesne: runPackage döngüsü her adım başında (ve her
  // düğüm bitiminde) bunu kontrol edip PAKETİN TAMAMINI durdurur.
  let stopFlag = null;
  let activeModal = null;
  const requestStop = async () => {
    if (stopFlag) stopFlag.requested = true;
    stopBtn.disabled = true;
    activeModal?.disableStop();
    progressText.textContent = 'Durduruluyor…';
    activeModal?.setStatus('Durduruluyor…');
    try {
      await fetch('/api/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
        body: JSON.stringify({ all: false }),
      });
    } catch { /* istek gitmese de mevcut koşum kendi bitene kadar akış sürer */ }
  };
  stopBtn.onclick = requestStop;

  runBtn.onclick = async () => {
    const ok = await uiConfirm(
      `${runnable.length} sayfa sırayla koşulacak — panel aynı anda tek koşum çalıştırabildiği için biri bitmeden diğeri başlamaz, sürebilir. Devam edilsin mi?`,
      { title: 'Paketi çalıştır', ok: 'Çalıştır', danger: false },
    );
    if (!ok) return;

    runBtn.disabled = true;
    runBtn.classList.add('is-running');
    runBtn.innerHTML = ICON.refresh + '<span>Koşuyor…</span>';
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    progress.hidden = false;
    progressText.textContent = 'Başlatılıyor…';

    stopFlag = { requested: false };
    activeModal = openPackageRunModal(pkg, nodes, { onStop: requestStop });

    const result = await runPackage(pkg, ({ done, total, node, phase, reason, result: nodeResult }) => {
      if (phase === 'running') {
        const text = `Koşuluyor: ${node.name} (${done + 1}/${total})`;
        progressText.textContent = text;
        activeModal.setStatus(text);
        activeModal.setRowRunning(node.id);
      } else if (phase === 'skipped' || phase === 'error') {
        progressText.textContent = `${node.name} — atlandı (${done}/${total})`;
        activeModal.setRowSkipped(node.id, reason);
      } else {
        progressText.textContent = `${node.name} — tamam (${done}/${total})`;
        activeModal.setRowDone(node.id, nodeResult);
      }
    }, stopFlag);

    recordPackageRun(pkg, {
      at: nowIso(),
      ranCount: result.ranNodeIds.length,
      skippedCount: result.skipped.length,
      stoppedEarly: result.stoppedEarly,
      nodeSummaries: result.nodeResults,
    });

    renderContent();

    const failedCount = result.nodeResults.filter((ns) => ns.ok && ns.entries.some((e) => e.status === '❌')).length;
    const allSkipped = result.skipped.length && !result.ranNodeIds.length;
    const parts = [];
    if (result.ranNodeIds.length) parts.push(`${result.ranNodeIds.length} sayfa koşuldu`);
    if (failedCount) parts.push(`${failedCount} sayfada hata`);
    if (result.skipped.length) parts.push(`${result.skipped.length} atlandı`);
    const summaryText = parts.join(' · ') || 'Koşum tamamlandı';
    const isOk = !(allSkipped || failedCount);

    // Popup hâlâ açıksa sonucu ORADA göster (zaten canlı takip ediliyordu) —
    // kapatılmışsa (kullanıcı X'e bastı, koşum arka planda sürdü) tek bildirim
    // kaynağı olarak toast'a düş, yoksa sonuç hiçbir yerde görünmez.
    if (activeModal.destroyed) {
      uiToast(summaryText, { type: isOk ? 'ok' : 'err', title: 'Paket koşumu bitti' });
    } else {
      activeModal.showDone({ ok: isOk, summaryText });
    }
    stopFlag = null;
    activeModal = null;
  };

  return sec;
}

/**
 * "Koşum geçmişi" — recordPackageRun'ın kalıcı hâle getirdiği koşumları en
 * yeniden eskiye listeler. buildRunSection'daki ilerleme metni koşum bitince
 * kayboluyordu; bu bölüm o sonucu sayfadan ayrılınca/panel yenilenince de
 * görünür tutar (bkz. packages-data.js → recordPackageRun).
 */
function renderPackageRunHistory(pkg) {
  const sec = document.createElement('div');
  sec.className = 'pkg-section';

  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = `Koşum geçmişi (${(pkg.runs || []).length})`;
  sec.appendChild(label);

  if (!pkg.runs?.length) {
    const empty = document.createElement('div');
    empty.className = 'pkg-run-info';
    empty.textContent = 'Henüz koşum yapılmadı.';
    sec.appendChild(empty);
    return sec;
  }

  const list = document.createElement('div');
  list.className = 'pkg-run-history';
  pkg.runs.forEach((run) => list.appendChild(renderPackageRunEntry(run)));
  sec.appendChild(list);
  return sec;
}

function renderPackageRunEntry(run) {
  const item = document.createElement('div');
  item.className = 'pkg-run-entry';

  const head = document.createElement('div');
  head.className = 'pkg-run-entry-head';
  const when = document.createElement('span');
  when.textContent = new Date(run.at).toLocaleString('tr-TR');
  const summary = document.createElement('span');
  summary.className = 'pkg-run-entry-summary';
  const parts = [];
  if (run.ranCount) parts.push(`${run.ranCount} sayfa koşuldu`);
  if (run.skippedCount) parts.push(`${run.skippedCount} atlandı`);
  if (run.stoppedEarly) parts.push('erken durduruldu');
  summary.textContent = parts.join(' · ') || 'sonuç yok';
  head.append(when, summary);
  item.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'pkg-run-entry-rows';
  (run.nodeSummaries || []).forEach((ns) => {
    if (!ns.ok) {
      const row = document.createElement('div');
      row.className = 'pkg-run-entry-row pkg-run-entry-skipped';
      row.textContent = `— ${ns.nodeName} — atlandı (${ns.reason})`;
      rows.appendChild(row);
      return;
    }
    if (!ns.entries.length) {
      const row = document.createElement('div');
      row.className = 'pkg-run-entry-row pkg-run-entry-skipped';
      row.textContent = `— ${ns.nodeName} — sonuç satırı yok`;
      rows.appendChild(row);
      return;
    }
    ns.entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'pkg-run-entry-row' + (e.status === '❌' ? ' pkg-run-entry-fail' : '');
      row.textContent = `${e.status} ${ns.nodeName} (${e.spec}) — ${e.note.split('\n')[0]}`;
      row.title = e.note; // DÜŞEN listesi vb. tam not — hover'da görünür
      rows.appendChild(row);
    });
  });
  item.appendChild(rows);
  return item;
}

function renderPackageItemRow(pkg, item, idx) {
  const { node, testCase } = resolvePackageItem(item);
  const row = document.createElement('div');
  row.className = 'pkg-item-row';

  if (!node || !testCase) {
    row.classList.add('pkg-item-ghost');
    const body = document.createElement('div');
    body.className = 'pkg-item-body';
    const title = document.createElement('div');
    title.className = 'pkg-item-title';
    title.textContent = 'Kaynağı silinmiş';
    const meta = document.createElement('div');
    meta.className = 'pkg-item-meta';
    meta.textContent = !node ? 'Bağlı sayfa/modül artık ağaçta yok' : 'Bu test case artık o sayfada yok';
    body.append(title, meta);
    row.appendChild(body);
  } else {
    const status = effectiveTestCaseStatus(testCase);
    const dot = document.createElement('span');
    dot.className = 'pkg-item-status';
    dot.style.setProperty('--tile-color', (STATUS_META[status] || STATUS_META['⬜']).colorVar);
    row.appendChild(dot);

    // Satır tıklanınca Ağaç'a geçip düğümün drawer'ını açar — sayfa adını görüp
    // elle aramak yerine direkt oraya gitmek için (bkz. jumpToNode).
    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'pkg-item-body pkg-item-jump';
    body.title = 'Ağaçta aç';
    const title = document.createElement('div');
    title.className = 'pkg-item-title';
    title.textContent = testCase.title || '(başlıksız test case)';
    if (isTestCaseRunStale(testCase)) {
      const stale = document.createElement('span');
      stale.className = 'testcase-stale-badge';
      stale.title = `Son koşum ${DEFAULT_STALE_DAYS} günden eski — tekrar koşturmayı düşün`;
      stale.textContent = ' · ⚠ bayat';
      title.appendChild(stale);
    }
    const meta = document.createElement('div');
    meta.className = 'pkg-item-meta';
    meta.textContent = node.name;
    body.append(title, meta);
    body.onclick = () => jumpToNode(node);
    row.appendChild(body);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.innerHTML = ICON.close;
  removeBtn.title = 'Paketten çıkar';
  removeBtn.onclick = () => { removeItemFromPackage(pkg, idx); renderContent(); };
  row.appendChild(removeBtn);

  return row;
}

function renderCandidateRow(pkg, c) {
  const row = document.createElement('div');
  row.className = 'pkg-item-row pkg-candidate-row';

  const body = document.createElement('div');
  body.className = 'pkg-item-body';
  const title = document.createElement('div');
  title.className = 'pkg-item-title';
  title.textContent = c.testCase.title || '(başlıksız test case)';
  const meta = document.createElement('div');
  meta.className = 'pkg-item-meta';
  meta.textContent = c.nodeName;
  body.append(title, meta);
  row.appendChild(body);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'icon-btn';
  addBtn.innerHTML = ICON.plus;
  addBtn.title = 'Pakete ekle';
  addBtn.onclick = () => { addTestCaseToPackage(pkg, c.nodeId, c.testCase.id); renderContent(); };
  row.appendChild(addBtn);

  return row;
}

/**
 * İçerdiği paketler listesindeki bir satır — test case satırından (bkz.
 * renderPackageItemRow) farklı olarak tıklanınca AĞACA değil o PAKETİN
 * detayına gider (state.openPackageId, renderPackageCard'daki open() ile
 * aynı desen). Kaynağı silinmişse (paket bir yerden silinmiş) aynı "kaynağı
 * silinmiş" ghost görünümü — nodeId/testCaseId yerine packageId için.
 */
function renderPackageRefRow(pkg, item, idx) {
  const child = state.packages.find((p) => p.id === item.packageId);
  const row = document.createElement('div');
  row.className = 'pkg-item-row';

  if (!child) {
    row.classList.add('pkg-item-ghost');
    const body = document.createElement('div');
    body.className = 'pkg-item-body';
    const title = document.createElement('div');
    title.className = 'pkg-item-title';
    title.textContent = 'Kaynağı silinmiş';
    const meta = document.createElement('div');
    meta.className = 'pkg-item-meta';
    meta.textContent = 'Bağlı paket artık yok';
    body.append(title, meta);
    row.appendChild(body);
  } else {
    const icon = document.createElement('span');
    icon.className = 'pkg-item-package-icon';
    icon.innerHTML = ICON.package;
    row.appendChild(icon);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'pkg-item-body pkg-item-jump';
    body.title = 'Bu paketi aç';
    const title = document.createElement('div');
    title.className = 'pkg-item-title';
    title.textContent = child.name;
    const meta = document.createElement('div');
    meta.className = 'pkg-item-meta';
    // childStats.ghosts kendi içindeki (özyinelemeli) kırık referansları da
    // kapsıyor — B'nin içindeki C silinmişse bu satırda hemen görünsün diye,
    // A'yı açan kullanıcı B'nin içine girmeden sorunu fark etsin.
    const childStats = computePackageStats(child);
    meta.textContent = `${childStats.total} test case`
      + (childStats.ghosts ? ` · ${childStats.ghosts} kaynağı silinmiş` : '');
    body.append(title, meta);
    body.onclick = () => { state.openPackageId = child.id; renderContent(); };
    row.appendChild(body);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.innerHTML = ICON.close;
  removeBtn.title = 'Paketten çıkar';
  removeBtn.onclick = () => { removeItemFromPackage(pkg, idx); renderContent(); };
  row.appendChild(removeBtn);

  return row;
}

/** "Paket ekle" arama sonucundaki bir aday satırı — tıklayınca pkg'e iç içe eklenir. */
function renderPackageCandidateRow(pkg, candidate) {
  const row = document.createElement('div');
  row.className = 'pkg-item-row pkg-candidate-row';

  const icon = document.createElement('span');
  icon.className = 'pkg-item-package-icon';
  icon.innerHTML = ICON.package;
  row.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'pkg-item-body';
  const title = document.createElement('div');
  title.className = 'pkg-item-title';
  title.textContent = candidate.name;
  const meta = document.createElement('div');
  meta.className = 'pkg-item-meta';
  const candidateStats = computePackageStats(candidate);
  meta.textContent = `${candidateStats.total} test case`
    + (candidateStats.ghosts ? ` · ${candidateStats.ghosts} kaynağı silinmiş` : '');
  body.append(title, meta);
  row.appendChild(body);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'icon-btn';
  addBtn.innerHTML = ICON.plus;
  addBtn.title = 'Pakete ekle';
  addBtn.onclick = () => { addPackageToPackage(pkg, candidate.id); renderContent(); };
  row.appendChild(addBtn);

  return row;
}
