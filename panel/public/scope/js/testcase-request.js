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
import { uiToast, uiConfirm, uiChoose, uiProgress } from './dialog.js';
import { genStarted, genEnded, genProduced } from './gen-status.js';

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

/**
 * Üretim düğmesinin metnini GERÇEK yola göre yazar.
 *
 * Düğme "Test Case İste (Claude Code)" diyordu: kopyala-yapıştır turunu
 * anlatan bir metin. Sunucuda Claude hesabı bağlıyken (2026-09-10'dan beri)
 * aynı düğme modeli kendisi çağırıp case'leri doğrudan ağaca yazıyor — yani
 * yazı, yapılan işi yanlış anlatıyordu: kullanıcı elle bir şey yapıştırması
 * gerektiğini sanıyordu.
 *
 * Durum sunucudan geliyor (`/api/ai/status`, 30 sn önbellekli) ve düğme
 * çizildikten SONRA güncelleniyor — çizimi ağ isteğine bekletmek, drawer'ın
 * açılışını yavaşlatırdı. İstek başarısızsa yazı olduğu gibi kalır (elle yol).
 *
 * @param {HTMLButtonElement} btn   metni güncellenecek düğme
 * @param {string} icon             düğmenin ikonu (aynı kalır)
 */
export async function applyGenerateLabel(btn, icon = '') {
  const ai = await aiStatus();
  if (!ai?.oneClick) return;   // elle yol: mevcut metin zaten doğru
  const hesap = ai.accounts?.length === 1 ? ai.accounts[0].label : null;
  const yol = ai.mode === 'api'
    ? `${ai.model || 'API anahtarı'} ile sunucuda`
    : hesap ? `"${hesap}" Claude hesabıyla sunucuda` : 'sunucudaki Claude oturumuyla';
  const span = btn.querySelector('span');
  if (span) span.textContent = 'Test Case Üret';
  else btn.textContent = 'Test Case Üret';
  if (icon && !btn.querySelector('svg')) btn.innerHTML = icon + btn.innerHTML;
  // Devre dışı düğmenin kendi gerekçesi var ("önce test türü seç") — ezme.
  if (!btn.disabled) btn.title = `${yol} üretilir ve doğrudan ağaca yazılır (~15-40 sn). Kopyala-yapıştır gerekmez.`;
}

/**
 * PARTİLEME (2026-09-16). "Tümünü seç" ile 426 düğüm tek isteme girdi → CLI 240
 * sn'de zaman aşımı, sıfır case, ücret boşa. Tek çağrının istemi de yanıtı da
 * düğüm sayısıyla büyür; süreyi artırmak yetmez (AI_MAX_TOKENS'a çarpar).
 * Artık tek tık yolu düğümleri BATCH_SIZE'lık partilere böler, sırayla gönderir
 * (sunucu zaten en fazla 2 eşzamanlı çağrı kabul ediyor), her parti kendi
 * düğümlerine yazılır ve ilerleme toast'ta güncellenir. Bir parti düşerse
 * diğerleri sürer — 400 düğümlük işte tek zaman aşımı yüzünden hepsini
 * kaybetmek kabul edilemez. Sunucu tarafı sigortası: MAX_NODES_PER_GENERATE (24).
 */
export const BATCH_SIZE = 6;
/** Sağlayıcı düzelmeden tekrar denemenin anlamı olmayan kodlar — kalan partiler atlanır. */
const DURDURAN_KODLAR = new Set(['BUDGET', 'NO_ACCOUNT', 'AUTH', 'NO_PROVIDER', 'NO_CLI', 'NO_KEY']);

export function partile(arr, n = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Parti sonuçlarını tek `ozet()` girdisine toplar (yazılan, atlanan, ücret, süre). */
export function topla(acc, data) {
  acc.written += Number(data.written) || 0;
  acc.sonuc.push(...(data.sonuc ?? []));
  if (data.cost != null) acc.cost = (acc.cost ?? 0) + Number(data.cost);
  if (data.ms != null) acc.ms = (acc.ms ?? 0) + Number(data.ms);
  if (data.model) acc.model = data.model;
  if (data.account) acc.account = data.account;
  if (data.retrieval?.chunks) acc.retrieval = { chunks: (acc.retrieval?.chunks ?? 0) + data.retrieval.chunks };
  return acc;
}

/** Onay kutusuna süre/parti notu: tek parti ~15-40 sn, çoklu partide toplam tahmini. */
function partiNotu(n) {
  const p = Math.ceil(n / BATCH_SIZE);
  if (p <= 1) return ' ~15-40 sn.';
  return ` ${p} parti halinde (${BATCH_SIZE}'şar düğüm), parti başına ~15-40 sn; ilerleme sağ alttaki bildirimde. Bir parti düşerse diğerleri sürer.`;
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
        `${ids.length} düğüm için en fazla ${limit}'er case üretilecek ve doğrudan ağaca yazılacak.${partiNotu(ids.length)}\n\nHangi Claude hesabıyla koşulsun?`,
        hesaplar.map((a) => ({ value: a.id, label: `${a.label}${a.expired ? ' · süresi dolmuş' : ''}` })),
        { title: 'Tek tıkla test case üret', ok: 'Üret', cancel: 'İstemi kendim vereyim', value: account },
      );
      if (secili) { account = secili; onay = true; rememberAccount(secili); }
    } else {
      const yol = ai.mode === 'api'
        ? `${ai.model} (API anahtarı, ücretli)`
        : hesaplar.length === 1 ? `"${hesaplar[0].label}" Claude hesabı` : 'yerel Claude Code CLI';
      onay = await uiConfirm(
        `${ids.length} düğüm için en fazla ${limit}'er case üretilecek ve doğrudan ağaca yazılacak.\nYol: ${yol}.${partiNotu(ids.length)}`,
        { title: 'Tek tıkla test case üret', ok: 'Üret', cancel: 'İstemi kendim vereyim', danger: false },
      );
    }
    if (onay) {
      const partiler = partile(ids);
      // İlerleme çubuğu (kullanıcı isteği, 2026-09-16): parti bazlı yüzde +
      // "Parti i/N · x/y düğüm · z case · t sn". Tek partide belirsiz mod (kayar çubuk).
      const bildirim = uiProgress('Model çalışıyor… bu pencereyi kapatabilirsin, sonuç toast olarak gelir.', { title: 'Üretiliyor' });
      genStarted();   // sidebar "Test Repository" nabzı — toast kapatılsa da iz kalır
      const toplam = { written: 0, sonuc: [], cost: null, ms: null, model: null, account: null, retrieval: null };
      const dusen = [];          // {parti, ids, error, hint, code}
      let basarili = 0;
      let saglayiciYok = false;  // 501 → elle yola düş
      let durduran = null;       // BUDGET vb. → kalan partiler atlandı
      const t0 = Date.now();
      const ilerle = () => {
        const biten = basarili + dusen.length;
        const dugum = Math.min(biten * BATCH_SIZE, ids.length);
        const sn = Math.round((Date.now() - t0) / 1000);
        bildirim.set(biten, partiler.length > 1 ? partiler.length : 0,
          partiler.length > 1
            ? `Parti ${Math.min(biten + 1, partiler.length)}/${partiler.length} · ${dugum}/${ids.length} düğüm · ${toplam.written} case · ${sn} sn`
            : `${ids.length} düğüm · ${sn} sn`);
      };
      ilerle();
      const sayac = setInterval(ilerle, 1000);   // saniye sayacı — çubuk parti arasında da "yaşıyor"
      try {
        for (let i = 0; i < partiler.length; i++) {
          const parti = partiler[i];
          ilerle();
          let status, data;
          try { ({ status, data } = await postJson('/api/scope/testcases/generate', { nodeIds: parti, types, limit, account })); }
          catch (e) { status = 0; data = { ok: false, error: e.message || 'Ağ hatası' }; }
          if (data.ok) {
            basarili++;
            topla(toplam, data);
            // Her parti yazıldığı anda ağaç tazelenir: kullanıcı 60 partinin
            // bitmesini beklemeden sonucu görür; yarıda kesilse yazılan kalır.
            await loadPersisted();
            renderContent();
            genProduced(data.written);
            continue;
          }
          if (status === 501) { saglayiciYok = true; break; }
          dusen.push({ parti: i + 1, ids: parti, error: data.error || 'Üretilemedi.', hint: data.hint, code: data.code });
          if (DURDURAN_KODLAR.has(data.code)) { durduran = data; break; }
        }
      } finally { clearInterval(sayac); genEnded(); bildirim.remove(); }

      if (basarili) {
        if (afterApply) afterApply();
        const kalan = partiler.length - basarili - dusen.length;
        const ek = [
          dusen.length ? `${dusen.length} parti düştü (${dusen.reduce((a, d) => a + d.ids.length, 0)} düğüm): ${dusen[0].error}` : '',
          kalan > 0 ? `${kalan} parti hiç denenmedi (${durduran?.hint || 'sağlayıcı düzelince aynı seçimle tekrar üret'}).` : '',
        ].filter(Boolean).join('\n');
        uiToast(`${ozet(toplam)}${ek ? `\n${ek}` : ''}`, { type: dusen.length || kalan > 0 ? 'info' : 'ok', title: dusen.length || kalan > 0 ? 'Kısmen yazıldı' : 'Case\'ler yazıldı', ms: dusen.length ? 0 : 12_000 });
        return;
      }
      // Hiç parti geçmedi. 501: saglayici yok → elle yola dus (asagida). Diger hatalar: soyle ve dur.
      if (!saglayiciYok) {
        const d = dusen[0] || { error: 'Üretilemedi.' };
        uiToast(`${d.error}${d.hint ? `\n${d.hint}` : ''}${partiler.length > 1 ? `\n${partiler.length} partinin hiçbiri yazılamadı.` : ''}`, { type: 'err', title: 'Üretilemedi' });
        return;
      }
      uiToast('Tek tık yolu kapalı; istem üret + yapıştır yoluna geçildi.', { type: 'info' });
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
      genProduced(out.written);
      if (afterApply) afterApply();
      return ozet(out);
    },
  });
}
