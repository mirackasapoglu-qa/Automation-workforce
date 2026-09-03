// Ağaç verisi: CRUD, migration, kalıcılık (localStorage), istatistik yardımcıları.
import { state, newId, newNoteId, newJiraId, newResourceLinkId, newStatusHistoryId, newJiraAnalysisId, newTestCaseId, newTestStepId, newTestRunId } from './state.js';
import { NEXT_TYPE, DEFAULT_NAME, STATUS_RANK } from './constants.js';
import { renderContent } from './shell.js';

/**
 * ⛔ localStorage anahtarlari EMEKLI. Agac artik sunucuda
 * (panel-data/scope/tree.json). Eski Flowscope kurulumundan veri tasimak
 * gerekirse tarayici konsolunda: localStorage.getItem('flowTool.tree.v2')
 */
export const LEGACY_STORAGE_KEY = 'flowTool.tree.v2';

/**
 * Agaci SUNUCUDAN yukler.
 *
 * Eskiden localStorage'dan okunuyordu: veri onu girenin tarayici profilinde
 * duruyordu, baskasi ayni adresi actiginda bos ekran goruyordu. Artik
 * panel-data/scope/tree.json tek kaynak.
 *
 * Hata SESSIZCE yutulmaz — yuklenemezse arayuz uyari gosterir ve YAZMA
 * KAPANIR (bos agaci kaydedip gercek veriyi ezmemek icin).
 */
export async function loadPersisted() {
  const res = await fetch('/api/scope/tree');
  if (!res.ok) throw new Error(`Agac okunamadi: HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data.tree)) state.tree = data.tree;
  state.jiraBaseUrl = data.trackerBaseUrl ? `${data.trackerBaseUrl}/browse/` : '';
  state.scopeSeeded = Boolean(data.seeded);
}

/**
 * `loadPersisted()` + tüm migration'lar + id sayaç/çakışma düzeltmeleri — app.js'in
 * ilk açılışta yaptığı sırayla AYNI. Sunucu ağacı kendi başına değiştirdiğinde
 * (ör. `POST /api/scope/jira/sweep`) istemcinin bellekteki kopyasını güncel
 * şemayla senkron tutmak için de kullanılır (bkz. jira.js → runJiraSweep()).
 */
export async function reloadPersistedTree() {
  await loadPersisted();
  migrateTypes(state.tree);
  migrateLinks(state.tree);
  migrateJira(state.tree);
  migrateJiraAnalyses(state.tree);
  migrateNotes(state.tree);
  migrateResourceLinks(state.tree);
  migrateStatusMeta(state.tree);
  migrateTestCases(state.tree);
  migrateTestCaseSteps(state.tree);
  fixIdCounter(state.tree);
  if (dedupeEntityIds(state.tree)) persist();
}

export function migrateTypes(nodes) {
  const OLD_TO_NEW = { ui: 'section', func: 'function' };
  nodes.forEach(n => {
    if (OLD_TO_NEW[n.type]) n.type = OLD_TO_NEW[n.type];
    migrateTypes(n.children);
  });
}

export function migrateLinks(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.linkTos)) n.linkTos = n.linkTo ? [n.linkTo] : [];
    delete n.linkTo;
    migrateLinks(n.children);
  });
}

export function migrateJira(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.jiraTasks)) {
      n.jiraTasks = (typeof n.jiraTaskId === 'string' && n.jiraTaskId.trim())
        ? [{ id: newJiraId(), taskId: n.jiraTaskId.trim(), createdAt: new Date().toISOString(), analyses: [] }]
        : [];
    }
    delete n.jiraTaskId;
    migrateJira(n.children);
  });
}

export function migrateNotes(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.notes)) {
      n.notes = (typeof n.note === 'string' && n.note.trim())
        ? [{ id: newNoteId(), text: n.note.trim(), createdAt: new Date().toISOString() }]
        : [];
    }
    delete n.note;
    migrateNotes(n.children);
  });
}

export function migrateResourceLinks(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.resourceLinks)) n.resourceLinks = [];
    migrateResourceLinks(n.children);
  });
}

// İnceleme durumları: 'beklemede' (onay bekliyor) -> 'onaylandı' (Jira'ya yorum olarak
// gönderildi) veya 'reddedildi'. Onaylama, sunucudaki gerçek Jira görevine POST atar —
// bu yüzden kullanıcının açık onayı olmadan hiçbir inceleme bu adımı geçemez.
export function migrateJiraAnalyses(nodes) {
  nodes.forEach(n => {
    n.jiraTasks.forEach(t => {
      if (!Array.isArray(t.analyses)) t.analyses = [];
      t.analyses.forEach(a => {
        if (!a.status) a.status = 'beklemede';
        if (!('jiraCommentPostedAt' in a)) a.jiraCommentPostedAt = null;
        if (!('jiraCommentError' in a)) a.jiraCommentError = null;
      });
    });
    migrateJiraAnalyses(n.children);
  });
}

export function migrateStatusMeta(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.statusHistory)) n.statusHistory = [];
    if (!('lastVerifiedAt' in n)) n.lastVerifiedAt = null;
    if (typeof n.staleReviewDays !== 'number') n.staleReviewDays = DEFAULT_STALE_DAYS;
    migrateStatusMeta(n.children);
  });
}

// QA test case'leri artık ilgili sayfa/komponentin kendi drawer'ında ("Test Case'ler"
// sekmesi) tutulur — docs/test-cases.md'deki gibi ayrı bir dosyada değil.
export function migrateTestCases(nodes) {
  nodes.forEach(n => {
    if (!Array.isArray(n.testCases)) n.testCases = [];
    migrateTestCases(n.children);
  });
}

// Test case'ler eskiden tek bir serbest metin `content` alanındaydı ("1. ...\n2. ...\n
// Beklenen: ...", koşum sonuçları da sonuna "\n\n---\nKoşum (<tarih>): <not>." olarak
// eklenirdi — bkz. qa-test-runner). Artık `steps` (adım başına {action, expected}) ve
// `runs` (koşum geçmişi, içeriğe hiç dokunmadan ayrı tutulur) alanlarına ayrıldı. Bu
// migration eski `content`'i kaybetmeden ikisine böler: en-best-effort tek bir adıma
// ("Beklenen" satırı varsa action/expected olarak ayrılır) ve koşum bloklarını `runs`'a
// aktarır. migrateTestCases'ten SONRA çağrılmalı (n.testCases dizisinin var olması gerekir).
export function migrateTestCaseSteps(nodes) {
  const RUN_MARKER = '\n\n---\nKoşum (';
  nodes.forEach(n => {
    n.testCases.forEach(tc => {
      if (!Array.isArray(tc.steps) || !Array.isArray(tc.runs)) {
        const content = typeof tc.content === 'string' ? tc.content : '';
        const markerIdx = content.indexOf(RUN_MARKER);
        const baseContent = markerIdx === -1 ? content : content.slice(0, markerIdx);
        const runsText = markerIdx === -1 ? '' : content.slice(markerIdx);

        if (!Array.isArray(tc.steps)) {
          const beklenenMatch = baseContent.match(/\n?Beklenen[^:\n]*:\s*/i);
          let action = baseContent.trim();
          let expected = '';
          if (beklenenMatch) {
            const idx = baseContent.indexOf(beklenenMatch[0]);
            action = baseContent.slice(0, idx).trim();
            expected = baseContent.slice(idx + beklenenMatch[0].length).trim();
          }
          tc.steps = (action || expected) ? [{ id: newTestStepId(), action, expected }] : [];
        }

        if (!Array.isArray(tc.runs)) {
          tc.runs = runsText.split(RUN_MARKER).filter(Boolean).map(piece => {
            const closeIdx = piece.indexOf('):');
            const at = closeIdx === -1 ? (tc.updatedAt || new Date().toISOString()) : piece.slice(0, closeIdx).trim();
            const note = closeIdx === -1 ? piece.trim() : piece.slice(closeIdx + 2).trim();
            return { id: newTestRunId(), at, status: tc.status, note };
          });
        }
      }
      delete tc.content;
    });
    migrateTestCaseSteps(n.children);
  });
}

export function fixIdCounter(nodes) {
  nodes.forEach(n => {
    const num = parseInt(String(n.id).replace('n', ''), 10);
    if (!isNaN(num) && num >= state.idCounter) state.idCounter = num + 1;
    n.notes.forEach(note => {
      const noteNum = parseInt(String(note.id).replace('note', ''), 10);
      if (!isNaN(noteNum) && noteNum >= state.noteIdCounter) state.noteIdCounter = noteNum + 1;
    });
    n.jiraTasks.forEach(t => {
      const jiraNum = parseInt(String(t.id).replace('jira', ''), 10);
      if (!isNaN(jiraNum) && jiraNum >= state.jiraIdCounter) state.jiraIdCounter = jiraNum + 1;
      (t.analyses || []).forEach(a => {
        const anNum = parseInt(String(a.id).replace('jan', ''), 10);
        if (!isNaN(anNum) && anNum >= state.jiraAnalysisIdCounter) state.jiraAnalysisIdCounter = anNum + 1;
      });
    });
    n.resourceLinks.forEach(r => {
      const resNum = parseInt(String(r.id).replace('res', ''), 10);
      if (!isNaN(resNum) && resNum >= state.resourceLinkIdCounter) state.resourceLinkIdCounter = resNum + 1;
    });
    n.statusHistory.forEach(h => {
      const shNum = parseInt(String(h.id).replace('sh', ''), 10);
      if (!isNaN(shNum) && shNum >= state.statusHistoryIdCounter) state.statusHistoryIdCounter = shNum + 1;
    });
    n.testCases.forEach(tc => {
      const tcNum = parseInt(String(tc.id).replace('tc', ''), 10);
      if (!isNaN(tcNum) && tcNum >= state.testCaseIdCounter) state.testCaseIdCounter = tcNum + 1;
      (tc.steps || []).forEach(s => {
        const tcsNum = parseInt(String(s.id).replace('tcs', ''), 10);
        if (!isNaN(tcsNum) && tcsNum >= state.testStepIdCounter) state.testStepIdCounter = tcsNum + 1;
      });
      (tc.runs || []).forEach(r => {
        const tcrNum = parseInt(String(r.id).replace('tcr', ''), 10);
        if (!isNaN(tcrNum) && tcrNum >= state.testRunIdCounter) state.testRunIdCounter = tcrNum + 1;
      });
    });
    fixIdCounter(n.children);
  });
}

// Ağaçta herhangi bir yerde (kendisi ya da alt öğeleri) "Devam Ediyor" var mı? Varsa, ağaç
// görünümü "spotlight" moduna geçer: devam eden dallar öne çıkar, geri kalanı soluklaşır.
export function treeHasProgress(nodes) {
  return nodes.some(n => n.status === '🔵' || treeHasProgress(n.children));
}

export function effectiveStatus(node) {
  if (!node.children.length) return node.status;
  let worst = '✅';
  node.children.forEach(c => {
    const s = effectiveStatus(c);
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  });
  return worst;
}

// Tüm durum değişiklikleri TEK bir yerden geçsin ki geçmiş kaydı (statusHistory) ve
// "Tamamlandı" durumuna en son ne zaman geçildiği (lastVerifiedAt) hiçbir çağrı noktasında
// unutulmasın. node.status'u doğrudan atamak yerine her zaman bu fonksiyon kullanılmalı.
export function setNodeStatus(node, newStatus) {
  if (node.status === newStatus) return;
  const now = new Date().toISOString();
  node.statusHistory.push({ id: newStatusHistoryId(), from: node.status, to: newStatus, at: now });
  node.status = newStatus;
  if (newStatus === '✅') node.lastVerifiedAt = now;
}

// Kullanıcı bir kart için kendi aralığını seçmezse bu varsayılan kullanılır (bkz. migrateStatusMeta,
// addChild). Sabit değil — her kartın kendi "staleReviewDays" alanı var ve drawer'dan değiştirilebilir.
export const DEFAULT_STALE_DAYS = 30;

export function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// "Tamamlandı" işaretlenip uzun süre yeniden doğrulanmamış öğeleri (regresyon riski) ayırt
// etmek için kullanılır. Sadece doğrudan durumu ayarlanabilen (leaf) öğeler için anlamlıdır.
// Eşik değeri her kart için ayrı ayarlanabilir (node.staleReviewDays).
export function isStale(node) {
  if (node.status !== '✅' || !node.lastVerifiedAt) return false;
  const threshold = node.staleReviewDays || DEFAULT_STALE_DAYS;
  return daysSince(node.lastVerifiedAt) > threshold;
}

// Test case'in durumu ASLA elle serbestçe seçilemez: hiç koşum yoksa sadece ⬜/🔵 (henüz
// koşulmadı / koşuluyor) elle işaretlenebilir, bir koşum eklendiği andan itibaren durum o
// koşumdan (en sonuncusundan) türer — "koşmadan ✅ dedim" senaryosunu mimari olarak imkansız
// kılmak için. tc.status alanı hâlâ yazılıyor (qa-test-runner) ama görüntülemede/karar
// vermede tek doğruluk kaynağı burası; ikisi arasında tutarsızlık olsa bile bu fonksiyon
// kazanır.
export function effectiveTestCaseStatus(tc) {
  return tc.runs && tc.runs.length ? tc.runs[tc.runs.length - 1].status : tc.status;
}

// node.isStale ile aynı mantık: bir test case en son ✅ ile kapandıktan sonra uzun süre
// yeniden koşulmadıysa (regresyon riski) sessizce güvenilir kalmasın, işaretlensin. Sabit
// DEFAULT_STALE_DAYS eşiği kullanılır — test case başına ayrı bir ayar yok (kapsamı düşük
// tutmak için).
export function isTestCaseRunStale(tc) {
  if (!tc.runs || !tc.runs.length) return false;
  const lastRun = tc.runs[tc.runs.length - 1];
  return lastRun.status === '✅' && daysSince(lastRun.at) > DEFAULT_STALE_DAYS;
}

// Eski oturumlarda not/jira/kaynak ID sayaçları kalıcı olmadığı için (bkz. fixIdCounter),
// farklı sayfa yüklemelerinde çakışan ID'ler üretilmiş olabilir. Bu, örn. tek bir Jira
// Task ID'sini kaldırırken aynı ID'yi paylaşan başka bir kaydın da silinmesine yol açar.
// fixIdCounter'dan SONRA çağrılmalı ki üretilecek yeni ID'ler de çakışmasın.
export function dedupeEntityIds(nodes) {
  const seenNote = new Set();
  const seenJira = new Set();
  const seenResource = new Set();
  const seenHistory = new Set();
  const seenAnalysis = new Set();
  const seenTestCase = new Set();
  const seenTestStep = new Set();
  const seenTestRun = new Set();
  let changed = false;
  (function walk(list) {
    list.forEach(n => {
      n.notes.forEach(note => {
        if (seenNote.has(note.id)) { note.id = newNoteId(); changed = true; }
        seenNote.add(note.id);
      });
      n.jiraTasks.forEach(t => {
        if (seenJira.has(t.id)) { t.id = newJiraId(); changed = true; }
        seenJira.add(t.id);
        (t.analyses || []).forEach(a => {
          if (seenAnalysis.has(a.id)) { a.id = newJiraAnalysisId(); changed = true; }
          seenAnalysis.add(a.id);
        });
      });
      n.resourceLinks.forEach(r => {
        if (seenResource.has(r.id)) { r.id = newResourceLinkId(); changed = true; }
        seenResource.add(r.id);
      });
      n.statusHistory.forEach(h => {
        if (seenHistory.has(h.id)) { h.id = newStatusHistoryId(); changed = true; }
        seenHistory.add(h.id);
      });
      n.testCases.forEach(tc => {
        if (seenTestCase.has(tc.id)) { tc.id = newTestCaseId(); changed = true; }
        seenTestCase.add(tc.id);
        (tc.steps || []).forEach(s => {
          if (seenTestStep.has(s.id)) { s.id = newTestStepId(); changed = true; }
          seenTestStep.add(s.id);
        });
        (tc.runs || []).forEach(r => {
          if (seenTestRun.has(r.id)) { r.id = newTestRunId(); changed = true; }
          seenTestRun.add(r.id);
        });
      });
      walk(n.children);
    });
  })(nodes);
  return changed;
}

export function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

/**
 * Agaci sunucuya yazar.
 *
 * ⚠️ Flowscope'un sessiz `catch`i TASINMADI: kaydetme basarisiz olursa
 * `state.saveError` set edilir ve ekranda kirmizi bir serit cikar. Kaynak
 * sistemde bu hata yutuluyordu ve degisiklik fark edilmeden kayboluyordu
 * (kendi dokumaninda "yuksek veri kaybi riski" olarak gecer).
 */
export function persist() {
  if (state.loadFailed) return;                 // yuklenemedigi durumda YAZMA
  fetch('/api/scope/tree', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
    body: JSON.stringify({ tree: state.tree }),
  })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      setSaveState(null);
    })
    .catch((e) => setSaveState(e.message));
}

/** Kaydetme durumunu ekranda gorunur kilar. */
export function setSaveState(errorMessage) {
  state.saveError = errorMessage ?? '';
  let el = document.getElementById('scope-save-bar');
  if (!errorMessage) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'scope-save-bar';
    el.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 14px;' +
      'background:#7f1d1d;color:#fff;font:13px/1.4 ui-monospace,monospace;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = `Kaydedilemedi — degisiklikler diske yazilmadi: ${errorMessage}`;
}
export const persistDebounced = debounce(persist, 400);

export function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

export function findParentArray(nodes, id, parentArr) {
  for (const n of nodes) {
    if (n.id === id) return parentArr;
    const f = findParentArray(n.children, id, n.children);
    if (f) return f;
  }
  return null;
}

export function addChild(parentId) {
  const parent = parentId ? findNode(state.tree, parentId) : null;
  const type = parent ? (NEXT_TYPE[parent.type] || 'step') : 'module';
  const child = {
    id: newId(), name: DEFAULT_NAME[type], type, status: '⬜', notes: [], jiraTasks: [], resourceLinks: [],
    statusHistory: [], lastVerifiedAt: null, staleReviewDays: DEFAULT_STALE_DAYS, linkTos: [], open: true, children: [],
    testCases: []
  };
  if (parent) { parent.open = true; parent.children.push(child); }
  else { state.tree.push(child); }
  persist();
  renderContent();
  requestAnimationFrame(() => {
    const input = state.root.querySelector(`[data-node-id="${child.id}"] input`);
    if (input) {
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

export function getDescendantIds(node, acc) {
  acc.add(node.id);
  node.children.forEach(c => getDescendantIds(c, acc));
  return acc;
}

export function clearDanglingLinks(nodes, removedIds) {
  nodes.forEach(n => {
    if (n.linkTos && n.linkTos.length) n.linkTos = n.linkTos.filter(id => !removedIds.has(id));
    clearDanglingLinks(n.children, removedIds);
  });
}

export function removeNode(id) {
  const arr = findParentArray(state.tree, id, state.tree);
  if (arr) {
    const idx = arr.findIndex(n => n.id === id);
    if (idx > -1) {
      const removedIds = getDescendantIds(arr[idx], new Set());
      arr.splice(idx, 1);
      clearDanglingLinks(state.tree, removedIds);
    }
  }
  persist();
  renderContent();
}

export function clearAll() {
  if (!confirm('Tüm veriler silinsin mi? Bu işlem geri alınamaz.')) return;
  state.tree = [];
  persist();
  renderContent();
}

export function computeStats(nodes, acc) {
  acc = acc || { total: 0, '✅': 0, '❌': 0, '⚠️': 0, '⬜': 0, '🔵': 0 };
  nodes.forEach(n => {
    acc.total++;
    acc[effectiveStatus(n)] = (acc[effectiveStatus(n)] || 0) + 1;
    computeStats(n.children, acc);
  });
  return acc;
}

// Bir düğümün TÜM alt öğelerini (kendisi hariç) tarayıp durum dağılımını, açık/çözülmüş hata
// sayısını ve loglanmış notları toplar. "Çözülmüş hata" = bir zamanlar Jira Task ID gerektirecek
// kadar "Hatalı" işaretlenmiş (yani jiraTasks'ı dolu) ama şu an durumu artık "Hatalı" olmayan öğe —
// Jira ID'leri durum değişse bile silinmediği için bu, geçmişte hata olduğunun güvenilir bir izi.
export function collectDescendantStats(node) {
  const stats = {
    total: 0, '✅': 0, '❌': 0, '⚠️': 0, '⬜': 0, '🔵': 0,
    bugCount: 0, resolvedBugCount: 0, notes: [], testCaseNodes: []
  };
  (function walk(n) {
    n.children.forEach(c => {
      stats.total++;
      stats[c.status] = (stats[c.status] || 0) + 1;
      if (c.status === '❌') stats.bugCount++;
      else if (c.jiraTasks.length) stats.resolvedBugCount++;
      c.notes.forEach(note => stats.notes.push({ ...note, nodeName: c.name, nodeId: c.id }));
      // Alt ağaçta test case'lerin nerede yaşadığını görünür kılmak için (bkz.
      // subtree-summary.js) — yeni bir case eklemeden önce aynı davranışı zaten
      // kapsayan bir case var mı görülebilsin, körlemesine tekrar yazılmasın.
      if (c.testCases.length) stats.testCaseNodes.push({ nodeId: c.id, nodeName: c.name, count: c.testCases.length });
      walk(c);
    });
  })(node);
  stats.notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return stats;
}

// Sadece isimde değil, test case başlıklarında, Jira Task ID'lerinde ve not metinlerinde de
// arar — büyüyen bir ağaçta (300+ düğüm) sadece isimle aramak yetersiz kalıyordu.
export function nodeMatchesQuery(node, query) {
  if (node.name.toLowerCase().includes(query)) return true;
  if (node.testCases.some(tc => (tc.title || '').toLowerCase().includes(query))) return true;
  if (node.jiraTasks.some(t => (t.taskId || '').toLowerCase().includes(query))) return true;
  if (node.notes.some(n => (n.text || '').toLowerCase().includes(query))) return true;
  return false;
}

export function subtreeMatchesQuery(node, query) {
  if (nodeMatchesQuery(node, query)) return true;
  return node.children.some(c => subtreeMatchesQuery(c, query));
}

// Facet filtreleri: metin aramasından bağımsız, düğümün kendi verisine dayalı hızlı
// filtreler. Hepsi birden AND'lenir (aktif facet'lerin TÜMÜNÜ karşılamalı) — arama
// metniyle de AND'lenir (bkz. nodeMatchesFilters). Her facet'in "why" bilgisi burada:
// büyük bir ağaçta düğüm düğüm gezmeden "neyi unuttum" sorusuna cevap vermek için.
// `state.jiraStatusCache`, bir düğümün drawer'ı açıldığında (jira.js → refreshJiraStatuses)
// YA DA bir Jira taraması çalıştığında (jira.js → runJiraSweep) dolan, PAYLAŞILAN bir önbellek
// — `{taskId: {found, statusCategory, ...}}`. "Bilinen ve done değil" kararı TEK yerden
// verilsin diye (autoFlagFromJiraStatus ile facet predicate'i arasında mantık kaymasın).
export function jiraTaskIsKnownNotDone(taskInfo) {
  return Boolean(taskInfo) && taskInfo.found !== false && Boolean(taskInfo.statusCategory) && taskInfo.statusCategory !== 'done';
}

export const FACET_META = {
  hatali: { label: 'Hatalı', predicate: (node) => effectiveStatus(node) === '❌' },
  noTestCase: { label: 'Test Case Yok', predicate: (node) => node.testCases.length === 0 },
  stale: {
    label: 'Bayat',
    predicate: (node) => isStale(node) || node.testCases.some(tc => isTestCaseRunStale(tc))
  },
  noJira: { label: 'Jira Yok', predicate: (node) => node.jiraTasks.length === 0 },
  // Yalnızca BİLİNEN (bir tarama ya da drawer poll'u durumu gerçekten çekmiş) ve "done"
  // olmayan Task ID'si olan düğümleri gösterir. "Hatalı" facet'inden daha DAR: bir düğüm
  // başka bir sebeple (elle) ❌ olabilir, bu facet özellikle Jira'ya bağlı olanı hedefler.
  // Hiç tarama/poll çalışmadıysa jiraStatusCache boştur, bu facet de boş döner — "bilinmiyor"u
  // "done değil" saymaz.
  jiraNotDone: {
    label: 'Jira: Done Değil',
    predicate: (node) => node.jiraTasks.some(t => jiraTaskIsKnownNotDone(state.jiraStatusCache[t.taskId])),
  },
};

export function nodeMatchesFacets(node, facets) {
  if (!facets || !facets.size) return true;
  return [...facets].every(key => FACET_META[key] && FACET_META[key].predicate(node));
}

function nodeMatchesFilters(node, query, facets) {
  return (!query || nodeMatchesQuery(node, query)) && nodeMatchesFacets(node, facets);
}

function subtreeMatchesFilters(node, query, facets) {
  if (nodeMatchesFilters(node, query, facets)) return true;
  return node.children.some(c => subtreeMatchesFilters(c, query, facets));
}

// Arama ve/veya facet filtreleri aktifken hangi node'ların görünür kalacağını tek seferde
// hesaplar: bir eşleşmenin kendisi, atalarının tamamı (yol görünsün diye) ve bir atası
// eşleştiyse tüm alt ağacı (kullanıcı zaten o dalı bulmuş demektir, çocuklarını da görmek
// ister). `facets` boş bir Set/undefined olabilir — o zaman sadece metin araması geçerli.
export function computeSearchVisibleIds(nodes, query, facets) {
  const visible = new Set();
  (function walk(list, forced) {
    list.forEach(n => {
      const show = forced || subtreeMatchesFilters(n, query, facets);
      if (show) visible.add(n.id);
      walk(n.children, forced || nodeMatchesFilters(n, query, facets));
    });
  })(nodes, false);
  return visible;
}

// Ağaç genelinde "koşulmayı bekleyen" (hiç koşum almamış) ve "bayat" (son koşumu ✅ ama
// DEFAULT_STALE_DAYS'ten eski) test case'leri tek listede toplar — bkz. attention-panel.js.
// Zaten ❌/⚠️ olanlar dahil edilmez, onlar zaten Hatalı/Uyarılı istatistiğinde görünür oluyor;
// buradaki amaç "gözden kaçmış, dikkat gerektiren" öğeleri yüzeye çıkarmak.
export function collectAttentionTestCases(nodes) {
  const results = [];
  (function walk(list, ancestors) {
    list.forEach(n => {
      const path = ancestors.concat(n.name);
      n.testCases.forEach(tc => {
        if (!tc.runs.length) {
          results.push({ nodeId: n.id, nodePath: path.join(' › '), tcId: tc.id, title: tc.title, reason: 'pending', at: tc.updatedAt });
        } else if (isTestCaseRunStale(tc)) {
          const lastRun = tc.runs[tc.runs.length - 1];
          results.push({ nodeId: n.id, nodePath: path.join(' › '), tcId: tc.id, title: tc.title, reason: 'stale', at: lastRun.at });
        }
      });
      walk(n.children, path);
    });
  })(nodes, []);
  const reasonWeight = { pending: 0, stale: 1 };
  results.sort((a, b) => (reasonWeight[a.reason] - reasonWeight[b.reason]) || (a.at || '').localeCompare(b.at || ''));
  return results;
}

export function flattenWithPath(nodes, ancestors, acc) {
  nodes.forEach(n => {
    acc.push({ node: n, path: ancestors });
    flattenWithPath(n.children, ancestors.concat(n.name), acc);
  });
  return acc;
}
