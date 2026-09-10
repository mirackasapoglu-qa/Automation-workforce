// Test case üretiminin İSTEMCİ tarafı — tek giriş noktası.
//
// İki yol, sunucunun söylediği sıraya göre (`GET /api/ai/status`):
//   tek tık  — sağlayıcı varsa (sunucuda ANTHROPIC_API_KEY, yerelde Claude Code
//              CLI) panel modeli kendisi çağırır ve case'leri doğrudan ağaca yazar
//   elle     — yoksa (ya da tek tık 501 dönerse) sunucu istemi kurar, kullanıcı
//              Claude Code'a verir, dönen JSON aynı modalden ağaca yazılır
//
// Hem düğüm detayındaki (drawer) hem çoklu seçimdeki (bulk bar) düğme burayı
// çağırır — iki yerde aynı akışı ayrı ayrı kurmak, birinin diğerinden sapmasıyla
// sonuçlanıyordu. Yazma yolu ikisinde de aynı sunucu kapısı (allowedNodeIds).
import { openAiAssistModal } from './ai-assist.js';
import { loadPersisted } from './data.js';
import { renderContent } from './shell.js';
import { uiToast, uiConfirm, uiChoose } from './dialog.js';

/**
 * Secilen Claude hesabi tarayicida hatirlanir — panelin ana ekraniyla AYNI
 * anahtar (`qa-panel-ai-account`), iki yuzeyde ayri secim olmasin.
 */
const ACCOUNT_KEY = 'qa-panel-ai-account';
function rememberedAccount(list) {
  if (!list?.length) return null;
  let saved = null;
  try { saved = localStorage.getItem(ACCOUNT_KEY); } catch { saved = null; }
  return list.some((a) => a.id === saved) ? saved : list[0].id;
}
function rememberAccount(id) {
  try { if (id) localStorage.setItem(ACCOUNT_KEY, id); } catch { /* ozel pencere */ }
}

function headers() {
  return { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' };
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
  return { status: res.status, data };
}

/** Sağlayıcı durumu 30 sn önbellekli — her tıkta istek atmaya gerek yok. */
let aiCache = { at: 0, value: null };
export async function aiStatus() {
  if (Date.now() - aiCache.at < 30_000 && aiCache.value) return aiCache.value;
  try {
    const d = await (await fetch('/api/ai/status')).json();
    aiCache = { at: Date.now(), value: d };
    return d;
  } catch {
    return { mode: 'manual', oneClick: false };
  }
}

/** Yazma sonucunu tek satıra indirger (iki yol da bunu gösterir). */
function ozet(out) {
  const atlanan = (out.sonuc ?? []).reduce((a, x) => a + (x.skipped || 0), 0);
  const hatali = (out.sonuc ?? []).filter((x) => x.error);
  return [
    `${out.written} case yazıldı${atlanan ? `, ${atlanan} tekrar atlandı` : ''}.`,
    hatali.length ? `Yazılamayan düğüm: ${hatali.map((x) => `${x.nodeId} (${x.error})`).join(', ')}` : '',
    out.ms != null ? `${(out.ms / 1000).toFixed(1)} sn${out.cost != null ? ` · $${Number(out.cost).toFixed(3)}` : ''}${out.model ? ` · ${out.model}` : ''}${out.account?.label ? ` · ${out.account.label}` : ''}` : '',
    out.retrieval?.chunks ? `Bağlam: ${out.retrieval.chunks} repo parçası kullanıldı.` : '',
    'Case\'ler TASLAK — koşum kaydı yok, koşulmadan "geçti" seçilemez.',
  ].filter(Boolean).join('\n');
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

  const ai = await aiStatus();
  if (ai.oneClick) {
    /*
     * Hangi Claude hesabiyla kosulacak: birden fazla hesap varsa onay kutusu
     * ayni anda hesap secicisidir. Panel hesaplar arasinda OTOMATIK GECMEZ.
     */
    const hesaplar = ai.accounts ?? [];
    let account = rememberedAccount(hesaplar);
    let onay = false;
    if (ai.mode === 'cli' && hesaplar.length > 1) {
      const secili = await uiChoose(
        `${ids.length} düğüm için en fazla ${limit}'er case üretilecek ve doğrudan ağaca yazılacak.\n\nHangi Claude hesabıyla koşulsun? (~15-40 sn)`,
        hesaplar.map((a) => ({ value: a.id, label: `${a.label}${a.expired ? ' · süresi dolmuş' : ''}` })),
        { title: 'Tek tıkla test case üret', ok: 'Üret', cancel: 'İstemi kendim vereyim', value: account },
      );
      if (secili) { account = secili; onay = true; rememberAccount(secili); }
    } else {
      const yol = ai.mode === 'api'
        ? `${ai.model} (API anahtarı, ücretli)`
        : hesaplar.length === 1 ? `"${hesaplar[0].label}" Claude hesabı` : 'yerel Claude Code CLI';
      onay = await uiConfirm(
        `${ids.length} düğüm için en fazla ${limit}'er case üretilecek ve doğrudan ağaca yazılacak.\nYol: ${yol}, ~15-40 sn.`,
        { title: 'Tek tıkla test case üret', ok: 'Üret', cancel: 'İstemi kendim vereyim', danger: false },
      );
    }
    if (onay) {
      const bildirim = uiToast('Model çalışıyor… bu pencereyi kapatabilirsin, sonuç toast olarak gelir.', { title: 'Üretiliyor', ms: 0 });
      const { status, data } = await postJson('/api/scope/testcases/generate', { nodeIds: ids, types, limit, account });
      bildirim.remove();
      if (data.ok) {
        await loadPersisted();
        renderContent();
        if (afterApply) afterApply();
        uiToast(ozet(data), { type: 'ok', title: 'Case\'ler yazıldı', ms: 12_000 });
        return;
      }
      // 501: saglayici yok → elle yola dus (asagida). Diger hatalar: soyle ve dur.
      if (status !== 501) {
        uiToast(`${data.error || 'Üretilemedi.'}${data.hint ? `\n${data.hint}` : ''}`, { type: 'err', title: 'Üretilemedi' });
        return;
      }
      uiToast(data.hint || 'Tek tık yolu kapalı; istem üret + yapıştır yoluna geçildi.', { type: 'info' });
    }
  }

  // ---- elle yol: istem üret → kullanıcı Claude Code'a verir → JSON yapıştırılır
  const { data } = await postJson('/api/scope/testcases/prompt', { nodeIds: ids, types, limit });
  if (!data.ok) { uiToast(data.error || 'Prompt üretilemedi.', { type: 'err', title: 'İstem üretilemedi' }); return; }

  openAiAssistModal({
    title: ids.length > 1
      ? `Claude Code için prompt hazır — ${data.nodes.length} düğüm`
      : 'Claude Code için prompt hazır',
    description: '1. Bu mesajı kopyala ve Claude Code sohbetine yapıştır. Yanıt sadece JSON olacak.'
      + (data.retrieval?.chunks ? ` (İstemde ${data.retrieval.chunks} repo parçası var.)` : ''),
    prompt: data.prompt,
    applyLabel: 'Case\'leri ağaca yaz',
    onApply: async (govde) => {
      // `allowedNodeIds`: sunucudaki kapı (testcase-gen.mjs → gate()) modelin
      // burada hiç istenmeyen ama ağaçta gerçekten var olan başka bir düğümü
      // "icat edip" oraya case yazmasını engeller. Yapıştırılan JSON bunu
      // taşımaz — biz orijinal istekten (ids) ekliyoruz.
      const { data: out } = await postJson('/api/scope/testcases/apply', { ...govde, allowedNodeIds: ids });
      // Sessiz başarısızlık yok: sebep neyse modalde yazılı kalır.
      if (!out.ok) throw new Error(out.error || 'Yazılamadı.');
      await loadPersisted();
      renderContent();
      if (afterApply) afterApply();
      return ozet(out);
    },
  });
}
