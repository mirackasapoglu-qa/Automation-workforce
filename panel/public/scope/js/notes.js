// "Notlar" özelliği: her ekleme tarihli yeni bir kayıt açar (tek bir düzenlenebilir alan değil).
import { newNoteId } from './state.js';
import { ICON } from './constants.js';
import { persist } from './data.js';
import { renderDrawer } from './drawer.js';

export function formatNoteDate(iso) {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return ''; }
}

// Bir log kaydının anlamlı olması için yakalanması gereken 5 boyut — sadece "ne oldu" değil
// "neden öyle oldu / ne öğrenildi" bilgisini içerir (durum, tarih, Jira ID zaten ayrı ayrı
// tutuluyor, burada tekrar edilmez). Hepsi zorunludur ki log kayıtları gerçekten kullanışlı olsun.
const NOTE_FIELDS = [
  { key: 'reason', label: 'Durum Değişikliğinin Sebebi', hint: 'Örn. "Hatalı işaretlendi çünkü X senaryosunda Y hatası alındı"' },
  { key: 'resolution', label: 'Çözüm Özeti', hint: 'Örn. "Cache temizlenince düzeldi", "Backend\'de tarih formatı düzeltildi"' },
  { key: 'testDetail', label: 'Test Detayı', hint: 'Hangi senaryo/veri ile test edildiği' },
  { key: 'blocker', label: 'Blocker / Bağımlılık', hint: 'Örn. "Bu, Ödeme modülü bitmeden test edilemiyor"' },
  { key: 'decision', label: 'Kasıtlı/Beklenen Davranış Kararı', hint: 'Örn. "Bu buton bilerek pasif, ekip onayladı"' },
];

export function renderDrawerNotesTab(node) {
  const wrap = document.createElement('div');

  const addRow = document.createElement('div');
  addRow.className = 'drawer-note-add';

  const fieldInputs = {};
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary drawer-note-add-btn';
  addBtn.textContent = 'Not ekle';

  const updateSubmitState = () => {
    const allFilled = NOTE_FIELDS.every(f => fieldInputs[f.key].value.trim());
    addBtn.disabled = !allFilled;
  };

  const submitNote = () => {
    if (!NOTE_FIELDS.every(f => fieldInputs[f.key].value.trim())) return;
    const text = NOTE_FIELDS
      .map(f => `${f.label}: ${fieldInputs[f.key].value.trim()}`)
      .join('\n\n');
    node.notes.push({ id: newNoteId(), text, createdAt: new Date().toISOString() });
    persist();
    renderDrawer();
  };

  NOTE_FIELDS.forEach(f => {
    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'note-field';
    const label = document.createElement('label');
    label.className = 'note-field-label';
    label.textContent = f.label;
    fieldWrap.appendChild(label);
    const textarea = document.createElement('textarea');
    textarea.className = 'drawer-textarea note-field-input';
    textarea.placeholder = f.hint;
    textarea.rows = 2;
    textarea.addEventListener('input', updateSubmitState);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitNote();
    });
    fieldWrap.appendChild(textarea);
    fieldInputs[f.key] = textarea;
    addRow.appendChild(fieldWrap);
  });

  addBtn.disabled = true;
  addBtn.onclick = submitNote;
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

  const list = document.createElement('div');
  list.className = 'drawer-note-list';
  if (!node.notes.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.textContent = 'Henüz not eklenmedi.';
    list.appendChild(empty);
  } else {
    [...node.notes].reverse().forEach(n => {
      const item = document.createElement('div');
      item.className = 'drawer-note-item';

      const itemHeader = document.createElement('div');
      itemHeader.className = 'drawer-note-header';
      const meta = document.createElement('span');
      meta.className = 'drawer-note-meta';
      meta.textContent = formatNoteDate(n.createdAt);
      itemHeader.appendChild(meta);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn icon-btn-danger';
      delBtn.title = 'Notu sil';
      delBtn.innerHTML = ICON.trash;
      delBtn.onclick = () => {
        node.notes = node.notes.filter(x => x.id !== n.id);
        persist();
        renderDrawer();
      };
      itemHeader.appendChild(delBtn);
      item.appendChild(itemHeader);

      const text = document.createElement('div');
      text.className = 'drawer-note-text';
      text.textContent = n.text;
      item.appendChild(text);

      list.appendChild(item);
    });
  }
  wrap.appendChild(list);

  return wrap;
}
