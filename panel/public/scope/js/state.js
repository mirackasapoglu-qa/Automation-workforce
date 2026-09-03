// Paylaşılan mutable durum. ES modüllerinde import edilen bir `let` dışarıdan yeniden
// atanamadığı için (sadece okunabilir canlı binding), tüm mutable durumu TEK bir nesnenin
// property'leri olarak tutuyoruz. Her yerde `state.tree = ...` gibi property ataması
// kullanılır — değişkenin kendisi asla yeniden atanmaz.

export const state = {
  idCounter: 1,
  noteIdCounter: 1,
  jiraIdCounter: 1,
  resourceLinkIdCounter: 1,
  statusHistoryIdCounter: 1,
  jiraAnalysisIdCounter: 1,
  testCaseIdCounter: 1,
  testStepIdCounter: 1,
  testRunIdCounter: 1,

  jiraBaseUrl: '',
  jiraStatusCache: {}, // taskId -> { found, statusName, statusCategory, summary }
  jiraStatusError: '',
  jiraStatusLoading: false,

  tree: [],

  // `/api/meta`'dan gelen bilinen ürün hataları — `{id, where, detail, nodeId}`.
  // `nodeId` doluysa drawer o düğümde bir uyarı gösterir (bkz. app.js, drawer.js).
  knownIssues: [],

  // Sunucu tarafi kalicilik (bkz. data.js). `loadFailed` true iken YAZMA yapilmaz:
  // bos agaci kaydedip diskteki gercek veriyi ezmemek icin.
  loadFailed: false,
  saveError: '',
  scopeSeeded: false,

  currentView: 'tree',
  diagramZoom: null, // null = sığdır; aksi halde belirli bir ölçek
  currentDiagramScale: 1,
  diagramLayoutCache: null,

  searchQuery: '',
  activeFacets: new Set(),

  selectMode: false,
  selectedIds: new Set(),

  drawerNode: null,
  drawerTab: 'genel',

  openMenuEl: null, // dropdown.js VE jira.js paylaşıyor: aynı anda tek bir açılır panel

  root: null // init() içinde document.getElementById('fw-root') ile doldurulur
};

export function newId() { return 'n' + (state.idCounter++); }
export function newNoteId() { return 'note' + (state.noteIdCounter++); }
export function newJiraId() { return 'jira' + (state.jiraIdCounter++); }
export function newResourceLinkId() { return 'res' + (state.resourceLinkIdCounter++); }
export function newStatusHistoryId() { return 'sh' + (state.statusHistoryIdCounter++); }
export function newJiraAnalysisId() { return 'jan' + (state.jiraAnalysisIdCounter++); }
export function newTestCaseId() { return 'tc' + (state.testCaseIdCounter++); }
export function newTestStepId() { return 'tcs' + (state.testStepIdCounter++); }
export function newTestRunId() { return 'tcr' + (state.testRunIdCounter++); }
