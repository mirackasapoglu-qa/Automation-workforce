// "Dikkat" görünümü — Ağaç/Diyagram/Pano'nun yanındaki dördüncü görünüm (bkz. shell.js → VIEWS).
// Eskiden bu bir modaldı (attention-panel.js): panel her açıldığında dört bölüm (test case'ler,
// Jira, Tasarım, Doküman) otomatik ateşleniyor, üçü ayrı ayrı "taranıyor…" yazıp farklı anlarda
// doluyor, modal gözünün önünde zıplıyordu — ve buton hâlâ eski adını taşıyordu ("Bayat/Bekleyen
// Test Case'ler") oysa içeriği çoktan Jira/Figma/Confluence'ı da kapsıyordu.
//
// Yeniden tasarım (kullanıcı isteğiyle, UI/UX gözden geçirmesi sonrası):
//  - Modal değil, kalıcı bir SEKME: bırakıp geri dönülebilir, her açılışta sıfırdan kurulmaz.
//  - Test case listesi hâlâ anlık/yerel (ağ istemez) — hep hazır.
//  - Jira/Tasarım/Doküman artık OTOMATİK ateşlenmez: her biri kendi "Tara" düğmesini bekleyen
//    bir kart olarak başlar, tıklanınca gerçek isteği atar ve sonucu OTURUM BOYUNCA önbellekler
//    (bkz. state.js → attentionCache). Bu, Jira sorgusunun hiç önbelleği olmadığı gerçeğiyle de
//    örtüşüyor: artık sekmeye her giriş çıkışta değil, SEN istediğinde gerçek çağrı gidiyor.
//  - Kategori sekmeleri (Hepsi/Test Case/Jira/Tasarım/Doküman) tek bir listede karışmak yerine
//    odaklanmayı sağlıyor; "Dikkat" sekmesindeki sayı rozeti taranmış her şeyin toplamı.
import { state } from './state.js';
import { ICON } from './constants.js';
import { collectAttentionTestCases, findNode, flattenWithPath } from './data.js';
import { formatNoteDate } from './notes.js';
import { openDrawer } from './drawer.js';
import { runJiraSweep } from './jira.js';
import { runDesignDriftSweep } from './design-drift.js';
import { runConfluenceDriftSweep } from './confluence-drift.js';
import { fetchConnectorStatus } from './connector-status.js';

const CATEGORIES = [
  { key: 'all', label: 'Hepsi' },
  { key: 'testcase', label: "Test Case'ler" },
  { key: 'jira', label: 'Jira' },
  { key: 'design', label: 'Tasarım' },
  { key: 'confluence', label: 'Doküman' },
];

/** Bir düğüme git — artık kapatılacak bir modal yok, sadece drawer açılır. */
function goToNode(nodeId) {
  const target = findNode(state.tree, nodeId);
  if (target) openDrawer(target);
}

function buildRow({ badgeText, badgeClass, title, path, meta, onClick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'attention-row';
  row.onclick = onClick;

  const badge = document.createElement('span');
  badge.className = 'attention-badge ' + badgeClass;
  badge.textContent = badgeText;
  row.appendChild(badge);

  const info = document.createElement('span');
  info.className = 'attention-info';
  const titleEl = document.createElement('span');
  titleEl.className = 'attention-title';
  titleEl.textContent = title;
  info.appendChild(titleEl);
  const pathEl = document.createElement('span');
  pathEl.className = 'attention-path';
  pathEl.textContent = path;
  info.appendChild(pathEl);
  row.appendChild(info);

  const metaEl = document.createElement('span');
  metaEl.className = 'attention-meta';
  metaEl.textContent = meta;
  row.appendChild(metaEl);

  return row;
}

function buildTestCaseSection() {
  const entries = collectAttentionTestCases(state.tree);
  const section = document.createElement('div');
  section.className = 'attention-section';

  const heading = document.createElement('div');
  heading.className = 'attention-subheading';
  heading.innerHTML = ICON.statusWarn + `<span>Test Case'ler</span>` + countChip(entries.length);
  section.appendChild(heading);

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = 'Hiç koşulmamış (Bekliyor) ve son koşumu 30 günden eski (Bayat) test case\'ler — '
    + 'zaten Hatalı/Uyarılı olanlar burada değil, onlar durum kartlarında zaten görünüyor.';
  section.appendChild(desc);

  if (!entries.length) {
    section.appendChild(emptyPlaceholder('Şu an dikkat gerektiren bir test case yok — hepsi ya koşulmuş ya da güncel.'));
    return section;
  }

  const list = document.createElement('div');
  list.className = 'attention-list';
  entries.forEach(entry => {
    list.appendChild(buildRow({
      badgeText: entry.reason === 'pending' ? 'BEKLİYOR' : 'BAYAT',
      badgeClass: 'attention-badge-' + entry.reason,
      title: entry.title || '(başlıksız test case)',
      path: entry.nodePath,
      meta: entry.reason === 'pending' ? 'Eklendi: ' + formatNoteDate(entry.at) : 'Son koşum: ' + formatNoteDate(entry.at),
      onClick: () => goToNode(entry.nodeId),
    }));
  });
  section.appendChild(list);
  return section;
}

function countChip(n) {
  return n ? ` <span class="drawer-tab-count">${n}</span>` : '';
}

function emptyPlaceholder(text) {
  const empty = document.createElement('div');
  empty.className = 'drawer-placeholder';
  empty.textContent = text;
  return empty;
}

/** Henüz taranmamış bir kaynak için: ikon + açıklama + "Tara" düğmesi. */
function buildScanCard(icon, label, onScan) {
  const card = document.createElement('div');
  card.className = 'attention-scan-card';
  card.innerHTML = `<div class="attention-scan-icon">${icon}</div>`;
  const text = document.createElement('div');
  text.className = 'attention-scan-text';
  text.textContent = `${label} bu oturumda henüz taranmadı.`;
  card.appendChild(text);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.innerHTML = ICON.refresh + '<span>Tara</span>';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.innerHTML = ICON.refresh + '<span>Taranıyor…</span>';
    await onScan();
  };
  card.appendChild(btn);
  return card;
}

/** Taranmış bir kaynak için: "Son tarama: X önce" + küçük yenile ikonu. */
function buildScannedMeta(scannedAt, onRescan) {
  const wrap = document.createElement('div');
  wrap.className = 'attention-scanned-meta';
  const label = document.createElement('span');
  label.textContent = 'Son tarama: ' + formatNoteDate(scannedAt);
  wrap.appendChild(label);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.title = 'Yeniden tara';
  btn.innerHTML = ICON.refresh;
  btn.onclick = async () => {
    btn.disabled = true;
    await onRescan();
  };
  wrap.appendChild(btn);
  return wrap;
}

/**
 * Jira bölümü — `runJiraSweep()` ağaç genelinde tek istekte tarar, yeni ❌'ları uygular
 * (ekranı `reloadPersistedTree` sweep içinde zaten tazeler) ve TERSİNİ (Jira Done ama düğüm
 * hâlâ Hatalı — insan onayı bekliyor) raporlar. Burada SADECE rapor edilir, hiçbir düğüm
 * ✅'ya çekilmez (bkz. CLAUDE.md → "tek yönlü").
 */
function buildJiraSection(rerender) {
  const section = document.createElement('div');
  section.className = 'attention-section';
  const heading = document.createElement('div');
  heading.className = 'attention-subheading';
  const cache = state.attentionCache.jira;
  heading.innerHTML = ICON.jira + '<span>Jira</span>' + countChip(cache ? cache.flagged.length + cache.reviewSuggested.length : 0);
  section.appendChild(heading);

  const scan = async () => {
    const result = await runJiraSweep();
    state.attentionCache.jira = result
      ? { flagged: result.flagged, reviewSuggested: result.reviewSuggested, scannedAt: new Date().toISOString() }
      : { flagged: [], reviewSuggested: [], scannedAt: new Date().toISOString(), error: true };
    rerender();
  };

  if (!cache) {
    section.appendChild(buildScanCard(ICON.jira, 'Jira', scan));
    return section;
  }

  section.appendChild(buildScannedMeta(cache.scannedAt, scan));

  if (cache.error) {
    section.appendChild(emptyPlaceholder('Jira taraması yapılamadı (tracker tanımlı değil ya da sunucuya ulaşılamadı).'));
    return section;
  }

  if (cache.flagged.length) {
    const note = document.createElement('p');
    note.className = 'attention-desc';
    note.textContent = `${cache.flagged.length} düğüm, Jira'da "Tamamlandı" olmayan bir Task ID'ye sahip olduğu için otomatik "Hatalı"ya çekildi.`;
    section.appendChild(note);
  }

  if (!cache.reviewSuggested.length) {
    section.appendChild(emptyPlaceholder(cache.flagged.length
      ? 'İnsan onayı bekleyen bir kart yok.'
      : 'Jira tarafında dikkat gerektiren bir şey yok — bilinen tüm kartlar ya "Hatalı" değil ya da hâlâ açık.'));
    return section;
  }

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = 'Bu düğümler "Hatalı" işaretli ama bağlı Jira kartlarının TÜMÜ artık "Tamamlandı" — '
    + 'sistem bunları otomatik olarak geri almaz, gözden geçirip kararı sen ver.';
  section.appendChild(desc);

  const flat = flattenWithPath(state.tree, [], []);
  const list = document.createElement('div');
  list.className = 'attention-list';
  cache.reviewSuggested.forEach(entry => {
    const found = flat.find(f => f.node.id === entry.nodeId);
    if (!found) return; // düğüm bu arada silinmiş olabilir
    list.appendChild(buildRow({
      badgeText: 'ONAY BEKLİYOR',
      badgeClass: 'attention-badge-review',
      title: found.node.name,
      path: found.path.join(' › '),
      meta: entry.doneTaskIds.join(', ') + ' · Done',
      onClick: () => goToNode(found.node.id),
    }));
  });
  section.appendChild(list);
  return section;
}

/**
 * Ortak Drift Radarı bölüm oluşturucusu — Figma VE Confluence AYNI şekli paylaşır (sadece
 * hangi sweep'in çağrıldığı ve metinler değişir). Jira bölümünün tersine burada "gözden
 * geçir" tersi bir liste yok — ⚠️'den çıkış her zaman insan elinden.
 */
function buildDriftSection({ cacheKey, icon, label, runSweep, texts, rerender }) {
  const section = document.createElement('div');
  section.className = 'attention-section';
  const heading = document.createElement('div');
  heading.className = 'attention-subheading';
  const cache = state.attentionCache[cacheKey];
  heading.innerHTML = icon + `<span>${label}</span>` + countChip(cache ? cache.flagged.length : 0);
  section.appendChild(heading);

  const scan = async () => {
    const result = await runSweep();
    state.attentionCache[cacheKey] = result
      ? { flagged: result.flagged, scannedAt: new Date().toISOString() }
      : { flagged: [], scannedAt: new Date().toISOString(), error: true };
    rerender();
  };

  if (!cache) {
    section.appendChild(buildScanCard(icon, label, scan));
    return section;
  }

  section.appendChild(buildScannedMeta(cache.scannedAt, scan));

  if (cache.error) {
    section.appendChild(emptyPlaceholder(texts.error));
    return section;
  }

  if (!cache.flagged.length) {
    section.appendChild(emptyPlaceholder(texts.empty));
    return section;
  }

  const desc = document.createElement('p');
  desc.className = 'attention-desc';
  desc.textContent = texts.desc;
  section.appendChild(desc);

  const flat = flattenWithPath(state.tree, [], []);
  const list = document.createElement('div');
  list.className = 'attention-list';
  cache.flagged.forEach(entry => {
    const found = flat.find(f => f.node.id === entry.nodeId);
    if (!found) return;
    list.appendChild(buildRow({
      badgeText: texts.badge,
      badgeClass: 'attention-badge-drift',
      title: found.node.name,
      path: found.path.join(' › '),
      meta: 'Son değişiklik: ' + formatNoteDate(entry.lastModified),
      onClick: () => goToNode(found.node.id),
    }));
  });
  section.appendChild(list);
  return section;
}

let connectorsLoading = false;

/**
 * Flowscope'un daha önce hiç göstermediği bir şey: bağlı olduğu üç yeteneğin
 * (tracker/design/docs) o anki durumu, tek satırda. Jira/Tasarım/Doküman
 * sweep'lerinin aksine bu ucuz+önbellekli bir okuma (bkz. connector-status.js),
 * bu yüzden "Tara" düğmesi beklemez — sekme açılır açılmaz kendiliğinden gelir.
 * Önceden bunu görmek için panele geçmek gerekiyordu.
 */
function buildConnectorStatusRow(rerender) {
  const wrap = document.createElement('div');
  wrap.className = 'attention-connector-row';

  const cache = state.attentionConnectors;
  if (!cache) {
    wrap.classList.add('attention-connector-loading');
    wrap.textContent = connectorsLoading ? 'Bağlantı durumu yükleniyor…' : 'Bağlantı durumu alınamadı.';
    if (!connectorsLoading) {
      connectorsLoading = true;
      wrap.textContent = 'Bağlantı durumu yükleniyor…';
      fetchConnectorStatus().then(list => {
        connectorsLoading = false;
        state.attentionConnectors = list && list.length ? list : null;
        rerender();
      });
    }
    return wrap;
  }

  cache.forEach(c => {
    const pill = document.createElement('span');
    const cls = c.state === 'ok' ? 'status-ok' : (c.state === 'warn' || c.state === 'blocked') ? 'status-warn' : 'status-todo';
    pill.className = 'chip chip-status chip-status-auto ' + cls;
    pill.title = c.detail || '';
    pill.textContent = `${c.label} ${c.state === 'ok' ? '✓' : '⏻'}`;
    wrap.appendChild(pill);
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'icon-btn';
  refreshBtn.title = 'Bağlantı durumunu yenile';
  refreshBtn.innerHTML = ICON.refresh;
  refreshBtn.onclick = () => { state.attentionConnectors = null; rerender(); };
  wrap.appendChild(refreshBtn);

  return wrap;
}

/** Sekmedeki (Ağaç/Diyagram/Pano/Dikkat) sayı rozeti — taranmış her şeyin toplamı. */
export function attentionBadgeCount() {
  const tc = collectAttentionTestCases(state.tree).length;
  const j = state.attentionCache.jira ? state.attentionCache.jira.flagged.length + state.attentionCache.jira.reviewSuggested.length : 0;
  const d = state.attentionCache.design ? state.attentionCache.design.flagged.length : 0;
  const c = state.attentionCache.confluence ? state.attentionCache.confluence.flagged.length : 0;
  return tc + j + d + c;
}

/**
 * "Dikkat" görünümünün tamamını üretir (diğer view'lar gibi — bkz. shell.js → renderContent).
 * `rerender` shell.js'in `renderContent`'i: bir "Tara" tıklamasından sonra tüm görünümü
 * (dolayısıyla rozeti de) tazelemek için kullanılır.
 */
export function renderAttentionView(rerender) {
  const wrap = document.createElement('div');
  wrap.className = 'attention-view';

  const toolbar = document.createElement('div');
  toolbar.className = 'attention-category-row';
  CATEGORIES.forEach(cat => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'facet-pill' + (state.attentionCategory === cat.key ? ' active' : '');
    pill.textContent = cat.label;
    pill.onclick = () => { state.attentionCategory = cat.key; rerender(); };
    toolbar.appendChild(pill);
  });

  const scanAllBtn = document.createElement('button');
  scanAllBtn.type = 'button';
  scanAllBtn.className = 'btn';
  scanAllBtn.innerHTML = ICON.refresh + '<span>Tümünü Tara</span>';
  scanAllBtn.onclick = async () => {
    scanAllBtn.disabled = true;
    scanAllBtn.innerHTML = ICON.refresh + '<span>Taranıyor…</span>';
    const [jira, design, confluence] = await Promise.all([runJiraSweep(), runDesignDriftSweep(), runConfluenceDriftSweep()]);
    const at = new Date().toISOString();
    state.attentionCache.jira = jira ? { flagged: jira.flagged, reviewSuggested: jira.reviewSuggested, scannedAt: at } : { flagged: [], reviewSuggested: [], scannedAt: at, error: true };
    state.attentionCache.design = design ? { flagged: design.flagged, scannedAt: at } : { flagged: [], scannedAt: at, error: true };
    state.attentionCache.confluence = confluence ? { flagged: confluence.flagged, scannedAt: at } : { flagged: [], scannedAt: at, error: true };
    rerender();
  };
  toolbar.appendChild(scanAllBtn);
  wrap.appendChild(toolbar);
  wrap.appendChild(buildConnectorStatusRow(rerender));

  const cat = state.attentionCategory;
  if (cat === 'all' || cat === 'testcase') wrap.appendChild(buildTestCaseSection());
  if (cat === 'all' || cat === 'jira') wrap.appendChild(buildJiraSection(rerender));
  if (cat === 'all' || cat === 'design') {
    wrap.appendChild(buildDriftSection({
      cacheKey: 'design', icon: ICON.figma, label: 'Tasarım', runSweep: runDesignDriftSweep, rerender,
      texts: {
        error: 'Tasarım taraması yapılamadı (Figma kimliği yok/koparılmış ya da sunucuya ulaşılamadı).',
        empty: 'Doğrulanmış (✅) hiçbir düğümün tasarımı son onaydan sonra değişmemiş.',
        desc: 'Bu düğümler "Tamamlandı" işaretliydi ama bağlı Figma dosyaları senin doğruladığın '
          + 'tarihten SONRA değişmiş — otomatik "Uyarılı"ya çekildi, yeniden gözden geçir.',
        badge: 'TASARIM GÜNCELLENDİ',
      },
    }));
  }
  if (cat === 'all' || cat === 'confluence') {
    wrap.appendChild(buildDriftSection({
      cacheKey: 'confluence', icon: ICON.confluence, label: 'Doküman', runSweep: runConfluenceDriftSweep, rerender,
      texts: {
        error: 'Doküman taraması yapılamadı (Confluence kimliği yok/koparılmış ya da sunucuya ulaşılamadı).',
        empty: 'Doğrulanmış (✅) hiçbir düğümün bağlı dokümanı son onaydan sonra değişmemiş.',
        desc: 'Bu düğümler "Tamamlandı" işaretliydi ama bağlı Confluence sayfaları senin doğruladığın '
          + 'tarihten SONRA düzenlenmiş — otomatik "Uyarılı"ya çekildi, yeniden gözden geçir.',
        badge: 'DOKÜMAN GÜNCELLENDİ',
      },
    }));
  }

  return wrap;
}
