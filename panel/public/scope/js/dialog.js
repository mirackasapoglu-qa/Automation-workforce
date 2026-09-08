// Flowscope bildirimleri — panelin `uiToast` / `uiConfirm` deseninin ES modül hâli.
//
// NEDEN: tarayıcının `alert`/`confirm` kutuları panelin dilini konuşmuyor
// ("localhost web sitesinin mesajı" başlığı, temasız, sayfayı kilitliyor).
// Ana panel 2026-08-29'da tamamen geçmişti; Flowscope'ta dört çağrı kalmıştı
// (chips.js sil, data.js tümünü sil, shell.js bozuk yedek, testcase-request.js
// hata). Aynı API, aynı davranış:
//   uiToast(mesaj, { type: 'info'|'ok'|'err', title, ms })   — hata KENDİLİĞİNDEN KAPANMAZ
//   uiConfirm(mesaj, { title, ok, cancel, danger }) → Promise<boolean> — Escape/dışa tık = vazgeç
//
// ⚠️ uiConfirm ASENKRON: `if (!await uiConfirm(...)) return;` — await'siz hâli
// her zaman truthy Promise döner ve yıkıcı işlem onay sormadan çalışır.
//
// Biçim tema token'larından (theme.css); token yoksa makul düşüş değerleri.

let cssInjected = false;
function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
#fwToasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:9999;max-width:min(420px,calc(100vw - 32px))}
.fw-toast{background:var(--surface-raised,var(--surface,#1b2027));color:var(--text,#e6eaee);border:1px solid var(--border,#2b3640);border-radius:var(--radius,8px);box-shadow:var(--shadow,0 6px 24px rgba(0,0,0,.35));padding:10px 12px;font-size:13px;line-height:1.45}
.fw-toast .hd{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:4px}
.fw-toast .dot{width:8px;height:8px;border-radius:50%;flex:none}
.fw-toast .x{margin-left:auto;background:none;border:0;color:var(--text-muted,#9aa5b1);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}
.fw-toast .bd{white-space:pre-line;color:var(--text-muted,#c7ced6)}
#fwAsk{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000}
#fwAsk .box{background:var(--surface,#1b2027);color:var(--text,#e6eaee);border:1px solid var(--border,#2b3640);border-radius:var(--radius,10px);box-shadow:var(--shadow,0 10px 40px rgba(0,0,0,.5));padding:18px 20px;width:min(440px,calc(100vw - 32px))}
#fwAsk h3{margin:0 0 8px;font-size:15px}
#fwAsk .msg{white-space:pre-line;font-size:13.5px;color:var(--text-muted,#c7ced6);margin:0 0 16px}
#fwAsk .row{display:flex;justify-content:flex-end;gap:8px}
#fwAsk button{font:inherit;font-size:13px;padding:7px 14px;border-radius:var(--radius-sm,6px);border:1px solid var(--border,#2b3640);background:var(--surface-raised,transparent);color:var(--text,#e6eaee);cursor:pointer}
#fwAsk button.danger{background:var(--fail,#b42318);border-color:var(--fail,#b42318);color:#fff}
#fwAsk button.primary{background:var(--accent,#0e6e8c);border-color:var(--accent,#0e6e8c);color:var(--accent-on,#fff)}
#fwAsk button:focus-visible{outline:2px solid var(--accent,#4fb3d4);outline-offset:2px}`;
  document.head.appendChild(s);
}

export function uiToast(mesaj, opt = {}) {
  ensureCss();
  const tip = opt.type || 'info';
  let yigin = document.getElementById('fwToasts');
  if (!yigin) { yigin = document.createElement('div'); yigin.id = 'fwToasts'; document.body.appendChild(yigin); }
  const t = document.createElement('div');
  t.className = 'fw-toast';
  t.setAttribute('role', tip === 'err' ? 'alert' : 'status');
  const renk = tip === 'err' ? 'var(--fail,#b42318)' : tip === 'ok' ? 'var(--good,#1f7a4d)' : 'var(--accent,#0e6e8c)';
  const baslik = opt.title || (tip === 'err' ? 'Hata' : tip === 'ok' ? 'Tamam' : 'Bilgi');
  const hd = document.createElement('div'); hd.className = 'hd';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = renk;
  const x = document.createElement('button'); x.className = 'x'; x.title = 'Kapat'; x.textContent = '×'; x.onclick = () => t.remove();
  hd.append(dot, document.createTextNode(baslik), x);
  const bd = document.createElement('div'); bd.className = 'bd'; bd.textContent = String(mesaj ?? '');
  t.append(hd, bd);
  yigin.appendChild(t);
  const sure = opt.ms ?? (tip === 'err' ? 0 : 6000);
  if (sure) setTimeout(() => t.remove(), sure);
  return t;
}

/** @returns {Promise<boolean>} */
export function uiConfirm(mesaj, opt = {}) {
  ensureCss();
  return new Promise((resolve) => {
    document.getElementById('fwAsk')?.remove();
    const ov = document.createElement('div');
    ov.id = 'fwAsk';
    const box = document.createElement('div'); box.className = 'box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3'); h.textContent = opt.title || 'Onay gerekiyor';
    const msg = document.createElement('div'); msg.className = 'msg'; msg.textContent = String(mesaj ?? '');
    const row = document.createElement('div'); row.className = 'row';
    const no = document.createElement('button'); no.textContent = opt.cancel || 'Vazgeç';
    const yes = document.createElement('button'); yes.textContent = opt.ok || 'Devam et';
    yes.className = opt.danger === false ? 'primary' : 'danger';
    row.append(no, yes);
    box.append(h, msg, row);
    ov.appendChild(box);
    const kapat = (cevap) => { document.removeEventListener('keydown', tus); ov.remove(); resolve(cevap); };
    const tus = (e) => { if (e.key === 'Escape') kapat(false); if (e.key === 'Enter') kapat(true); };
    no.onclick = () => kapat(false);
    yes.onclick = () => kapat(true);
    ov.onclick = (e) => { if (e.target === ov) kapat(false); };
    document.addEventListener('keydown', tus);
    document.body.appendChild(ov);
    yes.focus();
  });
}
