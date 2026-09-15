// TASARIM DIFF — düğümün Figma kaynağından (2026-09-15).
//
// Panelin ayrı "Tasarım diff" sekmesi kaldırıldı: diff, düğüme bağlı bir eylem.
// Kaynaklar'daki node-id'li her Figma satırının altında bu şerit durur:
//   son rapor özeti (birebir · spec farkı · eksik · tarih) + "raporu aç" + "Diff al".
// Koşum panel sunucusunda (POST /api/figma/diff, ~45 sn); bitişi SSE ile gelir
// (live.js → `figma-diff` belge olayı), şerit ve toast o anda güncellenir.
//
// Rota: düğümün `route`u ya da site adresi — sunucu türetir (/api/scope/routes).
// Rota yoksa diff alınamaz; şerit sebebini söyler.
import { uiToast } from './dialog.js';

let rotaCache = { at: 0, list: null };
let raporCache = { at: 0, list: null };
const KOSAN = new Set();   // diff'i süren düğüm id'leri (sunucu tek diff koşturur)

async function rotalar() {
  if (rotaCache.list && Date.now() - rotaCache.at < 20_000) return rotaCache.list;
  try {
    const d = await (await fetch('/api/scope/routes')).json();
    rotaCache = { at: Date.now(), list: d.routes ?? [] };
  } catch { rotaCache = { at: Date.now(), list: [] }; }
  return rotaCache.list;
}
async function raporlar() {
  if (raporCache.list && Date.now() - raporCache.at < 20_000) return raporCache.list;
  try { raporCache = { at: Date.now(), list: await (await fetch('/api/figma/reports')).json() }; }
  catch { raporCache = { at: Date.now(), list: [] }; }
  return raporCache.list;
}

export function figmaNodeId(url) {
  try { return new URL(url).searchParams.get('node-id'); } catch { return null; }
}

function sonRapor(list, nodeId, rota) {
  const aday = (list ?? []).filter((r) => (nodeId && r.nodeId === nodeId) || (rota && r.route === rota && !r.nodeId));
  aday.sort((a, b) => String(b.generatedAt ?? '').localeCompare(String(a.generatedAt ?? '')));
  return aday[0] ?? null;
}
const tarih = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');

/** Kaynaklar listesine, Figma satırının hemen altına eklenen şerit. `null` = node-id'siz link, şerit yok. */
export function renderDesignDiffRow(node, link) {
  if (!figmaNodeId(link.url)) return null;
  const row = document.createElement('div');
  row.className = 'drawer-resource-diff';
  row.dataset.node = node.id;
  row.innerHTML = '<span class="drawer-resource-diff-info">okunuyor…</span>';
  ciz(row);
  return row;
}

async function ciz(row) {
  const nodeId = row.dataset.node;
  const rota = (await rotalar()).find((r) => r.nodeId === nodeId || (r.alsoNodes ?? []).includes(nodeId)) ?? null;
  const son = sonRapor(await raporlar(), nodeId, rota?.path);
  const kosuyor = KOSAN.has(nodeId);
  if (!row.isConnected) return;   // çekmece bu arada kapanmış

  row.innerHTML = '';
  const info = document.createElement('span');
  info.className = 'drawer-resource-diff-info';
  if (!rota) {
    info.textContent = 'Rota yok — düğüme route ya da site adresi ekle; tasarım diff alınamaz.';
  } else if (kosuyor) {
    info.innerHTML = `<i class="drawer-resource-diff-pulse"></i>diff koşuyor… <span class="faint">${rota.path} · ~45 sn</span>`;
  } else if (son?.counts) {
    const c = son.counts;
    info.innerHTML = `<b>${c.clean}</b> birebir · <b>${c.mismatched}</b> spec farkı · <b class="${c.missing ? 'bad' : ''}">${c.missing}</b> eksik`
      + `<span class="faint"> · ${tarih(son.generatedAt)}</span>`;
    info.title = `${son.frame ?? ''} — ${rota.path}`;
  } else {
    info.innerHTML = `Tasarım diff · <span class="faint">${rota.path} için henüz alınmadı</span>`;
  }
  row.appendChild(info);

  const acts = document.createElement('span');
  acts.className = 'drawer-resource-diff-actions';
  if (son?.reportUrl) {
    const a = document.createElement('a');
    a.href = son.reportUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'raporu aç';
    a.title = 'HTML rapor: işaretli tasarım ve canlı ekran görüntüleri, metin tablosu';
    acts.appendChild(a);
  }
  if (rota) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = son ? 'Yeniden al' : 'Diff al';
    b.disabled = kosuyor;
    b.title = 'Figma frame metinlerini canlı sayfayla karşılaştırır (~45 sn). Ağacı değiştirmez.';
    b.onclick = () => baslat(row, nodeId, rota);
    acts.appendChild(b);
  }
  row.appendChild(acts);
}

async function baslat(row, nodeId, rota) {
  KOSAN.add(nodeId); ciz(row);
  let d;
  try {
    const res = await fetch('/api/figma/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
      body: JSON.stringify({ path: rota.path, nodeId }),
    });
    d = await res.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
  } catch (e) { d = { ok: false, error: e.message }; }
  if (!d.ok) {
    KOSAN.delete(nodeId); ciz(row);
    const msg = d.code === 'NO_MAP'
      ? 'Bu düğümün Figma linkinde node-id yok ya da rota eşleşmedi.'
      : d.error || 'Diff başlatılamadı.';
    uiToast(msg, { type: 'err', title: 'Tasarım diff' });
    return;
  }
  uiToast(`Diff başladı: ${rota.path} — bitince şerit güncellenir, özet toast gelir.`, { type: 'info', title: 'Tasarım diff' });
}

/* Sunucudan gelen diff olayları (live.js yayar). Tek diff koştuğu için bitişte
   hepsi temizlenir; "start" panelden/Site'den başlatılan diff'i de gösterir. */
document.addEventListener('figma-diff', (e) => {
  const d = e.detail ?? {};
  if (d.type === 'start') {
    if (d.nodeId) KOSAN.add(d.nodeId);
  } else {
    KOSAN.clear();
    raporCache.at = 0;
    const c = d.summary?.counts;
    uiToast(
      c ? `${d.route ?? ''}: ${c.clean} birebir · ${c.mismatched} spec farkı · ${c.missing} eksik`
        : `Diff bitti (çıkış ${d.code}) — rapor üretilemedi, sunucu logunu gör.`,
      { type: c ? (c.missing || c.mismatched ? 'info' : 'ok') : 'err', title: 'Tasarım diff', ms: 12_000 },
    );
  }
  document.querySelectorAll('.drawer-resource-diff[data-node]').forEach((row) => ciz(row));
});
