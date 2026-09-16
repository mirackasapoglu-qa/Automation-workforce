/*
 * TOPLU TEST CASE ÜRETİMİ — seçim çubuğundaki "Test Case Üret" düğmesinin modalı.
 *
 * NEDEN (2026-09-15): toplu seçimde düğme seçenek sormadan sabit
 * happy+negative · 4 case ile gidiyordu; drawer'daki üretimde ise tür
 * presetleri, tek tek türler, tür paketleri seçilebiliyordu. Kullanıcı isteği:
 * "toplu seçince Case üret'e basınca bir modal açılsın, aynı üretme
 * seçenekleri çıksın." Seçenek arayüzü drawer'la ORTAK (testcase-options.js);
 * üretimin kendisi yine tek giriş noktasından (testcase-request.js →
 * openTestCaseRequest — tek tık / elle yol, hesap seçimi, kapı hepsi orada).
 *
 * Seçim modal-scope'ta ama modal kapanınca UNUTULMAZ (module-scope): peş peşe
 * iki toplu üretimde aynı kombinasyonu yeniden seçmek gereksiz iş.
 */
import { state } from './state.js';
import { ICON } from './constants.js';
import { findNode } from './data.js';
import { openTestCaseRequest, applyGenerateLabel } from './testcase-request.js';
import { buildTypeSelector, TEST_TYPE_META, DEFAULT_TYPES } from './testcase-options.js';
import { clearSelection } from './bulk-actions.js';

let secili = new Set(DEFAULT_TYPES);
let acik = false;
let limit = 4;
const LIMITLER = [2, 3, 4, 5, 6, 8];

function kapat() {
  document.querySelector('.bulk-gen-overlay')?.remove();
  document.removeEventListener('keydown', escKapat);
}
function escKapat(e) { if (e.key === 'Escape') kapat(); }

/**
 * @param {{nodeIds: string[]}} p  seçili düğümler (küme her zaman YAPRAK: konteyner işaretlenirse alt yaprakları gelir)
 */
export function openBulkGenerateModal({ nodeIds }) {
  const ids = (nodeIds ?? []).filter(Boolean);
  if (!ids.length) return;
  kapat();

  const overlay = document.createElement('div');
  overlay.className = 'ai-assist-overlay bulk-gen-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) kapat(); };
  const modal = document.createElement('div');
  modal.className = 'ai-assist-modal bulk-gen-modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'ai-assist-header';
  const title = document.createElement('div');
  title.className = 'ai-assist-title';
  title.innerHTML = ICON.sparkle + `<span>Toplu test case üret — ${ids.length} düğüm</span>`;
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drawer-close';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = kapat;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ai-assist-body';
  modal.appendChild(body);

  const ciz = () => {
    body.innerHTML = '';

    // Hangi düğümler: ad listesi (çok uzunsa kırpılır) — kullanıcı neye
    // üreteceğini görsün, "131 düğüm seçtim mi" sürprizi olmasın.
    const nodesLabel = document.createElement('div');
    nodesLabel.className = 'qa-scope-label';
    nodesLabel.textContent = 'Seçili düğümler';
    body.appendChild(nodesLabel);
    const nodes = document.createElement('div');
    nodes.className = 'bulk-gen-nodes';
    const adlar = ids.map(id => findNode(state.tree, id)).filter(Boolean);
    adlar.slice(0, 24).forEach(n => {
      const chip = document.createElement('span');
      chip.className = 'bulk-gen-node';
      chip.textContent = n.name || n.id;
      chip.title = `${n.type ?? 'page'} · ${(n.testCases ?? []).length} mevcut case`;
      nodes.appendChild(chip);
    });
    if (adlar.length > 24) {
      const more = document.createElement('span');
      more.className = 'bulk-gen-node bulk-gen-more';
      more.textContent = `+${adlar.length - 24} düğüm daha`;
      nodes.appendChild(more);
    }
    body.appendChild(nodes);

    // Tür seçici — drawer'la birebir aynı bileşen.
    body.appendChild(buildTypeSelector({
      selected: secili,
      expanded: acik,
      onChange: ({ selected, expanded }) => { secili = selected; acik = expanded; ciz(); },
      onPackagesLoaded: () => { if (!state.packagesLoaded) { state.packagesLoaded = true; ciz(); } },
    }));

    // Düğüm başına üst sınır — toplu üretimde toplam sayı hızla büyüyor
    // (20 düğüm × 8 = 160 case); kullanıcı görsün ve seçsin.
    const limitRow = document.createElement('div');
    limitRow.className = 'bulk-gen-limit';
    const limitLabel = document.createElement('span');
    limitLabel.className = 'qa-tpkg-label';
    limitLabel.textContent = 'Düğüm başına en fazla';
    limitRow.appendChild(limitLabel);
    const sel = document.createElement('select');
    sel.className = 'bulk-gen-select';
    LIMITLER.forEach(n => {
      const o = document.createElement('option');
      o.value = String(n); o.textContent = `${n} case`;
      if (n === limit) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { limit = Number(sel.value) || 4; ciz(); };
    limitRow.appendChild(sel);
    const toplam = document.createElement('span');
    toplam.className = 'bulk-gen-total';
    toplam.textContent = `≈ en fazla ${ids.length * limit} case · ${secili.size ? [...secili].map(t => TEST_TYPE_META[t]?.label ?? t).join(', ') : 'tür seçilmedi'}`;
    limitRow.appendChild(toplam);
    body.appendChild(limitRow);

    const actions = document.createElement('div');
    actions.className = 'jira-prompt-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Vazgeç';
    cancel.onclick = kapat;
    actions.appendChild(cancel);
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'btn btn-primary bulk-gen-go';
    genBtn.disabled = secili.size === 0;
    genBtn.title = secili.size === 0
      ? 'Önce en az bir test türü seç'
      : 'Prompt üretilir; dönen JSON aynı pencereden seçili düğümlere yazılır';
    genBtn.innerHTML = ICON.sparkle + '<span>Test Case İste (Claude Code)</span>';
    // Sunucuda tek tık açıksa yazı "Test Case Üret"e döner (aynı yardımcı).
    applyGenerateLabel(genBtn, ICON.sparkle);
    genBtn.onclick = () => {
      kapat();
      openTestCaseRequest({
        nodeIds: ids,
        types: [...secili],
        limit,
        // Yazma bitince seçim temizlenir: aynı düğümlere ikinci kez basıp
        // aynı case'leri tekrar üretmek (tekrar atlanır ama ücret ödenir) kolay hata.
        afterApply: () => clearSelection(),
      });
    };
    actions.appendChild(genBtn);
    body.appendChild(actions);
  };
  ciz();

  document.body.appendChild(overlay);
  document.addEventListener('keydown', escKapat);
}
