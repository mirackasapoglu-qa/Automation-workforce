// Saf veri: ikonlar, tip/durum meta bilgileri. Başka hiçbir modüle bağımlı değil.

export const ICON = {
  plus: '<svg class="icon" viewBox="0 0 20 20"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 20 20"><path d="M4 6h12"/><path d="M8 6V4.6A1.4 1.4 0 0 1 9.4 3.2h1.2A1.4 1.4 0 0 1 12 4.6V6"/><path d="M6.2 6l.6 9.4a1.4 1.4 0 0 0 1.4 1.3h3.6a1.4 1.4 0 0 0 1.4-1.3L13.8 6"/></svg>',
  download: '<svg class="icon" viewBox="0 0 20 20"><path d="M10 3v9"/><path d="M6.3 9.3 10 13l3.7-3.7"/><path d="M4 16h12"/></svg>',
  upload: '<svg class="icon" viewBox="0 0 20 20"><path d="M10 13V4"/><path d="M6.3 7.7 10 4l3.7 3.7"/><path d="M4 16h12"/></svg>',
  chevronDown: '<svg class="icon icon-sm" viewBox="0 0 20 20"><polyline points="5.5 8 10 12.5 14.5 8"/></svg>',
  check: '<svg class="icon icon-sm" viewBox="0 0 20 20"><polyline points="4.5 10.5 8 14 15.5 6"/></svg>',
  fit: '<svg class="icon" viewBox="0 0 20 20"><path d="M7 3H4a1 1 0 0 0-1 1v3"/><path d="M13 3h3a1 1 0 0 1 1 1v3"/><path d="M17 13v3a1 1 0 0 1-1 1h-3"/><path d="M3 13v3a1 1 0 0 0 1 1h3"/></svg>',
  jira: '<svg class="icon" viewBox="0 0 20 20"><line x1="7.2" y1="3" x2="5.4" y2="17"/><line x1="14.6" y1="3" x2="12.8" y2="17"/><line x1="4" y1="7.2" x2="16" y2="7.2"/><line x1="3" y1="12.8" x2="15" y2="12.8"/></svg>',
  close: '<svg class="icon" viewBox="0 0 20 20"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>',
  gear: '<svg class="icon icon-sm" viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6"/><path d="M10 3.5v2M10 14.5v2M16.5 10h-2M5.5 10h-2M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4M14.6 14.6l-1.4-1.4M6.8 6.8L5.4 5.4"/></svg>',
  typeModule: '<svg class="icon" viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="6" rx="1.3"/><rect x="11" y="3" width="6" height="6" rx="1.3"/><rect x="3" y="11" width="6" height="6" rx="1.3"/><rect x="11" y="11" width="6" height="6" rx="1.3"/></svg>',
  typePage: '<svg class="icon" viewBox="0 0 20 20"><rect x="5" y="2.5" width="10" height="15" rx="1.6"/><line x1="7.3" y1="7" x2="12.7" y2="7"/><line x1="7.3" y1="10.2" x2="12.7" y2="10.2"/><line x1="7.3" y1="13.4" x2="10.5" y2="13.4"/></svg>',
  typeSection: '<svg class="icon" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.6"/><line x1="3" y1="8" x2="17" y2="8"/></svg>',
  typeFunction: '<svg class="icon icon-fill" viewBox="0 0 20 20"><path d="M11.2 2 4.5 11.4h4.1L8 18l7-9.8H10.7L11.2 2Z"/></svg>',
  typeStep: '<svg class="icon" viewBox="0 0 20 20"><line x1="3.5" y1="10" x2="15" y2="10"/><polyline points="11 5.5 15.5 10 11 14.5"/></svg>',
  statusTodo: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.6" stroke-dasharray="2.6 2.6"/></svg>',
  statusOk: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.6"/><polyline points="6.8 10.1 9 12.3 13.3 7.7"/></svg>',
  statusWarn: '<svg class="icon" viewBox="0 0 20 20"><path d="M10 3.4 17 16H3Z"/><line x1="10" y1="8" x2="10" y2="11.6"/><circle class="icon-fill" cx="10" cy="13.6" r="0.55"/></svg>',
  statusFail: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.6"/><line x1="7.4" y1="7.4" x2="12.6" y2="12.6"/><line x1="12.6" y1="7.4" x2="7.4" y2="12.6"/></svg>',
  statusProgress: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.6"/><path d="M10 10V5.8"/><path d="M10 10l3.4 2"/></svg>',
  viewTree: '<svg class="icon" viewBox="0 0 20 20"><circle cx="5" cy="5" r="1.7"/><circle cx="5" cy="15" r="1.7"/><circle cx="15" cy="10" r="1.7"/><path d="M5 6.7V13.3"/><path d="M6.7 10H13.3"/></svg>',
  viewDiagram: '<svg class="icon" viewBox="0 0 20 20"><circle cx="5" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/><circle cx="10" cy="15" r="1.7"/><path d="M5 6.7 10 13.3"/><path d="M15 6.7 10 13.3"/></svg>',
  viewBoard: '<svg class="icon" viewBox="0 0 20 20"><rect x="3" y="3" width="4.2" height="14" rx="1.2"/><rect x="8.9" y="3" width="4.2" height="9.5" rx="1.2"/><rect x="14.8" y="3" width="4.2" height="14" rx="1.2"/></svg>',
  logo: '<svg class="icon" viewBox="0 0 20 20"><circle cx="4.5" cy="4.5" r="1.9"/><circle cx="15.5" cy="4.5" r="1.9"/><circle cx="10" cy="15.5" r="1.9"/><path d="M6 5.8 9 13.2"/><path d="M14 5.8 11 13.2"/></svg>',
  back: '<svg class="icon" viewBox="0 0 20 20"><path d="M16.5 10H4"/><polyline points="9 4.5 3.5 10 9 15.5"/></svg>',
  link: '<svg class="icon" viewBox="0 0 20 20"><path d="M8 5H4.8A1.8 1.8 0 0 0 3 6.8v8.4A1.8 1.8 0 0 0 4.8 17h8.4A1.8 1.8 0 0 0 15 15.2V12"/><path d="M9 11 16.5 3.5"/><path d="M11.5 3.5H16.5V8.5"/></svg>',
  refresh: '<svg class="icon icon-sm" viewBox="0 0 20 20"><path d="M4 10a6 6 0 0 1 10.2-4.2M16 10a6 6 0 0 1-10.2 4.2"/><polyline points="13.4 3.6 14.4 6.4 11.4 6.8"/><polyline points="6.6 16.4 5.6 13.6 8.6 13.2"/></svg>',
  globe: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M3 10h14"/><path d="M10 3c2.6 2 2.6 12 0 14"/><path d="M10 3c-2.6 2-2.6 12 0 14"/></svg>',
  figma: '<svg class="icon" viewBox="0 0 20 20"><rect x="6" y="2.4" width="4.2" height="4.2" rx="2.1"/><rect x="6" y="7.4" width="4.2" height="4.2" rx="1.1"/><rect x="6" y="12.4" width="4.2" height="4.2" rx="2.1"/><circle cx="13.6" cy="9.5" r="2.1"/></svg>',
  history: '<svg class="icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M10 6.2v4l3 2"/></svg>',
  search: '<svg class="icon" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><line x1="12.3" y1="12.3" x2="16.5" y2="16.5"/></svg>',
  checkSquare: '<svg class="icon" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2.6"/><polyline points="6.5 10.2 8.8 12.5 13.8 7.2"/></svg>',
  sparkle: '<svg class="icon" viewBox="0 0 20 20"><path d="M9 3 10.3 7.7 15 9 10.3 10.3 9 15 7.7 10.3 3 9 7.7 7.7 9 3Z"/><path d="M15.5 12 16.1 14.1 18 14.7 16.1 15.3 15.5 17.4 14.9 15.3 13 14.7 14.9 14.1 15.5 12Z"/></svg>',
  confluence: '<svg class="icon" viewBox="0 0 20 20"><path d="M5 3.5h7l3 3v10H5Z"/><path d="M12 3.5v3h3"/><line x1="7.5" y1="10" x2="12.5" y2="10"/><line x1="7.5" y1="13" x2="12.5" y2="13"/></svg>',
  play: '<svg class="icon icon-fill" viewBox="0 0 20 20"><path d="M6 4.2 15.5 10 6 15.8Z"/></svg>'
};

export const TYPE_ORDER = ['module', 'page', 'section', 'function', 'step'];
export const TYPE_META = {
  module: { label: 'MODÜL', icon: ICON.typeModule },
  page: { label: 'SAYFA', icon: ICON.typePage },
  section: { label: 'BÖLÜM', icon: ICON.typeSection },
  function: { label: 'FONKSİYON', icon: ICON.typeFunction },
  step: { label: 'ADIM', icon: ICON.typeStep }
};
export const NEXT_TYPE = { module: 'page', page: 'section', section: 'function', function: 'step', step: 'step' };
export const DEFAULT_NAME = {
  module: 'Yeni modül', page: 'Yeni sayfa', section: 'Yeni bölüm',
  function: 'Yeni fonksiyon', step: 'Yeni adım'
};

export const STATUS_ORDER = ['⬜', '🔵', '✅', '⚠️', '❌'];
export const STATUS_META = {
  '⬜': { label: 'Bekliyor', icon: ICON.statusTodo, colorVar: 'var(--neutral)' },
  '🔵': { label: 'Devam Ediyor', icon: ICON.statusProgress, colorVar: 'var(--progress)' },
  '✅': { label: 'Tamamlandı', icon: ICON.statusOk, colorVar: 'var(--good)' },
  '⚠️': { label: 'Uyarılı', icon: ICON.statusWarn, colorVar: 'var(--warn)' },
  '❌': { label: 'Hatalı', icon: ICON.statusFail, colorVar: 'var(--fail)' }
};
export function statusClass(s) {
  return { '✅': 'ok', '❌': 'fail', '⚠️': 'warn', '⬜': 'todo', '🔵': 'progress' }[s] || 'todo';
}

// Worse status wins when rolling a parent's status up from its children. "Devam Ediyor" hata/uyarıdan
// düşük ama bekliyor/tamamlandıdan yüksek — bir dalda iş devam ediyorsa üst öğeler de bunu yansıtsın.
export const STATUS_RANK = { '❌': 4, '⚠️': 3, '🔵': 2, '⬜': 1, '✅': 0 };
