// Tasarım Drift Radarı — istemci ucu. Sunucudaki /api/scope/design/sweep'i
// tetikler: ✅ + Figma kaynaklı düğümler için dosya son-değişim tarihini
// lastVerifiedAt'la kıyaslar, drift varsa düğümü ⚠️'ye çeker (tek yönlü,
// bkz. panel/scope.mjs → sweepDesignDrift). attention-panel.js bunu Jira
// taramasıyla aynı noktadan (panel açılışı) çağırır.
import { reloadPersistedTree } from './data.js';

export async function runDesignDriftSweep() {
  try {
    const res = await fetch('/api/scope/design/sweep', {
      method: 'POST',
      headers: { 'x-panel-token': window.PANEL_TOKEN ?? '' },
    });
    const data = await res.json();
    if (!data.ok) return null;
    if (data.flagged.length) await reloadPersistedTree();
    return { scannedNodes: data.scannedNodes, scannedFiles: data.scannedFiles, flagged: data.flagged };
  } catch (e) {
    return null;
  }
}
