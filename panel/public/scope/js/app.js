// Giriş noktası: DOM hazır olduğunda state.root'u bağlar, kalıcı veriyi yükler,
// migration'ları belirli sırayla çalıştırır, sonra uygulamayı başlatır.
import { state } from './state.js';
import { reloadPersistedTree, findNode, setSaveState } from './data.js';
import { loadPackages } from './packages.js';
import { init } from './shell.js';
import { openDrawer } from './drawer.js';
import { initLiveSync } from './live.js';

async function bootstrap() {
  state.root = document.getElementById('fw-root');

  try {
    await reloadPersistedTree();
  } catch (e) {
    // Yuklenemedi: YAZMAYI KAPAT. Bos agaci kaydedip diskteki gercek veriyi
    // ezmek, sessiz veri kaybinin ta kendisi olurdu.
    state.loadFailed = true;
    setSaveState(e.message);
    return;
  }

  await loadPackagesQuietly();
  await loadKnownIssues();
  init();
  openNodeFromHash();
  // Panelden gelen agac degisikliklerini canli izle (kosum sonucu, perf, Jira,
  // test case). Kendi duzenlememize tepki vermez — bkz. live.js.
  initLiveSync();
}

/**
 * Paketler ağaçtan AYRI bir dosyada (bkz. packages.mjs) — yüklemesi ağacın
 * yüklenmesini bloklamaz (bilinen hatalar gibi bir "bonus"), ama başarısız
 * olursa YAZMAYI kapatır: aksi halde bir sonraki paket kaydı sunucudaki
 * gerçek listeyi boş bir kopyayla ezerdi (bkz. packages.js → persistPackages).
 */
async function loadPackagesQuietly() {
  try {
    await loadPackages();
  } catch (e) {
    state.packagesLoadFailed = true;
  }
}

/**
 * Bilinen ürün hatalarını (`tests/known-issues.ts`, `panel/server.mjs → knownIssues()`
 * ile ayrıştırılır) `/api/meta`'dan çeker. Token GEREKTİRMEZ (salt okuma) ve
 * ağaç yüklemesini ENGELLEMEZ — bu bir "bonus" uyarı katmanı, başarısız olursa
 * (ağ hatası, endpoint yok) sessizce boş kalır, uygulamanın geri kalanı çalışır.
 */
async function loadKnownIssues() {
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) return;
    const data = await res.json();
    state.knownIssues = Array.isArray(data.knownIssues) ? data.knownIssues : [];
  } catch (e) {
    // sessizce gec — bilinen hata uyarisi bir "bonus", ağacın yüklenmesini bloklamaz
  }
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
