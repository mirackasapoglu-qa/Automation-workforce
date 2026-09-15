/*
 * PANEL → FLOWSCOPE CANLI BAĞI.
 *
 * Ağaç artık yalnızca bu ekrandan değişmiyor: panelden başlatılan bir koşumun
 * sonucu, perf ölçümü, Jira bağlama ve sunucuda üretilen test case'ler ağaca
 * YAZILIYOR (bkz. panel/scope.mjs → applyRunResultsBySpecs / applyPerfToTree).
 * Bu dosya olmadan Flowscope o değişiklikleri ancak sayfa yenilenince görürdü;
 * kullanıcı açısından "panelde koştum, ağaçta hiçbir şey olmadı" demekti.
 *
 * ⚠️ KENDİ YAZMAMIZA TEPKİ VERMİYORUZ. Sunucu her yazmayı bir `reason` ile
 * yayıyor; `edit` = bu ekranın kendi `persist()` çağrısı (PUT /api/scope/tree).
 * Onu da tazeleseydik kullanıcı yazarken ağaç altından yeniden çizilir, açık
 * input'un odağı ve yarım kalan metni giderdi.
 *
 * ⚠️ ODAK KORUMASI: bir metin alanı odaktayken tazeleme ERTELENİR (odak
 * kaybında yapılır). Sunucudan gelen bir koşum sonucu, kullanıcının o an
 * yazdığı notu ekrandan silmemeli.
 */
import { reloadPersistedTree } from './data.js';
import { renderContent, refreshAttentionBadge } from './shell.js';
import { renderDrawer } from './drawer.js';
import { state } from './state.js';
import { uiToast } from './dialog.js';

/** Bu ekranın kendi düzenlemesi — tazeleme gerektirmez. */
const KENDI = new Set(['edit']);

/** `reason` → kullanıcıya gösterilecek tek satır. Bilinmeyen sebep sessiz geçer. */
const SEBEP = {
  run: 'Koşum sonucu ağaca yazıldı',
  perf: 'Performans ölçümü ağaca işlendi',
  jira: 'Jira kartı bağlandı',
  'jira-sweep': 'Jira durumları tarandı',
  drift: 'Drift taraması ağacı güncelledi',
  testcase: 'Test case üretildi',
  'backfill-routes': 'Düğümlere rota bilgisi yazıldı',
  seed: 'Kapsam ağacı yeniden tohumlandı',
};

let bekleyen = null;

/** Metin girişi odaktaysa tazeleme yapma — yazılanı uçurur. */
function yazmaSuruyor() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

async function tazele(info) {
  try {
    await reloadPersistedTree();
    renderContent();
    if (state.drawerNode) {
      // Drawer açıksa gösterdiği düğüm nesnesi ARTIK ESKİ ağaçtan; yeni ağaçtaki
      // aynı id'li düğüme bağlanmazsa drawer bayat veri gösterir.
      const yeni = bul(state.tree, state.drawerNode.id);
      if (yeni) { state.drawerNode = yeni; renderDrawer(); }
    }
    refreshAttentionBadge();
    const mesaj = SEBEP[info?.reason];
    if (mesaj) uiToast(`${mesaj} — kapsam tazelendi.`, { type: 'info', ms: 5000 });
  } catch (e) {
    // Tazeleme başarısızsa EKRANI BOZMA: eski ağaç ekranda kalsın, sebep konsolda.
    console.warn('kapsam tazelenemedi:', e.message);
  }
}

function bul(list, id) {
  for (const n of list ?? []) {
    if (n.id === id) return n;
    const f = bul(n.children, id);
    if (f) return f;
  }
  return null;
}

export function initLiveSync() {
  let es;
  try { es = new EventSource('/api/events'); }
  catch { return; }   // SSE yoksa Flowscope eskisi gibi çalışır

  es.addEventListener('scope-changed', (e) => {
    let info = {};
    try { info = JSON.parse(e.data) || {}; } catch { /* veri tasimiyor zaten */ }
    if (KENDI.has(info.reason)) return;
    if (yazmaSuruyor()) { bekleyen = info; return; }
    tazele(info);
  });

  // Tasarım diff (panel sunucusunda koşar) → çekmecedeki Figma şeridi ve toast
  // (design-diff.js dinler). Veri olduğu gibi aktarılır; burada yorum yok.
  for (const t of ['diff-start', 'diff-end']) {
    es.addEventListener(t, (e) => {
      let d = {};
      try { d = JSON.parse(e.data) || {}; } catch { /* veri yok */ }
      document.dispatchEvent(new CustomEvent('figma-diff', { detail: { ...d, type: t === 'diff-end' ? 'end' : 'start' } }));
    });
  }

  // Odak kaybında ertelenmiş tazeleme yapılır.
  document.addEventListener('focusout', () => {
    if (!bekleyen) return;
    const info = bekleyen; bekleyen = null;
    setTimeout(() => { if (!yazmaSuruyor()) tazele(info); }, 150);
  });
}
