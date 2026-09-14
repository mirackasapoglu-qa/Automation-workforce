// Paketler — KOŞUM MOTORU. DOM'a hiç dokunmaz; paketteki sayfaları sırayla
// gerçekten koşturur, ilerlemeyi bir callback ile bildirir. Popup/ilerleme
// çubuğu gibi görsel taraf packages.js'te (openPackageRunModal, buildRunSection).
import { state } from './state.js';
import { findNode, loadPersisted } from './data.js';
import { collectEffectiveTestCaseItems, dedupeTestCaseItems, nowIso } from './packages-data.js';

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

/**
 * Paketin gerçek koşumu — drawer.js → renderAutomatedRunSection'daki TEK
 * düğüm koşumunun ("Testi Koştur") AYNI ucunu (`/api/scope/run`) kullanır,
 * sadece paketteki her FARKLI sayfa için sırayla tekrarlar (içerdiği paketler
 * dahil, özyinelemeli — bkz. collectEffectiveTestCaseItems). Test case
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
export async function runPackage(pkg, onProgress, stopFlag) {
  const nodeIds = [...new Set(dedupeTestCaseItems(collectEffectiveTestCaseItems(pkg)).map((it) => it.nodeId))]
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
