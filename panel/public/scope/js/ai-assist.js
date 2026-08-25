// Claude Code'un devreye girmesi gereken anlarda kullanıcıya kopyalanabilir bir istem (prompt)
// gösteren modal. Şu an için Flowscope ile Claude Code arasında otomatik bir bağlantı yok —
// QA uzmanı burada üretilen mesajı kopyalar ve doğrudan Claude Code sohbetine yapıştırır.
import { state } from './state.js';
import { ICON } from './constants.js';

export function openAiAssistModal({ title, description, prompt }) {
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

  modal.appendChild(body);
  state.root.appendChild(overlay);
}

export function closeAiAssistModal() {
  const overlay = state.root.querySelector('.ai-assist-overlay');
  if (overlay) overlay.remove();
}
