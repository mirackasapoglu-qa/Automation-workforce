// Kaynaklar özelliği: her öğeye Figma/Jira/genel tasarım-dokümantasyon linki eklenebilir.
// Jira Task ID'lerin aksine burada canlı doğrulama yok — sadece URL biçimi kontrol edilir.
import { newResourceLinkId } from './state.js';
import { ICON } from './constants.js';
import { persist } from './data.js';
import { renderDrawer } from './drawer.js';

const RESOURCE_TYPE_META = {
  figma: { label: 'Figma', icon: ICON.figma },
  confluence: { label: 'Confluence', icon: ICON.confluence },
  jira: { label: 'Jira', icon: ICON.jira },
  link: { label: 'Link', icon: ICON.globe }
};

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

// new URL() Chrome'da beklenenden daha toleranslıdır: "https://not a url" gibi bir girdiyi
// atmak yerine boşlukları %20'ye çevirip sessizce kabul eder. Bu yüzden ayrıca host'un
// boşluk/geçersiz karakter içermediğini ve gerçek bir alan adı gibi göründüğünü (en az bir
// nokta içerdiğini, localhost hariç) kontrol ediyoruz.
function isValidResourceUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (!parsed.hostname || /%20|\s/.test(parsed.hostname)) return false;
  if (parsed.hostname !== 'localhost' && !parsed.hostname.includes('.')) return false;
  return true;
}

function detectResourceType(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes('figma.com')) return 'figma';
    // Confluence Cloud, Jira ile aynı *.atlassian.net alan adını "/wiki/" altında paylaşır —
    // bu yüzden confluence kontrolü jira kontrolünden önce gelmeli.
    if (host.includes('confluence') || path.startsWith('/wiki/')) return 'confluence';
    if (host.includes('atlassian.net') || host.includes('jira')) return 'jira';
  } catch (e) { /* geçersiz URL, genel link olarak devam */ }
  return 'link';
}

function displayDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

export function renderDrawerResourcesSection(node) {
  const section = document.createElement('div');
  section.className = 'drawer-section';

  const label = document.createElement('div');
  label.className = 'drawer-section-label';
  label.innerHTML = ICON.globe + '<span>Kaynaklar</span>'
    + (node.resourceLinks.length ? ` <span class="drawer-tab-count">${node.resourceLinks.length}</span>` : '');
  section.appendChild(label);

  const addRow = document.createElement('div');
  addRow.className = 'drawer-resource-add';
  const urlInput = document.createElement('input');
  urlInput.className = 'drawer-input drawer-resource-url-input';
  urlInput.placeholder = 'Figma / Confluence / Jira / diğer bağlantı';
  addRow.appendChild(urlInput);
  const labelInput = document.createElement('input');
  labelInput.className = 'drawer-input drawer-resource-label-input';
  labelInput.placeholder = 'Etiket (opsiyonel)';
  addRow.appendChild(labelInput);
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Ekle';
  addRow.appendChild(addBtn);
  section.appendChild(addRow);

  const errorEl = document.createElement('div');
  errorEl.className = 'drawer-resource-error';
  errorEl.style.display = 'none';
  section.appendChild(errorEl);

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    urlInput.classList.add('drawer-input-error');
  };
  const clearError = () => {
    errorEl.style.display = 'none';
    urlInput.classList.remove('drawer-input-error');
  };

  const submit = () => {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) return;
    const url = normalizeUrl(rawUrl);
    if (!isValidResourceUrl(url)) {
      showError('Geçerli bir URL girin.');
      return;
    }
    clearError();
    node.resourceLinks.push({
      id: newResourceLinkId(),
      url,
      label: labelInput.value.trim(),
      type: detectResourceType(url),
      createdAt: new Date().toISOString()
    });
    persist();
    renderDrawer();
  };
  addBtn.onclick = submit;
  [urlInput, labelInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  urlInput.addEventListener('input', clearError);

  const list = document.createElement('div');
  list.className = 'drawer-resource-list';
  if (!node.resourceLinks.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-placeholder';
    empty.style.padding = '16px 12px';
    empty.textContent = 'Henüz kaynak eklenmedi.';
    list.appendChild(empty);
  } else {
    const sorted = [...node.resourceLinks].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    sorted.forEach(r => {
      const meta = RESOURCE_TYPE_META[r.type] || RESOURCE_TYPE_META.link;
      const chip = document.createElement('div');
      chip.className = 'drawer-resource-chip';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'drawer-resource-chip-icon';
      iconWrap.innerHTML = meta.icon;
      chip.appendChild(iconWrap);

      const main = document.createElement('a');
      main.className = 'drawer-resource-chip-main';
      main.href = r.url;
      main.target = '_blank';
      main.rel = 'noopener';

      const labelText = document.createElement('div');
      labelText.className = 'drawer-resource-chip-label';
      labelText.textContent = r.label || meta.label;
      main.appendChild(labelText);

      const urlText = document.createElement('div');
      urlText.className = 'drawer-resource-chip-url';
      urlText.textContent = displayDomain(r.url);
      main.appendChild(urlText);

      chip.appendChild(main);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'drawer-resource-chip-remove';
      removeBtn.title = 'Kaldır';
      removeBtn.innerHTML = ICON.close;
      removeBtn.onclick = () => {
        node.resourceLinks = node.resourceLinks.filter(x => x.id !== r.id);
        persist();
        renderDrawer();
      };
      chip.appendChild(removeBtn);

      list.appendChild(chip);
    });
  }
  section.appendChild(list);

  return section;
}
