// Test case üretiminin İSTEMCİ tarafı — tek giriş noktası.
//
// Panel modeli kendisi çağırmıyor (ne Anthropic anahtarı ne `ant` profili):
// sunucu seçili düğümlerin bağlamından prompt kuruyor, kullanıcı onu Claude
// Code'a veriyor, dönen JSON aynı modalden ağaca yazılıyor.
//
// Hem düğüm detayındaki (drawer) hem çoklu seçimdeki (bulk bar) düğme burayı
// çağırır — iki yerde aynı akışı ayrı ayrı kurmak, birinin diğerinden sapmasıyla
// sonuçlanıyordu.
import { openAiAssistModal } from './ai-assist.js';
import { loadPersisted } from './data.js';
import { renderContent } from './shell.js';

function headers() {
  return { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' };
}

/**
 * @param {string[]} nodeIds   bağlamı toplanacak düğümler
 * @param {string[]} types     istenen test türleri (arayüz anahtarları kabul edilir)
 * @param {number}   limit     düğüm başına en fazla case
 * @param {() => void} [afterApply]  yazma sonrası ek tazeleme (drawer'ı yeniden çizmek gibi)
 */
export async function openTestCaseRequest({ nodeIds, types, limit = 4, afterApply }) {
  const ids = (nodeIds ?? []).filter(Boolean);
  if (!ids.length) return;

  const res = await fetch('/api/scope/testcases/prompt', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ nodeIds: ids, types, limit }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
  if (!data.ok) { alert(data.error || 'Prompt üretilemedi.'); return; }

  openAiAssistModal({
    title: ids.length > 1
      ? `Claude Code için prompt hazır — ${data.nodes.length} düğüm`
      : 'Claude Code için prompt hazır',
    description: '1. Bu mesajı kopyala ve Claude Code sohbetine yapıştır. Yanıt sadece JSON olacak.',
    prompt: data.prompt,
    applyLabel: 'Case\'leri ağaca yaz',
    onApply: async (govde) => {
      // `allowedNodeIds`: sunucudaki kapı (testcase-gen.mjs → gate()) modelin
      // burada hiç istenmeyen ama ağaçta gerçekten var olan başka bir düğümü
      // "icat edip" oraya case yazmasını engeller. Yapıştırılan JSON bunu
      // taşımaz — biz orijinal istekten (ids) ekliyoruz.
      const r = await fetch('/api/scope/testcases/apply', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...govde, allowedNodeIds: ids }),
      });
      const out = await r.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
      // Sessiz başarısızlık yok: sebep neyse modalde yazılı kalır.
      if (!out.ok) throw new Error(out.error || 'Yazılamadı.');
      await loadPersisted();
      renderContent();
      if (afterApply) afterApply();
      const atlanan = (out.sonuc ?? []).reduce((a, x) => a + (x.skipped || 0), 0);
      const hatali = (out.sonuc ?? []).filter((x) => x.error);
      return [
        `${out.written} case yazıldı${atlanan ? `, ${atlanan} tekrar atlandı` : ''}.`,
        hatali.length ? `Yazılamayan düğüm: ${hatali.map((x) => x.nodeId).join(', ')}` : '',
        'Case\'ler TASLAK — koşum kaydı yok, koşulmadan "geçti" seçilemez.',
      ].filter(Boolean).join('\n');
    },
  });
}
