// Ağaç/diyagram/pano satır ve kartlarında ortak kullanılan yapı taşları:
// tip chip'i, durum chip'i, isim input'u, ekle/sil butonları.
import { ICON, TYPE_ORDER, TYPE_META, STATUS_ORDER, STATUS_META, statusClass } from './constants.js';
import { persist, persistDebounced, addChild, removeNode, effectiveStatus, setNodeStatus, readyInfo, isReadyLeaf } from './data.js';
import { newJiraId } from './state.js';
import { renderContent } from './shell.js';
import { openMenu } from './dropdown.js';
import { openJiraPrompt } from './jira.js';
import { openDrawer } from './drawer.js';
import { uiConfirm } from './dialog.js';

export function buildTypeChip(node) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip chip-type';
  btn.innerHTML = TYPE_META[node.type].icon + `<span>${TYPE_META[node.type].label}</span>` + ICON.chevronDown;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu(btn, TYPE_ORDER.map(t => ({ value: t, label: TYPE_META[t].label, icon: TYPE_META[t].icon })), node.type, (val) => {
      node.type = val; persist(); renderContent();
    });
  };
  return btn;
}

// Bir düğümün Jira Task ID'si var mı — drawer'ı açmadan ağaç/pano/diyagramda görünsün diye
// küçük bir rozet. Sadece VARLIĞI ve sayıyı gösterir; canlı "done" durumu bunun kapsamı
// dışında (o bilgi yalnızca bir tarama/poll sonrası state.jiraStatusCache'te olabilir, her
// zaman bilinmez) — karıştırılmasın diye rozet nötr renkte, "Hatalı" rengini TAŞIMAZ.
export function buildJiraIndicator(node) {
  if (!node.jiraTasks.length) return null;
  const badge = document.createElement('span');
  badge.className = 'chip-jira-indicator';
  badge.innerHTML = ICON.jira + `<span>${node.jiraTasks.length}</span>`;
  badge.title = node.jiraTasks.map(t => t.taskId).join(', ');
  return badge;
}

/**
 * "Test case hazır" — Bekliyor'un türetilmiş yüzü (bkz. data.js → readyInfo).
 * Durum değeri ⬜ kalır; yalnız yazı ve renk değişir: yaprakta "Test case hazır · N",
 * konteynerde "Test case hazır · k/n" (k: case'i olan yaprak, n: yaprak). Menü aynı
 * durum menüsüdür — kullanıcı yine Devam Ediyor/Tamamlandı seçebilir.
 */
function readyLabel(node) {
  if (!node.children.length) {
    if (!isReadyLeaf(node)) return null;
    const n = node.testCases.length;
    return { text: `Test case hazır · ${n}`, title: `${n} test case yazılmış, henüz koşulmadı. Koşum sonucu girilince durum kendi değişir.` };
  }
  if (effectiveStatus(node) !== '⬜') return null;
  const r = readyInfo(node);
  if (!r.leavesWithCases) return null;
  return {
    text: `Test case hazır · ${r.leavesWithCases}/${r.leaves}`,
    title: `Alt ağaçta ${r.leaves} yapraktan ${r.leavesWithCases}'inde toplam ${r.cases} test case var; hiçbiri henüz koşulmadı.`,
  };
}

export function buildStatusChip(node) {
  const status = effectiveStatus(node);
  const meta = STATUS_META[status];
  const btn = document.createElement('button');
  btn.type = 'button';
  const hazir = readyLabel(node);

  if (node.children.length) {
    btn.className = 'chip chip-status status-' + statusClass(status) + ' chip-status-auto' + (hazir ? ' chip-status-ready' : '');
    btn.innerHTML = (hazir ? ICON.check || meta.icon : meta.icon) + `<span>${hazir ? hazir.text : meta.label}</span>`;
    btn.title = (hazir ? hazir.title + ' ' : '') + 'Otomatik: alt öğelerin en kötü durumuna göre hesaplanır';
    btn.disabled = true;
    return btn;
  }

  btn.className = 'chip chip-status status-' + statusClass(status) + (hazir ? ' chip-status-ready' : '');
  btn.innerHTML = (hazir ? ICON.check || meta.icon : meta.icon) + `<span>${hazir ? hazir.text : meta.label}</span>` + ICON.chevronDown;
  if (hazir) btn.title = hazir.title;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu(btn, STATUS_ORDER.map(s => ({ value: s, label: STATUS_META[s].label, icon: STATUS_META[s].icon })), node.status, (val) => {
      if (val === '❌' && !node.jiraTasks.length) {
        openJiraPrompt(btn, node, (jiraId) => {
          setNodeStatus(node, val);
          node.jiraTasks.push({ id: newJiraId(), taskId: jiraId, createdAt: new Date().toISOString(), analyses: [] });
          persist();
          renderContent();
        });
        return;
      }
      setNodeStatus(node, val);
      persist();
      renderContent();
    });
  };
  return btn;
}

// İsim input'u satırın/kartın büyük kısmını kaplıyor; `attachDrawerOpener` satır
// click'inde `input, button` hedeflerini HARİÇ tutuyor (bkz. drawer.js), yani isme
// tıklamak drawer'ı hiç açmıyor, sessizce düzenleme moduna düşürüyordu (ölçüldü —
// kullanıcı karta tıklayıp drawer açmak isterken ismi güncellemiş oluyordu). Çözüm:
// TEK tık drawer açar (satırın geri kalanıyla aynı davranış), ÇİFT tık düzenleme
// moduna girer (input'u odaklayıp seçili hale getirir) — dosya gezgini kuralı.
export function buildNameInput(node, placeholder, className) {
  const input = document.createElement('input');
  input.className = className;
  input.value = node.name;
  input.placeholder = placeholder;
  input.title = 'Açmak için tıklayın, yeniden adlandırmak için çift tıklayın';
  input.oninput = (e) => { node.name = e.target.value; persistDebounced(); };

  input.addEventListener('mousedown', (e) => {
    // Duzenleme MODUNDA degilken tek tikin input'u odaklayip imlec koymasini engelle —
    // odaklanma yalnizca asagidaki dblclick'ten (ya da zaten odakliyken devam eden bir
    // tiklamadan) gelsin. preventDefault() input'un tek tikta focus almasini engelliyor
    // ama click event'inin kendisini engellemiyor (asagidaki handler yine calisir).
    if (document.activeElement !== input) e.preventDefault();
  });
  let clickTimer = null;
  input.addEventListener('click', (e) => {
    if (document.activeElement === input) return; // duzenlerken normal imlec tiklamasi
    e.stopPropagation();
    if (clickTimer) return;
    clickTimer = setTimeout(() => { clickTimer = null; openDrawer(node); }, 220);
  });
  input.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    input.focus();
    input.select();
  });
  return input;
}

export function buildActionButtons(node) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'icon-btn';
  addBtn.title = 'Alt öğe ekle';
  addBtn.innerHTML = ICON.plus;
  addBtn.onclick = () => addChild(node.id);
  wrap.appendChild(addBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn icon-btn-danger';
  delBtn.title = 'Sil';
  delBtn.innerHTML = ICON.trash;
  delBtn.onclick = async () => {
    const savedX = window.scrollX, savedY = window.scrollY;
    const restore = () => window.scrollTo(savedX, savedY);
    const altSayisi = (node.children ?? []).length;
    // uiConfirm ASENKRON — await'siz hali her zaman truthy doner ve silme onaysiz calisir.
    const onay = await uiConfirm(
      `"${node.name}" silinecek${altSayisi ? ` (altındaki ${altSayisi} öğeyle birlikte)` : ''}. Bu işlem geri alınamaz.`,
      { title: 'Düğümü sil', ok: 'Sil' },
    );
    if (onay) removeNode(node.id);
    restore();
    requestAnimationFrame(restore);
    requestAnimationFrame(() => requestAnimationFrame(restore));
  };
  wrap.appendChild(delBtn);

  return wrap;
}
