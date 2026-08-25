// Sağdan kayarak açılan detay paneli: kabuk (aç/kapa/sekme) + "Genel" sekmesinin
// (Durum/Bağlantılar/Jira) birleştirilmesi. "Notlar" sekmesinin içeriği notes.js'te.
import { state } from './state.js';
import { ICON, TYPE_META, STATUS_META } from './constants.js';
import { flattenWithPath, isStale, daysSince, persist, DEFAULT_STALE_DAYS, effectiveStatus, effectiveTestCaseStatus } from './data.js';
import { buildStatusChip } from './chips.js';
import { renderDrawerLinksSection } from './links.js';
import { renderDrawerResourcesSection } from './resources.js';
import { renderDrawerJiraSection, renderDrawerJiraAnalysesSection, startJiraStatusPolling, stopJiraStatusPolling } from './jira.js';
import { renderDrawerNotesTab, formatNoteDate } from './notes.js';
import { renderDrawerTestCasesTab } from './test-cases.js';
import { renderDrawerSubtreeSummary } from './subtree-summary.js';
import { renderDrawerStatusHistory } from './status-history.js';
import { renderContent } from './shell.js';
import { openAiAssistModal } from './ai-assist.js';

// "Test Case İste" için kullanıcının seçtiği test TÜRLERİ — QA mesleğindeki ana test
// kategorilerinin bağımsız, çoklu-seçilebilir bir kümesi (tek bir "happy/validasyon/ikisi/
// uçtan uca" ön-kombinasyon değil — herhangi bir alt küme seçilebilir, "Tümü" hepsini açar).
// Varsayılan sabit "1-3 case yaz" talimatı çok az/genel sonuç verdiği için eklendi. Diğer
// modül-kapsamı state'ler gibi (copyFeedbackUntil, expandedRuns) renderDrawer() sık sık
// DOM'u yeniden kurduğu için burada, DOM dışında tutulur.
let selectedTestTypes = new Set(['happy', 'negative']);
const TEST_TYPE_META = {
  happy: {
    label: 'Happy Path',
    instruction: 'Temel, hatasız, başarıyla tamamlanan senaryo(lar) için case yaz (genelde 1-2 case yeterli).'
  },
  negative: {
    label: 'Negatif / Validasyon',
    instruction: 'Zorunlu alan eksikliği, format hatası, izin verilmeyen değer, hata mesajı gibi tespit '
      + 'ettiğin HER validasyon/hata kuralı için ayrı bir case yaz — sayıyı yapay şekilde sınırlama.'
  },
  boundary: {
    label: 'Sınır Değerler',
    instruction: 'Minimum/maksimum uzunluk, 0, negatif değer, aşırı büyük değer gibi sınır (boundary) '
      + 'durumları için case yaz (uygulanabilirse).'
  },
  emptyFull: {
    label: 'Boş/Dolu Veri',
    instruction: 'Hiç veri yokken (boş durum mesajı) ve çok fazla veri varken (kaydırma/sayfalama, performans) '
      + 'davranışı test eden case\'ler yaz (uygulanabilirse).'
  },
  regression: {
    label: 'Regresyon',
    instruction: 'Bu bileşene bağlı geçmiş Jira görevlerini (jiraTasks) ve durum geçmişini kontrol et; daha '
      + 'önce hataya düşmüş bir davranış varsa, bunun tekrar etmediğini doğrulayan bir regresyon case\'i yaz '
      + '(bkz. tc37/TP-123 örneği) — geçmişte hata yoksa bu türü atla.'
  },
  recovery: {
    label: 'Hata Kurtarma',
    instruction: 'Ağ hatası/timeout/API hatası gibi durumlarda kullanıcının ne gördüğünü ve toparlanabildiğini '
      + '(retry, hata mesajı) test eden case yaz (uygulanabilirse).'
  },
  ui: {
    label: 'UI / Görsel Tutarlılık',
    instruction: 'Responsive davranış, hover/focus/disabled görsel durumları, layout bozulmaları için case '
      + 'yaz (uygulanabilirse).'
  },
  a11y: {
    label: 'Erişilebilirlik',
    instruction: 'Klavye ile gezinme, görünür focus durumu, temel okunabilirlik/kontrast için case yaz '
      + '(uygulanabilirse).'
  },
  performance: {
    label: 'Performans',
    instruction: 'Büyük veri setinde yükleme/kaydırma/render performansını test eden case yaz (uygulanabilirse).'
  },
  security: {
    label: 'Güvenlik',
    instruction: 'Yetkisiz erişim, girdi enjeksiyonu (XSS vb.) gibi TEMEL güvenlik kontrollerini test eden case '
      + 'yaz (uygulanabilirse) — kapsamlı bir pentest değil, temel QA seviyesinde bir kontrol.'
  }
};

function buildAiAssistPrompt(node, ancestors, testTypes) {
  const pathStr = ancestors.length ? ancestors.join(' › ') + ' › ' + node.name : node.name;
  const resourceLinks = node.resourceLinks || [];
  const liveUrl = resourceLinks.filter(r => r.type === 'link').map(r => r.url).find(Boolean);
  const figmaUrls = resourceLinks.filter(r => r.type === 'figma').map(r => r.url);
  const confluenceUrls = resourceLinks.filter(r => r.type === 'confluence').map(r => r.url);
  const types = (testTypes && testTypes.size ? [...testTypes] : ['happy', 'negative']).filter(k => TEST_TYPE_META[k]);
  const lines = [
    `Flowscope projesinde şu bileşen için QA test case'lerini oluştur/güncelle: "${pathStr}" (node id: "${node.id}").`,
    `İstenen test türleri (${types.length}) — sadece bunları üret, başka tür ekleme:\n`
      + types.map(k => `- ${TEST_TYPE_META[k].label}: ${TEST_TYPE_META[k].instruction}`).join('\n'),
  ];
  if (liveUrl) lines.push(`İlgili canlı sayfa: ${liveUrl}`);
  if (figmaUrls.length) {
    lines.push(
      `Bu karta bağlı Figma tasarımı var: ${figmaUrls.join(', ')} — Figma MCP araçlarıyla (get_design_context / `
      + `get_screenshot) incele; tasarımdaki durumları (boş/dolu/hata), varyantları ve etkileşimleri test case'lere yansıt. `
      + `Figma burada birincil kaynak — canlı sayfadan önce buna bak.`
    );
  }
  if (confluenceUrls.length) {
    lines.push(
      `Bu karta bağlı Confluence dokümanı var: ${confluenceUrls.join(', ')} — WebFetch ile oku; gereksinimleri, `
      + `kabul kriterlerini ve varsa uç durumları (edge case) test case'lere yansıt. Confluence burada birincil `
      + `kaynak — sayfayı gezerek tahmin etmek yerine dokümanda yazana sadık kal.`
    );
  }
  lines.push(
    `Test case'ler artık ayrı bir dosyada değil, doğrudan bu düğümün kendi "testCases" alanında tutuluyor `
    + `(Flowscope'un http://localhost:8934 adresindeki tarayıcı localStorage'ı, "flowTool.tree.v2"). `
    + `Gerekirse önce gerçek sayfayı ziyaret ederek doğrula, sonra tarayıcıda o node'u (id: "${node.id}") bulup `
    + `testCases dizisine {id: 'tc<sayı>', title, steps: [{id: 'tcs<sayı>', action, expected}], runs: [], `
    + `status: '⬜', createdAt, updatedAt} şeklinde girişler ekle — "content" alanı artık YOK, her adım kendi `
    + `action/expected çiftiyle ayrı bir steps girişi (id çakışmasın diye mevcut en yüksek 'tc<sayı>'/'tcs<sayı>'yi `
    + `bul, ondan devam et), localStorage'a yaz ve sayfayı yenile — aynı yöntemi (javascript_tool ile localStorage `
    + `okuma/yazma) daha önce site-tree oluştururken kullanmıştık.`
  );
  return lines.join('\n\n');
}

// Kökten node'a kadar olan zinciri (node dahil) döner — bir düğümde canlı sayfa linki
// yoksa en yakın atada arayabilmek için (buildTestRunPrompt burada kullanıyor).
function findNodeChain(nodes, id, chain) {
  for (const n of nodes) {
    const next = chain.concat(n);
    if (n.id === id) return next;
    const found = findNodeChain(n.children, id, next);
    if (found) return found;
  }
  return null;
}

// node'un kendisi VE tüm alt ağacındaki test case'lerini, hangi node'a ait olduğuyla
// birlikte toplar — leaf'te bu sadece kendi testCases'ı, bir modülde (BÖLÜM/SAYFA) ise
// altındaki her düğümün test case'lerini de kapsar (bkz. buildTestRunPrompt).
function collectSubtreeTestCases(node) {
  const results = [];
  (function walk(n) {
    n.testCases.forEach(tc => results.push({ node: n, tc }));
    n.children.forEach(walk);
  })(node);
  return results;
}

function resolveLiveUrl(nodeId) {
  const chain = findNodeChain(state.tree, nodeId, []) || [];
  return [...chain].reverse()
    .map(n => (n.resourceLinks || []).filter(r => r.type === 'link').map(r => r.url).find(Boolean))
    .find(Boolean);
}

function buildTestRunPrompt(node, ancestors) {
  const pathStr = ancestors.length ? ancestors.join(' › ') + ' › ' + node.name : node.name;
  const allEntries = collectSubtreeTestCases(node);
  const runnable = allEntries.filter(e => e.tc.steps.length > 0);
  const empty = allEntries.filter(e => e.tc.steps.length === 0);
  const isSubtree = node.children.length > 0;

  const lines = [
    (isSubtree
      ? `Flowscope projesinde şu bileşenin VE TÜM ALT AĞACININ test case'lerini KOŞTUR — üretme, zaten var, `
        + `sadece uygula: "${pathStr}" (node id: "${node.id}").`
      : `Flowscope projesinde şu bileşenin test case'lerini KOŞTUR — üretme, zaten var, sadece uygula: `
        + `"${pathStr}" (node id: "${node.id}").`),
    `${runnable.length} test case var: ` + runnable.map(({ node: n, tc }) => {
      const liveUrl = resolveLiveUrl(n.id);
      return `"${tc.title || '(başlıksız)'}" (id: ${tc.id}, node id: "${n.id}" — "${n.name}", canlı sayfa: `
        + `${liveUrl || 'BULUNAMADI — koşmadan önce sor, tahmin etme'}, mevcut durum: `
        + `${(STATUS_META[effectiveTestCaseStatus(tc)] || {}).label || tc.status})`;
    }).join(', ') + '.',
  ];
  if (empty.length) {
    lines.push(
      `${empty.length} test case'in hiç adımı yok, bunları ATLA (koşturma): `
      + empty.map(({ node: n, tc }) => `"${tc.title || '(başlıksız)'}" (id: ${tc.id}, node id: "${n.id}")`).join(', ') + '.'
    );
  }
  lines.push(
    `Her test case'in "steps" dizisindeki {action, expected} çiftlerini KENDİ canlı sayfasında (yukarıda her `
    + `case için ayrı belirtildi — modül koşumunda farklı case'ler farklı sayfalarda olabilir, hepsi aynı URL `
    + `değil) gerçekten uygula, gözlemi "expected" ile karşılaştır. steps/title'a DOKUNMA — sonucu KENDİ `
    + `node id'sindeki testCases[].status alanına ✅/❌/⚠️ olarak yaz VE testCases[].runs dizisine `
    + `{id: 'tcr<sayı>', at: <ISO tarih>, status, note} şeklinde yeni bir kayıt ekle (id çakışmasın diye mevcut `
    + `en yüksek 'tcr<sayı>'den devam et) — koşum notu asla steps/title'a değil, sadece runs'a eklenir `
    + `(Flowscope'un http://localhost:8934 origin'indeki tarayıcı localStorage'ı, "flowTool.tree.v2" — `
    + `127.0.0.1 origin'inde DEĞİL, localhost'ta). Bunun için qa-test-runner agent'ını kullan. Silme/ödeme/`
    + `onaylama gibi kalıcı yan etkili adımları tetikleme; bir adımı net şekilde doğrulayamıyorsan tahminle `
    + `✅ verme, ⚠️ işaretleyip nedenini runs notuna ekle.`
  );
  return lines.join('\n\n');
}

function onDrawerKey(e) { if (e.key === 'Escape') closeDrawer(); }

// "Kopyalandı" görsel geri bildirimi kasıtlı olarak DOM'da değil burada (modül kapsamında)
// tutulur: renderDrawer() panel.innerHTML'i tamamen yeniden kurduğu için (ör. Jira durum
// polling'i her ~60 sn'de bir renderDrawer() tetikler) DOM üzerindeki bir class hemen
// silinebilir. Zaman damgasına dayalı bu yaklaşım re-render'lardan etkilenmez.
let copyFeedbackUntil = 0;

// Paylaşılabilir link: drawer açık olduğu sürece URL'in hash'i #node=<id> olarak tutulur,
// kapanınca temizlenir. app.js sayfa yüklenirken bu hash'i okuyup ilgili drawer'ı açar.
function setUrlHashNode(nodeId) {
  const url = new URL(window.location.href);
  url.hash = nodeId ? 'node=' + nodeId : '';
  window.history.replaceState(null, '', url.toString());
}

export function openDrawer(node) {
  state.drawerNode = node;
  state.drawerTab = 'genel';
  document.addEventListener('keydown', onDrawerKey, true);
  renderDrawer();
  startJiraStatusPolling(node);
  setUrlHashNode(node.id);
}

export function closeDrawer() {
  state.drawerNode = null;
  stopJiraStatusPolling();
  const overlay = state.root.querySelector('.drawer-overlay');
  const panel = state.root.querySelector('.drawer-panel');
  if (overlay) overlay.classList.remove('open');
  if (panel) panel.classList.remove('open');
  document.removeEventListener('keydown', onDrawerKey, true);
  setUrlHashNode(null);
  setTimeout(() => {
    if (state.drawerNode) return; // kapanış animasyonu bitmeden yeniden açıldı
    const o = state.root.querySelector('.drawer-overlay');
    const p = state.root.querySelector('.drawer-panel');
    if (o) o.remove();
    if (p) p.remove();
  }, 320);
}

export function renderDrawer() {
  if (!state.drawerNode) return;
  const drawerNode = state.drawerNode;
  let overlay = state.root.querySelector('.drawer-overlay');
  let panel = state.root.querySelector('.drawer-panel');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.onclick = closeDrawer;
    state.root.appendChild(overlay);

    panel = document.createElement('div');
    panel.className = 'drawer-panel';
    state.root.appendChild(panel);
  }

  panel.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'drawer-header';
  header.innerHTML = TYPE_META[drawerNode.type].icon;
  const titleGroup = document.createElement('div');
  titleGroup.className = 'drawer-title-group';
  const ancestorEntry = flattenWithPath(state.tree, [], []).find(f => f.node.id === drawerNode.id);
  const ancestors = ancestorEntry ? ancestorEntry.path : [];
  const subtitle = TYPE_META[drawerNode.type].label + (ancestors.length ? ' · ' + ancestors.join(' › ') : '');
  titleGroup.innerHTML = `<div class="drawer-title">${drawerNode.name || '(isimsiz)'}</div><div class="drawer-subtitle">${subtitle}</div>`;
  header.appendChild(titleGroup);
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  const showCopied = Date.now() < copyFeedbackUntil;
  copyBtn.className = 'drawer-copy-link-btn' + (showCopied ? ' copied' : '');
  copyBtn.title = showCopied ? 'Kopyalandı!' : 'Bu karta bağlantı kopyala';
  copyBtn.innerHTML = ICON.link;
  copyBtn.onclick = async () => {
    const url = new URL(window.location.href);
    url.hash = 'node=' + drawerNode.id;
    try {
      await navigator.clipboard.writeText(url.toString());
      copyFeedbackUntil = Date.now() + 1500;
      renderDrawer();
      setTimeout(() => { if (Date.now() >= copyFeedbackUntil && state.drawerNode === drawerNode) renderDrawer(); }, 1550);
    } catch (e) { /* pano erişimi engellenmiş olabilir */ }
  };
  header.appendChild(copyBtn);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drawer-close';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = closeDrawer;
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const isLeaf = !drawerNode.children.length;
  const tabDefs = [{ key: 'genel', label: 'Genel' }];
  if (isLeaf) tabDefs.push({ key: 'jira', label: 'Jira' });
  tabDefs.push({ key: 'testcase', label: "Test Case'ler" });
  tabDefs.push({ key: 'notlar', label: 'Notlar' });
  if (state.drawerTab === 'jira' && !isLeaf) state.drawerTab = 'genel';

  const tabs = document.createElement('div');
  tabs.className = 'drawer-tabs';
  tabDefs.forEach(t => {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'drawer-tab' + (state.drawerTab === t.key ? ' active' : '');
    let count = 0;
    if (t.key === 'notlar') count = drawerNode.notes.length;
    else if (t.key === 'jira') count = drawerNode.jiraTasks.length;
    else if (t.key === 'testcase') count = drawerNode.testCases.length;
    tabBtn.innerHTML = t.label + (count ? ` <span class="drawer-tab-count">${count}</span>` : '');
    tabBtn.onclick = () => { state.drawerTab = t.key; renderDrawer(); };
    tabs.appendChild(tabBtn);
  });
  panel.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'drawer-body';

  if (state.drawerTab === 'notlar') {
    body.appendChild(renderDrawerNotesTab(drawerNode));
  } else if (state.drawerTab === 'testcase') {
    body.appendChild(renderDrawerTestCasesTab(drawerNode));
  } else if (state.drawerTab === 'jira') {
    body.appendChild(renderDrawerJiraSection(drawerNode));
    body.appendChild(renderDrawerJiraAnalysesSection(drawerNode));
  } else {
    const aiSection = document.createElement('div');
    aiSection.className = 'drawer-section';
    const aiLabel = document.createElement('div');
    aiLabel.className = 'drawer-section-label';
    aiLabel.innerHTML = ICON.sparkle + '<span>QA Analizi</span>';
    aiSection.appendChild(aiLabel);
    const scopeLabel = document.createElement('div');
    scopeLabel.className = 'qa-scope-label';
    scopeLabel.textContent = 'Test türleri (birden fazla seçilebilir)';
    aiSection.appendChild(scopeLabel);
    const scopeRow = document.createElement('div');
    scopeRow.className = 'qa-scope-row';
    const allSelected = Object.keys(TEST_TYPE_META).every(k => selectedTestTypes.has(k));
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = 'qa-scope-pill qa-scope-pill-all' + (allSelected ? ' active' : '');
    allPill.textContent = 'Tümü';
    allPill.title = 'Bütün test türlerini seç/kaldır';
    allPill.onclick = () => {
      selectedTestTypes = allSelected ? new Set() : new Set(Object.keys(TEST_TYPE_META));
      renderDrawer();
    };
    scopeRow.appendChild(allPill);
    Object.keys(TEST_TYPE_META).forEach(key => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'qa-scope-pill' + (selectedTestTypes.has(key) ? ' active' : '');
      pill.textContent = TEST_TYPE_META[key].label;
      pill.title = TEST_TYPE_META[key].instruction;
      pill.onclick = () => {
        if (selectedTestTypes.has(key)) selectedTestTypes.delete(key); else selectedTestTypes.add(key);
        renderDrawer();
      };
      scopeRow.appendChild(pill);
    });
    aiSection.appendChild(scopeRow);

    const aiActions = document.createElement('div');
    aiActions.className = 'qa-analysis-actions';
    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'btn';
    aiBtn.disabled = selectedTestTypes.size === 0;
    aiBtn.title = selectedTestTypes.size === 0 ? 'Önce en az bir test türü seç' : '';
    aiBtn.innerHTML = ICON.sparkle + '<span>Test Case İste (Claude Code)</span>';
    aiBtn.onclick = () => {
      const ancestorEntry = flattenWithPath(state.tree, [], []).find(f => f.node.id === drawerNode.id);
      const ancestors = ancestorEntry ? ancestorEntry.path : [];
      openAiAssistModal({
        title: 'Claude Code için mesaj hazır',
        description: 'Bu mesajı kopyala ve doğrudan Claude Code sohbetine yapıştır — istenen analiz/test case orada yapılacak.',
        prompt: buildAiAssistPrompt(drawerNode, ancestors, selectedTestTypes),
      });
    };
    aiActions.appendChild(aiBtn);
    if (collectSubtreeTestCases(drawerNode).some(e => e.tc.steps.length > 0)) {
      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'btn';
      runBtn.innerHTML = ICON.play + '<span>' + (drawerNode.children.length ? 'Alt Ağacı Koştur (Claude Code)' : 'Test Case\'leri Koştur (Claude Code)') + '</span>';
      runBtn.onclick = () => {
        const ancestorEntry = flattenWithPath(state.tree, [], []).find(f => f.node.id === drawerNode.id);
        const ancestors = ancestorEntry ? ancestorEntry.path : [];
        openAiAssistModal({
          title: 'Claude Code için mesaj hazır',
          description: 'Bu mesajı kopyala ve doğrudan Claude Code sohbetine yapıştır — test case koşumu orada yapılacak.',
          prompt: buildTestRunPrompt(drawerNode, ancestors),
        });
      };
      aiActions.appendChild(runBtn);
    }
    aiSection.appendChild(aiActions);
    body.appendChild(aiSection);

    const statusSection = document.createElement('div');
    statusSection.className = 'drawer-section';
    const statusLabel = document.createElement('div');
    statusLabel.className = 'drawer-section-label';
    statusLabel.textContent = 'Durum';
    statusSection.appendChild(statusLabel);
    statusSection.appendChild(buildStatusChip(drawerNode));
    if (!drawerNode.children.length) {
      const intervalRow = document.createElement('div');
      intervalRow.className = 'drawer-stale-interval';
      const intervalLabel = document.createElement('span');
      intervalLabel.textContent = 'Tekrar kontrol aralığı:';
      intervalRow.appendChild(intervalLabel);
      const intervalInput = document.createElement('input');
      intervalInput.type = 'number';
      intervalInput.min = '1';
      intervalInput.className = 'drawer-stale-interval-input';
      intervalInput.value = drawerNode.staleReviewDays || DEFAULT_STALE_DAYS;
      intervalInput.title = '"Tamamlandı" işaretlendikten kaç gün sonra bu kart yeniden kontrol edilmeli hatırlatılsın';
      intervalInput.addEventListener('change', () => {
        const val = parseInt(intervalInput.value, 10);
        drawerNode.staleReviewDays = (!isNaN(val) && val > 0) ? val : DEFAULT_STALE_DAYS;
        persist();
        renderDrawer();
        renderContent();
      });
      intervalRow.appendChild(intervalInput);
      const intervalSuffix = document.createElement('span');
      intervalSuffix.textContent = 'gün';
      intervalRow.appendChild(intervalSuffix);
      statusSection.appendChild(intervalRow);
    }
    if (drawerNode.status === '✅' && drawerNode.lastVerifiedAt) {
      const stale = isStale(drawerNode);
      const verified = document.createElement('div');
      verified.className = 'drawer-hint' + (stale ? ' drawer-hint-warn' : '');
      const days = daysSince(drawerNode.lastVerifiedAt);
      verified.textContent = `Son doğrulama: ${formatNoteDate(drawerNode.lastVerifiedAt)} · ${days <= 0 ? 'bugün' : days + ' gün önce'}`
        + (stale ? ' — tekrar kontrol edilmeli' : '');
      statusSection.appendChild(verified);
    }
    // Bileşenin kendi durumu ile test case sonuçları FARKLI kavramlar — otomatik senkronlamıyoruz
    // (biri "bu iş bitti mi", diğeri "bu senaryo geçti mi"), ama ikisi çelişince fark ettirmeye
    // değer: bileşen Tamamlandı işaretli ama en az bir test case hâlâ Hatalı ile kapanmışsa.
    const failingCases = (drawerNode.testCases || []).filter(tc => effectiveTestCaseStatus(tc) === '❌');
    if (failingCases.length && effectiveStatus(drawerNode) === '✅') {
      const mismatch = document.createElement('div');
      mismatch.className = 'drawer-hint drawer-hint-warn drawer-hint-link';
      mismatch.textContent = `⚠ ${failingCases.length} test case hatalı ama bileşen Tamamlandı işaretli — gözden geçir`;
      mismatch.onclick = () => { state.drawerTab = 'testcase'; renderDrawer(); };
      statusSection.appendChild(mismatch);
    }
    body.appendChild(statusSection);

    const historySection = renderDrawerStatusHistory(drawerNode);
    if (historySection) body.appendChild(historySection);

    body.appendChild(renderDrawerLinksSection(drawerNode));
    body.appendChild(renderDrawerResourcesSection(drawerNode));

    if (drawerNode.children.length) {
      const summary = renderDrawerSubtreeSummary(drawerNode);
      if (summary) body.appendChild(summary);
    }
  }

  panel.appendChild(body);

  void panel.offsetHeight; // senkron reflow zorla ki açılış transition'ı gerçekten oynasın
  overlay.classList.add('open');
  panel.classList.add('open');
}

export function attachDrawerOpener(el, node) {
  el.addEventListener('click', (e) => {
    if (e.target.closest('button, input')) return;
    openDrawer(node);
  });
}
