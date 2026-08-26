// Claude Code'un devreye girmesi gereken anlarda kullanıcıya kopyalanabilir bir istem (prompt)
// gösteren modal. Panel modeli kendisi çağırmaz (ikinci bir API kimliği istemez) —
// QA uzmanı burada üretilen mesajı kopyalar, Claude Code sohbetine yapıştırır.
//
// `onApply` verilirse modal İKİ ADIMLI olur: aşağıda bir yapıştırma alanı çıkar ve
// Claude Code'un döndürdüğü JSON aynı yerden ağaca yazılır. Kopyala-yapıştır turunun
// ikinci yarısı ayrı bir düğmeye/tarayıcı prompt()'una dağılmasın diye burada.
import { state } from './state.js';
import { ICON } from './constants.js';

export function openAiAssistModal({ title, description, prompt, onApply, applyLabel }) {
  closeAiAssistModal();
  const overlay = document.createElement('div');
  overlay.className = 'ai-assist-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeAiAssistModal(); };

  const modal = document.createElement('div');
  modal.className = 'ai-assist-modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'ai-assist-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'ai-assist-title';
  titleEl.innerHTML = ICON.sparkle + `<span>${title}</span>`;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drawer-close';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = closeAiAssistModal;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ai-assist-body';

  const desc = document.createElement('div');
  desc.className = 'drawer-hint ai-assist-desc';
  desc.textContent = description;
  body.appendChild(desc);

  const textarea = document.createElement('textarea');
  textarea.className = 'drawer-textarea ai-assist-textarea';
  textarea.readOnly = true;
  textarea.rows = 8;
  textarea.value = prompt;
  body.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'jira-prompt-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-primary';
  copyBtn.innerHTML = ICON.link + '<span>Mesajı Kopyala</span>';
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (e) {
      textarea.removeAttribute('readonly');
      textarea.select();
      document.execCommand('copy');
      textarea.setAttribute('readonly', 'true');
    }
    copyBtn.innerHTML = ICON.check + '<span>Kopyalandı</span>';
    setTimeout(() => { copyBtn.innerHTML = ICON.link + '<span>Mesajı Kopyala</span>'; }, 1500);
  };
  actions.appendChild(copyBtn);
  const closeAction = document.createElement('button');
  closeAction.type = 'button';
  closeAction.className = 'btn';
  closeAction.textContent = 'Kapat';
  closeAction.onclick = closeAiAssistModal;
  actions.appendChild(closeAction);
  body.appendChild(actions);

  if (typeof onApply === 'function') {
    const pasteLabel = document.createElement('div');
    pasteLabel.className = 'drawer-section-label';
    pasteLabel.textContent = '2. Claude Code\'un döndürdüğü JSON';
    body.appendChild(pasteLabel);

    const pasteHint = document.createElement('div');
    pasteHint.className = 'drawer-hint';
    pasteHint.textContent = 'Yanıttaki JSON\'u buraya yapıştır — case\'ler taslak olarak ağaca yazılır.';
    body.appendChild(pasteHint);

    const pasteArea = document.createElement('textarea');
    pasteArea.className = 'drawer-textarea ai-assist-textarea';
    pasteArea.rows = 5;
    pasteArea.placeholder = '{"items":[{"nodeId":"n12","cases":[...]}]}';
    body.appendChild(pasteArea);

    const sonuc = document.createElement('div');
    sonuc.className = 'drawer-hint';
    sonuc.style.whiteSpace = 'pre-line';

    const applyActions = document.createElement('div');
    applyActions.className = 'jira-prompt-actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn-primary';
    applyBtn.innerHTML = ICON.check + `<span>${applyLabel || 'Ağaca yaz'}</span>`;
    applyBtn.onclick = async () => {
      const ham = pasteArea.value.trim();
      if (!ham) { sonuc.textContent = 'Önce JSON yapıştır.'; return; }
      let govde;
      // Model bazen JSON'u ``` bloğuna sarıyor — kırılmasın diye soyuluyor.
      try {
        govde = JSON.parse(ham.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
      } catch (e) {
        sonuc.textContent = `JSON okunamadı: ${e.message}`;
        return;
      }
      const eski = applyBtn.innerHTML;
      applyBtn.disabled = true;
      applyBtn.innerHTML = '<span>yazılıyor…</span>';
      try {
        sonuc.textContent = (await onApply(govde)) || 'Yazıldı.';
      } catch (e) {
        sonuc.textContent = e.message || 'Yazılamadı.';
      } finally {
        applyBtn.disabled = false;
        applyBtn.innerHTML = eski;
      }
    };
    applyActions.appendChild(applyBtn);
    body.appendChild(applyActions);
    body.appendChild(sonuc);
  }

  modal.appendChild(body);
  state.root.appendChild(overlay);
}

export function closeAiAssistModal() {
  const overlay = state.root.querySelector('.ai-assist-overlay');
  if (overlay) overlay.remove();
}
