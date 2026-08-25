// "Test Case'ler" sekmesi: her düğümün kendi QA test case kayıtları burada, doğrudan ilgili
// sayfa/komponentin drawer'ında yaşar (docs/test-cases.md'deki gibi ayrı bir dosyada değil).
// Her test case'in `steps` alanı (adım başına {action, expected}) tanımı taşır, `runs` alanı
// ise koşum geçmişini (qa-test-runner'ın yazdığı ✅/❌/⚠️ sonuçları) tutar — ikisi kasıtlı
// olarak ayrı: bir koşum, test case'in TANIMINI asla değiştirmez (bkz. migrateTestCaseSteps).
// Başlık ve adımlar her girişte otomatik kaydedilir (debounce'lu) — ayrı bir "Kaydet" adımı yok.
import { newTestCaseId, newTestStepId } from './state.js';
import { ICON, STATUS_META, statusClass } from './constants.js';
import { persist, persistDebounced, effectiveTestCaseStatus, isTestCaseRunStale, DEFAULT_STALE_DAYS } from './data.js';
import { renderDrawer } from './drawer.js';
import { openMenu } from './dropdown.js';
import { formatNoteDate } from './notes.js';

// Hangi test case'lerin kartı / "Koşum Geçmişi" bölümü açık — drawer sık sık tamamen
// yeniden kurulduğu için (ör. Jira polling'i her ~60sn'de renderDrawer() çağırır) bu,
// DOM'da değil modül kapsamında tutulmalı, yoksa açık panel kendiliğinden kapanır.
// Varsayılan kapalı: sekmeye girildiğinde sadece başlık/durum listesi görünsün, adımlar
// ve koşum geçmişi tıklanınca açılsın.
const expandedCases = new Set();
const expandedRuns = new Set();

// Hiç koşum yokken elle sadece bu ikisi seçilebilir ("henüz koşulmadı" / "koşuluyor") —
// ✅/❌/⚠️ bir koşumun sonucudur, tahminle verilemez (bkz. data.js::effectiveTestCaseStatus).
const PRE_RUN_STATUSES = ['⬜', '🔵'];

function buildTestCaseStatusChip(tc, onChange) {
  const hasRuns = tc.runs.length > 0;
  const status = effectiveTestCaseStatus(tc);
  const meta = STATUS_META[status] || STATUS_META['⬜'];
  const btn = document.createElement('button');
  btn.type = 'button';

  if (hasRuns) {
    btn.className = 'chip chip-status status-' + statusClass(status) + ' chip-status-auto';
    btn.innerHTML = meta.icon + `<span>${meta.label}</span>`;
    btn.title = 'Bu durum en son koşumdan otomatik hesaplanır — yeni bir koşum dışında değişmez';
    btn.disabled = true;
    return btn;
  }

  btn.className = 'chip chip-status status-' + statusClass(status);
  btn.innerHTML = meta.icon + `<span>${meta.label}</span>` + ICON.chevronDown;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu(
      btn,
      PRE_RUN_STATUSES.map(s => ({ value: s, label: STATUS_META[s].label, icon: STATUS_META[s].icon })),
      status,
      (val) => { tc.status = val; onChange(); }
    );
  };
  return btn;
}

// Yazı miktarına göre kendiliğinden büyüyen, iç kaydırma çubuğu OLMAYAN bir kutu — sabit
// küçük bir yüksekliğe sıkışıp içeriği kaydırmaya zorlamak yerine tüm metin her zaman
// görünür kalsın diye. rAF'la geciktirme şart: kutu, DOM'a (drawer panel'e) eklenmeden
// scrollHeight her zaman 0 döner.
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function buildStepField(kind, labelText, iconSvg, value, placeholder, onInput) {
  const wrap = document.createElement('div');
  wrap.className = 'testcase-step-field testcase-step-field-' + kind;
  const label = document.createElement('label');
  label.className = 'testcase-step-field-label';
  label.innerHTML = iconSvg + `<span>${labelText}</span>`;
  wrap.appendChild(label);
  const textarea = document.createElement('textarea');
  textarea.className = 'testcase-step-textarea testcase-step-textarea-' + kind;
  textarea.placeholder = placeholder;
  textarea.rows = 1;
  textarea.value = value;
  textarea.oninput = () => { onInput(textarea.value); autoGrow(textarea); };
  wrap.appendChild(textarea);
  requestAnimationFrame(() => autoGrow(textarea));
  return wrap;
}

function buildStepsSection(tc, touch) {
  const section = document.createElement('div');
  section.className = 'testcase-steps-section';

  const label = document.createElement('div');
  label.className = 'note-field-label testcase-steps-label';
  label.textContent = 'ADIMLAR';
  section.appendChild(label);

  const list = document.createElement('div');
  list.className = 'testcase-steps';
  if (!tc.steps.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder testcase-steps-empty';
    empty.textContent = 'Henüz adım eklenmedi.';
    list.appendChild(empty);
  } else {
    tc.steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'testcase-step';

      const stepHeader = document.createElement('div');
      stepHeader.className = 'testcase-step-header';
      const num = document.createElement('span');
      num.className = 'testcase-step-num-badge';
      num.textContent = String(i + 1);
      stepHeader.appendChild(num);
      const headerLabel = document.createElement('span');
      headerLabel.className = 'testcase-step-header-label';
      headerLabel.textContent = 'Adım';
      stepHeader.appendChild(headerLabel);
      const delStepBtn = document.createElement('button');
      delStepBtn.type = 'button';
      delStepBtn.className = 'icon-btn icon-btn-danger';
      delStepBtn.title = 'Adımı sil';
      delStepBtn.innerHTML = ICON.trash;
      delStepBtn.onclick = () => {
        tc.steps = tc.steps.filter(s => s.id !== step.id);
        touch();
        persist();
        renderDrawer();
      };
      stepHeader.appendChild(delStepBtn);
      stepEl.appendChild(stepHeader);

      stepEl.appendChild(buildStepField('action', 'Ne yapılıyor', ICON.typeStep, step.action, 'Ne yapılıyor?', (val) => {
        step.action = val; touch(); persistDebounced();
      }));
      stepEl.appendChild(buildStepField('expected', 'Beklenen sonuç', ICON.check, step.expected, 'Ne olması bekleniyor?', (val) => {
        step.expected = val; touch(); persistDebounced();
      }));

      list.appendChild(stepEl);
    });
  }
  section.appendChild(list);

  const addStepBtn = document.createElement('button');
  addStepBtn.type = 'button';
  addStepBtn.className = 'btn testcase-add-step-btn';
  addStepBtn.innerHTML = ICON.plus + '<span>Adım ekle</span>';
  addStepBtn.onclick = () => {
    tc.steps.push({ id: newTestStepId(), action: '', expected: '' });
    touch();
    persist();
    renderDrawer();
  };
  section.appendChild(addStepBtn);

  return section;
}

// Koşum geçmişi salt okunur — status-history.js ile aynı felsefe: kayıtların kendisi
// qa-test-runner tarafından yazılır, burada sadece render edilir, silinemez/düzenlenemez.
function buildRunsSection(tc) {
  const runs = tc.runs || [];
  if (!runs.length) return null;

  const section = document.createElement('div');
  section.className = 'testcase-runs-section';

  const isOpen = expandedRuns.has(tc.id);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'testcase-runs-toggle' + (isOpen ? ' open' : '');
  toggle.innerHTML = ICON.chevronDown + `<span>Koşum Geçmişi (${runs.length})</span>`;
  toggle.onclick = () => {
    if (isOpen) expandedRuns.delete(tc.id); else expandedRuns.add(tc.id);
    renderDrawer();
  };
  section.appendChild(toggle);

  if (isOpen) {
    const list = document.createElement('div');
    list.className = 'testcase-runs-list';
    [...runs].reverse().forEach(r => {
      const meta = STATUS_META[r.status] || STATUS_META['⬜'];
      const item = document.createElement('div');
      item.className = 'testcase-run-item';

      const header = document.createElement('div');
      header.className = 'testcase-run-header';
      const badge = document.createElement('span');
      badge.className = 'chip chip-status chip-status-auto status-' + statusClass(r.status);
      badge.innerHTML = meta.icon + `<span>${meta.label}</span>`;
      header.appendChild(badge);
      const time = document.createElement('span');
      time.className = 'testcase-run-time';
      time.textContent = formatNoteDate(r.at);
      header.appendChild(time);
      item.appendChild(header);

      if (r.note) {
        const note = document.createElement('div');
        note.className = 'testcase-run-note';
        note.textContent = r.note;
        item.appendChild(note);
      }

      list.appendChild(item);
    });
    section.appendChild(list);
  }

  return section;
}

export function renderDrawerTestCasesTab(node) {
  const wrap = document.createElement('div');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary drawer-note-add-btn';
  addBtn.innerHTML = ICON.plus + '<span>Yeni test case</span>';
  addBtn.onclick = () => {
    const now = new Date().toISOString();
    const tc = { id: newTestCaseId(), title: '', steps: [], runs: [], status: '⬜', createdAt: now, updatedAt: now };
    node.testCases.push(tc);
    expandedCases.add(tc.id); // yeni eklenen boş kart kapalı gelirse kullanıcı adım ekleyemediğini sanır
    persist();
    renderDrawer();
  };
  wrap.appendChild(addBtn);

  const list = document.createElement('div');
  list.className = 'drawer-note-list';
  if (!node.testCases.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = 'Henüz test case eklenmedi. "QA Analizi" bölümünden Claude Code\'a ürettirebilir ya da elle ekleyebilirsin.';
    list.appendChild(empty);
  } else {
    [...node.testCases].reverse().forEach(tc => {
      const item = document.createElement('div');
      item.className = 'drawer-note-item';

      const touch = () => { tc.updatedAt = new Date().toISOString(); };
      const isCaseOpen = expandedCases.has(tc.id);
      item.classList.toggle('testcase-item-open', isCaseOpen);

      const toggleCase = (e) => {
        if (e.target.closest('button, input')) return;
        if (isCaseOpen) expandedCases.delete(tc.id); else expandedCases.add(tc.id);
        renderDrawer();
      };

      const itemHeader = document.createElement('div');
      itemHeader.className = 'drawer-note-header testcase-card-header';
      itemHeader.onclick = toggleCase;
      const chevron = document.createElement('span');
      chevron.className = 'testcase-card-chevron' + (isCaseOpen ? ' open' : '');
      chevron.innerHTML = ICON.chevronDown;
      itemHeader.appendChild(chevron);
      const titleInput = document.createElement('input');
      titleInput.className = 'testcase-title-input';
      titleInput.value = tc.title;
      titleInput.placeholder = 'Test case başlığı';
      titleInput.oninput = () => { tc.title = titleInput.value; touch(); persistDebounced(); };
      itemHeader.appendChild(titleInput);
      itemHeader.appendChild(buildTestCaseStatusChip(tc, () => { touch(); persist(); renderDrawer(); }));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn icon-btn-danger';
      delBtn.title = 'Test case\'i sil';
      delBtn.innerHTML = ICON.trash;
      delBtn.onclick = () => {
        node.testCases = node.testCases.filter(x => x.id !== tc.id);
        persist();
        renderDrawer();
      };
      itemHeader.appendChild(delBtn);
      item.appendChild(itemHeader);

      const summary = document.createElement('div');
      summary.className = 'drawer-note-meta testcase-meta testcase-card-summary';
      summary.onclick = toggleCase;
      const summaryText = document.createElement('span');
      summaryText.textContent = `${tc.steps.length} adım` + (tc.runs.length ? ` · ${tc.runs.length} koşum` : '')
        + ` · Güncellendi: ${formatNoteDate(tc.updatedAt)}`;
      summary.appendChild(summaryText);
      if (isTestCaseRunStale(tc)) {
        const staleBadge = document.createElement('span');
        staleBadge.className = 'testcase-stale-badge';
        staleBadge.title = `Son koşum ${DEFAULT_STALE_DAYS} günden eski — tekrar koşturmayı düşün`;
        staleBadge.textContent = ' · ⚠ bayat, tekrar koştur';
        summary.appendChild(staleBadge);
      }
      item.appendChild(summary);

      if (isCaseOpen) {
        item.appendChild(buildStepsSection(tc, touch));
        const runsSection = buildRunsSection(tc);
        if (runsSection) item.appendChild(runsSection);
      }

      list.appendChild(item);
    });
  }
  wrap.appendChild(list);

  return wrap;
}
