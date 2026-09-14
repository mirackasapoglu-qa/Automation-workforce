// Paketler: kullanıcının test case'leri gruplamak için oluşturduğu adlandırılmış
// koleksiyonlar (ör. "Regresyon paketi", "Validasyon paketi"). tree.json'dan AYRI
// bir dosyada kalıcı (bkz. panel/packages.mjs) — bir paket ağacın kendisi değil,
// ona dair bir REFERANS listesi ({nodeId, testCaseId} çiftleri).
//
// Bir test case aynı anda birden çok pakette olabilir — pakete eklemek onu
// "taşımaz", sadece bir referans ekler (etiket gibi). Bağlı olduğu düğüm ya da
// test case'in kendisi silinirse referans sessizce TEMİZLENMEZ: "kaynağı
// silinmiş" olarak görünür kalır, kullanıcı isterse elle çıkarır — veri kaybını
// gizlemek yerine izlenebilir tutuyoruz (bkz. resolvePackageItem).
import { state, newPackageId } from './state.js';
import { ICON, STATUS_META } from './constants.js';
import { findNode, debounce, setSaveState, effectiveTestCaseStatus, isTestCaseRunStale, DEFAULT_STALE_DAYS, loadPersisted } from './data.js';
import { formatNoteDate } from './notes.js';
import { uiConfirm, uiToast } from './dialog.js';
import { renderContent } from './shell.js';
import { openDrawer } from './drawer.js';

const nowIso = () => new Date().toISOString();
const MAX_CANDIDATES_SHOWN = 60;

export async function loadPackages() {
  const res = await fetch('/api/scope/packages');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  state.packages = Array.isArray(data.packages) ? data.packages : [];
  fixPackageIdCounter(state.packages);
}

/**
 * `state.packageIdCounter` her sayfa yüklemesinde 1'den başlar (bkz. state.js) —
 * yüklenen paketlerin ID'lerinin ÖNÜNE geçmezse bir sonraki `newPackageId()`
 * zaten var olan bir ID'yle çakışır ve o paketin ÜZERİNE YAZAR (ölçüldü: bir
 * sayfa yenilemesinden sonra oluşturulan paket, aynı ID'yi taşıyan eski bir
 * paketi sessizce değiştirdi). `data.js → fixIdCounter`'ın aynısı, paketler için.
 */
function fixPackageIdCounter(packages) {
  packages.forEach((p) => {
    const num = parseInt(String(p.id).replace('pkg', ''), 10);
    if (!isNaN(num) && num >= state.packageIdCounter) state.packageIdCounter = num + 1;
  });
}

function persistPackages() {
  // Yükleme başarısızsa YAZMA: sunucudaki gerçek listeyi boş/eksik bir kopyayla
  // ezmemek için (bkz. data.js → persist()'in aynı gerekçeli aynı deseni).
  if (state.packagesLoadFailed) return;
  fetch('/api/scope/packages', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
    body: JSON.stringify({ packages: state.packages }),
  })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      setSaveState(null);
    })
    .catch((e) => setSaveState(e.message));
}
const persistPackagesDebounced = debounce(persistPackages, 400);

/**
 * Ad denetimi — büyük/küçük harf ve baştaki/sondaki boşluk YOK sayılarak
 * karşılaştırılır ("Regresyon" ile "regresyon " aynı isim sayılır). `excludeId`
 * yeniden adlandırmada paketin KENDİSİYLE çakışmasını engellemek için —
 * verilmezse (oluşturma) tüm paketlere karşı kontrol edilir.
 * @returns {string|null} hata mesajı, geçerliyse null
 */
export function validatePackageName(name, excludeId) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Paket adı boş olamaz.';
  const norm = trimmed.toLowerCase();
  const dup = state.packages.some((p) => p.id !== excludeId && p.name.trim().toLowerCase() === norm);
  if (dup) return `"${trimmed}" isimli bir paket zaten var.`;
  return null;
}

export function createPackage(name) {
  const pkg = { id: newPackageId(), name: name.trim(), description: '', createdAt: nowIso(), updatedAt: nowIso(), items: [] };
  state.packages.push(pkg);
  persistPackages();
  return pkg;
}

export function deletePackage(id) {
  state.packages = state.packages.filter((p) => p.id !== id);
  persistPackages();
}

export function renamePackage(pkg, name) {
  pkg.name = name.trim();
  pkg.updatedAt = nowIso();
  persistPackagesDebounced();
}

export function setPackageDescription(pkg, description) {
  pkg.description = description;
  pkg.updatedAt = nowIso();
  persistPackagesDebounced();
}

export function addTestCaseToPackage(pkg, nodeId, testCaseId) {
  if (pkg.items.some((it) => it.nodeId === nodeId && it.testCaseId === testCaseId)) return;
  pkg.items.push({ nodeId, testCaseId });
  pkg.updatedAt = nowIso();
  persistPackages();
}

export function removeItemFromPackage(pkg, index) {
  pkg.items.splice(index, 1);
  pkg.updatedAt = nowIso();
  persistPackages();
}

/**
 * Bir paketi kopyalar — "geçen sprint'in regresyon paketini al, üstüne ekle"
 * gibi gerçek bir alışkanlık. Item referansları (nodeId/testCaseId) aynen
 * kopyalanır (aynı test case'lere işaret eder, taşımaz); ad çakışmasın diye
 * "(kopya)", çakışırsa "(kopya 2)" şeklinde ilk BOŞ ismi bulur.
 */
export function clonePackage(pkg) {
  const base = `${pkg.name} (kopya)`;
  let name = base;
  let n = 2;
  while (validatePackageName(name, null)) { name = `${base} ${n}`; n += 1; }
  const clone = {
    id: newPackageId(), name, description: pkg.description, createdAt: nowIso(), updatedAt: nowIso(),
    items: pkg.items.map((it) => ({ ...it })),
  };
  state.packages.push(clone);
  persistPackages();
  return clone;
}

/** {node, testCase} çözer; kaynak silinmişse ilgili alan null döner (ghost satır). */
export function resolvePackageItem(item) {
  const node = findNode(state.tree, item.nodeId);
  const testCase = node ? node.testCases.find((tc) => tc.id === item.testCaseId) : null;
  return { node, testCase: testCase || null };
}

/** Ağaçtaki TÜM test case'leri düz bir listeye çıkarır — arama/seçim için. */
function allTestCases(nodes, acc = []) {
  for (const n of nodes) {
    for (const tc of n.testCases) acc.push({ nodeId: n.id, nodeName: n.name, testCase: tc });
    allTestCases(n.children, acc);
  }
  return acc;
}

/** Paketin ÇÖZÜLEBİLEN item'ları üzerinden durum dağılımı — kaynağı silinmişler ayrı sayılır. */
function computePackageStats(pkg) {
  const stats = { '✅': 0, '🔵': 0, '⚠️': 0, '❌': 0, '⬜': 0, total: 0, ghosts: 0 };
  pkg.items.forEach((item) => {
    const { node, testCase } = resolvePackageItem(item);
    if (!node || !testCase) { stats.ghosts += 1; return; }
    stats.total += 1;
    const s = effectiveTestCaseStatus(testCase);
    if (stats[s] !== undefined) stats[s] += 1;
  });
  return stats;
}

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

/**
 * Paketin gerçek koşumu — drawer.js → renderAutomatedRunSection'daki TEK
 * düğüm koşumunun ("Testi Koştur") AYNI ucunu (`/api/scope/run`) kullanır,
 * sadece paketteki her FARKLI sayfa için sırayla tekrarlar. Test case
 * düzeyinde ayrı bir filtre YOK — motor bir düğümün tüm whitelist'li
 * spec'ini koşuyor, tek tek test başlığı seçmiyor (bkz. panel/routes/runs.mjs).
 * Motor TEK SLOT olduğu için (aynı anda tek koşum) sayfalar paralel değil,
 * biri bitmeden diğeri başlamadan, sırayla koşulur.
 *
 * Her düğüm bitince tree sunucudan tazelenip GERÇEK sonuç (geçti/kaldı, hangi
 * spec, not) hemen çıkarılıyor — böylece popup her satırı sırayla, gerçek
 * verilerle doldurabiliyor; paketin tamamı bitene kadar beklemek gerekmiyor.
 *
 * `stopFlag` ({requested:boolean}) her döngü başında kontrol edilir — "Durdur"a
 * basılınca yalnızca O ANKİ sayfanın koşumu değil, PAKETİN TAMAMI durur ve
 * kalan sayfalar "atlandı" sayılır (eskiden Durdur yalnızca tek sayfayı
 * kesiyor, döngü bir sonraki sayfayı başlatmaya devam ediyordu — ölçüldü).
 *
 * `onProgress({ done, total, node, phase, reason?, result? })` her adımda
 * çağrılır; `phase`: 'running' | 'skipped' | 'error' | 'done'.
 * @returns {Promise<{ranNodeIds:string[], skipped:{node,reason}[], nodeResults:object[], stoppedEarly:boolean}>}
 */
async function runPackage(pkg, onProgress, stopFlag) {
  const nodeIds = [...new Set(pkg.items.map((it) => it.nodeId))]
    .map((id) => findNode(state.tree, id))
    .filter(Boolean);

  const ran = [];
  const skipped = [];
  const nodeResults = [];
  const total = nodeIds.length;

  const markRemainingStopped = (fromIndex) => {
    for (let j = fromIndex; j < nodeIds.length; j += 1) {
      const reason = 'Kullanıcı durdurdu';
      skipped.push({ node: nodeIds[j], reason });
      nodeResults.push({ nodeId: nodeIds[j].id, nodeName: nodeIds[j].name, ok: false, reason });
      onProgress?.({ done: j, total, node: nodeIds[j], phase: 'skipped', reason });
    }
  };

  for (let i = 0; i < nodeIds.length; i += 1) {
    if (stopFlag?.requested) { markRemainingStopped(i); return { ranNodeIds: ran, skipped, nodeResults, stoppedEarly: true }; }
    const node = nodeIds[i];
    if (!node.runRef?.runId) {
      const reason = 'Bu sayfa için otomatik koşum tanımlı değil';
      skipped.push({ node, reason });
      nodeResults.push({ nodeId: node.id, nodeName: node.name, ok: false, reason });
      onProgress?.({ done: i + 1, total, node, phase: 'skipped', reason });
      continue;
    }

    onProgress?.({ done: i, total, node, phase: 'running' });
    const startedAt = nowIso();
    let res, data;
    try {
      res = await fetch('/api/scope/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
        body: JSON.stringify({ nodeId: node.id }),
      });
      data = await res.json();
    } catch (e) {
      const reason = `Panel sunucusuna ulaşılamadı: ${e.message}`;
      skipped.push({ node, reason });
      nodeResults.push({ nodeId: node.id, nodeName: node.name, ok: false, reason });
      onProgress?.({ done: i + 1, total, node, phase: 'error', reason });
      continue;
    }
    if (!data.ok) {
      const reason = data.error || 'Başlatılamadı';
      skipped.push({ node, reason });
      nodeResults.push({ nodeId: node.id, nodeName: node.name, ok: false, reason });
      onProgress?.({ done: i + 1, total, node, phase: 'error', reason });
      // BUSY: panel başka bir koşum yürütüyor — sırayı bekletmenin anlamı yok,
      // kalanları da "atlandı" say ve bitir.
      if (data.code === 'BUSY') {
        markRemainingStopped(i + 1);
        return { ranNodeIds: ran, skipped, nodeResults, stoppedEarly: true };
      }
      continue;
    }
    await waitForScopeRunToFinish();
    if (stopFlag?.requested) { markRemainingStopped(i + 1); return { ranNodeIds: ran, skipped, nodeResults, stoppedEarly: true }; }

    await loadPersisted();
    const freshNode = findNode(state.tree, node.id);
    const entries = (freshNode?.testCases || [])
      .filter((tc) => tc.automated)
      .map((tc) => {
        const last = (tc.runs || [])[tc.runs.length - 1];
        return last && last.at >= startedAt ? { spec: tc.spec, status: last.status, note: last.note } : null;
      })
      .filter(Boolean);
    const nodeResult = { nodeId: node.id, nodeName: freshNode?.name || node.name, ok: true, entries };
    nodeResults.push(nodeResult);
    ran.push(node.id);
    onProgress?.({ done: i + 1, total, node, phase: 'done', result: nodeResult });
  }
  return { ranNodeIds: ran, skipped, nodeResults, stoppedEarly: false };
}

const PACKAGE_RUN_HISTORY_KEEP = 20;

/**
 * Bir "Paketi Çalıştır" koşumunun sonucunu pakete KALICI olarak yazar. Öncesinde
 * sonuç yalnızca geçici bir toast'ta gösteriliyordu (bkz. buildRunSection) —
 * sayfadan ayrılınca ya da panel yenilenince "en son ne olmuştu" sorusunun
 * cevabı kayboluyordu. `case-history.json`'daki HISTORY_KEEP deseniyle aynı:
 * en yeni koşum başta, son N koşum saklanır.
 */
function recordPackageRun(pkg, run) {
  pkg.runs = pkg.runs || [];
  pkg.runs.unshift(run);
  if (pkg.runs.length > PACKAGE_RUN_HISTORY_KEEP) pkg.runs.length = PACKAGE_RUN_HISTORY_KEEP;
  pkg.updatedAt = run.at;
  persistPackages();
}

function waitForScopeRunToFinish() {
  return new Promise((resolve) => {
    const iv = setInterval(async () => {
      try {
        const st = await (await fetch('/api/scope/run-state')).json();
        if (!st.running) { clearInterval(iv); resolve(); }
      } catch { /* gecici hata: bir sonraki turda tekrar denenir */ }
    }, 2000);
  });
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
  meta.textContent = `${pkg.items.length} test case · ${formatNoteDate(pkg.updatedAt)}`;
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

  // Mevcut test case'ler
  const currentSection = document.createElement('div');
  currentSection.className = 'pkg-section';
  const currentLabel = document.createElement('div');
  currentLabel.className = 'pkg-section-label';
  currentLabel.textContent = `Test case'ler (${pkg.items.length})`;
  currentSection.append(currentLabel, renderPackageStats(pkg));

  if (!pkg.items.length) {
    const empty = document.createElement('div');
    empty.className = 'board-col-empty';
    empty.textContent = 'Henüz test case eklenmedi. Aşağıdan arayıp ekleyebilirsin.';
    currentSection.appendChild(empty);
  } else {
    pkg.items.forEach((item, idx) => currentSection.appendChild(renderPackageItemRow(pkg, item, idx)));
  }
  wrap.appendChild(currentSection);

  // Test case ekle
  const addSection = document.createElement('div');
  addSection.className = 'pkg-section';
  const addLabel = document.createElement('div');
  addLabel.className = 'pkg-section-label';
  addLabel.textContent = 'Test case ekle';
  addSection.appendChild(addLabel);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-box pkg-search';
  searchWrap.innerHTML = ICON.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Test case veya sayfa adıyla ara...';
  searchInput.value = state.packageSearchQuery;
  searchWrap.appendChild(searchInput);
  addSection.appendChild(searchWrap);

  // Aynı gerekçeyle (bkz. renderPackageList → renderResults): aday listesi
  // kendi sabit kabında güncellenir, arama kutusu ve giriş animasyonu her
  // tuşta yeniden kurulmaz.
  const candidateHolder = document.createElement('div');
  candidateHolder.className = 'pkg-candidate-list';
  addSection.appendChild(candidateHolder);

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
  wrap.appendChild(addSection);

  return wrap;
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
 * koşumlarını sırayla tetikler (bkz. runPackage). Tıklamadan ÖNCE hangi
 * sayfaların koşulacağını ve kaçının otomatik koşumu olmadığı için
 * atlanacağını gösterir — sessiz bir "hiçbir şey olmadı" durumu yaşanmasın.
 */
function buildRunSection(pkg) {
  const sec = document.createElement('div');
  sec.className = 'pkg-section';

  const label = document.createElement('div');
  label.className = 'pkg-section-label';
  label.textContent = 'Paketi çalıştır';
  sec.appendChild(label);

  const nodes = [...new Set(pkg.items.map((it) => it.nodeId))]
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
 * görünür tutar (bkz. recordPackageRun).
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
