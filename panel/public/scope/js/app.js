// Giriş noktası: DOM hazır olduğunda state.root'u bağlar, kalıcı veriyi yükler,
// migration'ları belirli sırayla çalıştırır, sonra uygulamayı başlatır.
import { state } from './state.js';
import {
  loadPersisted, migrateTypes, migrateLinks, migrateJira, migrateJiraAnalyses, migrateNotes, migrateResourceLinks,
  migrateStatusMeta, migrateTestCases, migrateTestCaseSteps, fixIdCounter, dedupeEntityIds, findNode, persist, setSaveState
} from './data.js';
import { init } from './shell.js';
import { openDrawer } from './drawer.js';

async function bootstrap() {
  state.root = document.getElementById('fw-root');

  try {
    await loadPersisted();
  } catch (e) {
    // Yuklenemedi: YAZMAYI KAPAT. Bos agaci kaydedip diskteki gercek veriyi
    // ezmek, sessiz veri kaybinin ta kendisi olurdu.
    state.loadFailed = true;
    setSaveState(e.message);
    return;
  }
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

  init();
  openNodeFromHash();
}

// Paylaşılabilir link: drawer açıkken URL'e #node=<id> yazılır (bkz. drawer.js). Sayfa bu
// hash ile açılırsa ilgili öğenin drawer'ı otomatik açılır.
function openNodeFromHash() {
  const match = location.hash.match(/node=([^&]+)/);
  if (!match) return;
  const node = findNode(state.tree, decodeURIComponent(match[1]));
  if (node) openDrawer(node);
}

bootstrap();
