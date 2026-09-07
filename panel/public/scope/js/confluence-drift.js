// Doküman Drift Radarı (Confluence) — istemci ucu. design-drift.js (Figma)
// ile BİREBİR AYNI şekil, farklı uç: /api/scope/confluence/sweep, ✅ +
// Confluence kaynaklı düğümler için sayfa son-düzenleme tarihini
// lastVerifiedAt'la kıyaslar, drift varsa düğümü ⚠️'ye çeker (tek yönlü,
// bkz. panel/scope.mjs → sweepResourceDrift).
import { reloadPersistedTree } from './data.js';

export async function runConfluenceDriftSweep() {
  try {
    const res = await fetch('/api/scope/confluence/sweep', {
      method: 'POST',
      headers: { 'x-panel-token': window.PANEL_TOKEN ?? '' },
    });
    const data = await res.json();
    if (!data.ok) return null;
    if (data.flagged.length) await reloadPersistedTree();
    return { scannedNodes: data.scannedNodes, scannedPages: data.scannedPages, flagged: data.flagged };
  } catch (e) {
    return null;
  }
}
