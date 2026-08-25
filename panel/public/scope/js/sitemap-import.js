// URL'den içerik haritası çıkarma: backend'deki Playwright tabanlı /api/crawl işini
// başlatır, ilerlemeyi periyodik olarak sorgular, sonucu önizleyip ağaca ekler.
import { state, newId } from './state.js';
import { ICON } from './constants.js';
import { persist } from './data.js';
import { renderContent } from './shell.js';

let pollTimer = null;
let currentJobId = null;
let loginContinueRequested = false;

function closeModal() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentJobId = null;
  const overlay = state.root.querySelector('.sitemap-overlay');
  if (overlay) overlay.remove();
}

function assignIds(node) {
  node.id = newId();
  (node.children || []).forEach(assignIds);
  return node;
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

function renderPreviewTree(node, container, depth) {
  const row = document.createElement('div');
  row.className = 'sitemap-preview-row';
  row.style.paddingLeft = (depth * 16) + 'px';
  const name = document.createElement('span');
  name.textContent = node.name;
  row.appendChild(name);
  const badge = document.createElement('span');
  badge.className = 'sitemap-preview-type';
  badge.textContent = node.type;
  row.appendChild(badge);
  container.appendChild(row);
  (node.children || []).forEach(c => renderPreviewTree(c, container, depth + 1));
}

export function openSitemapImportModal() {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'sitemap-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const modal = document.createElement('div');
  modal.className = 'sitemap-modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'sitemap-modal-header';
  const title = document.createElement('div');
  title.className = 'sitemap-modal-title';
  title.textContent = 'URL’den İçerik Haritası Çıkar';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drawer-close';
  closeBtn.innerHTML = ICON.close;
  closeBtn.onclick = closeModal;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'sitemap-modal-body';
  modal.appendChild(body);

  function renderForm() {
    body.innerHTML = '';
    loginContinueRequested = false;

    const hint = document.createElement('div');
    hint.className = 'drawer-hint';
    hint.textContent = 'Verilen URL ve aynı site içindeki bağlantılar taranır (JS ile render edilen sitelerde de çalışır); '
      + 'her sayfadaki başlık yapısından (h1/h2/h3) otomatik bir modül/sayfa/bölüm ağacı çıkarılır.';
    body.appendChild(hint);

    const urlField = document.createElement('input');
    urlField.className = 'drawer-input sitemap-url-input';
    urlField.placeholder = 'https://example.com';
    urlField.type = 'url';
    body.appendChild(urlField);

    const row = document.createElement('div');
    row.className = 'sitemap-field-row';

    const depthWrap = document.createElement('label');
    depthWrap.className = 'sitemap-field';
    const depthLabel = document.createElement('span');
    depthLabel.textContent = 'Derinlik';
    depthWrap.appendChild(depthLabel);
    const depthInput = document.createElement('input');
    depthInput.type = 'number'; depthInput.min = '0'; depthInput.max = '4'; depthInput.value = '2';
    depthWrap.appendChild(depthInput);
    const depthHint = document.createElement('span');
    depthHint.className = 'sitemap-field-hint';
    depthHint.textContent = 'Linklerde kaç adım ileri gidilsin. 0 = sadece bu sayfa, 1 = bu sayfa + linkleri, 2 = onların da linkleri…';
    depthWrap.appendChild(depthHint);
    row.appendChild(depthWrap);

    const pagesWrap = document.createElement('label');
    pagesWrap.className = 'sitemap-field';
    const pagesLabel = document.createElement('span');
    pagesLabel.textContent = 'Maks. sayfa';
    pagesWrap.appendChild(pagesLabel);
    const pagesInput = document.createElement('input');
    pagesInput.type = 'number'; pagesInput.min = '1'; pagesInput.max = '60'; pagesInput.value = '15';
    pagesWrap.appendChild(pagesInput);
    const pagesHint = document.createElement('span');
    pagesHint.className = 'sitemap-field-hint';
    pagesHint.textContent = 'Derinlik ne olursa olsun toplamda en fazla kaç sayfa taranacağının üst sınırı (en fazla 60).';
    pagesWrap.appendChild(pagesHint);
    row.appendChild(pagesWrap);

    body.appendChild(row);

    const loginWrap = document.createElement('label');
    loginWrap.className = 'sitemap-checkbox-row';
    const loginCheckbox = document.createElement('input');
    loginCheckbox.type = 'checkbox';
    loginWrap.appendChild(loginCheckbox);
    const loginText = document.createElement('span');
    loginText.textContent = 'Bu site için giriş yapmam gerekiyor (e-posta/şifre veya e-posta/kod)';
    loginWrap.appendChild(loginText);
    body.appendChild(loginWrap);
    const loginHint = document.createElement('div');
    loginHint.className = 'sitemap-field-hint sitemap-login-hint';
    loginHint.textContent = 'İşaretlersen gerçek, görünür bir tarayıcı penceresi açılır; giriş bilgilerini bu uygulamaya değil, '
      + 'doğrudan o pencerede sitenin kendisine girersin. Şifreni asla görmeyiz veya saklamayız.';
    body.appendChild(loginHint);

    const interactWrap = document.createElement('label');
    interactWrap.className = 'sitemap-checkbox-row';
    const interactCheckbox = document.createElement('input');
    interactCheckbox.type = 'checkbox';
    interactWrap.appendChild(interactCheckbox);
    const interactText = document.createElement('span');
    interactText.textContent = 'Etkileşimli öğeleri de dene (buton/sekme/panel aç) — riskli, dikkatli kullan';
    interactWrap.appendChild(interactText);
    body.appendChild(interactWrap);
    const interactHint = document.createElement('div');
    interactHint.className = 'sitemap-field-hint sitemap-login-hint';
    interactHint.textContent = 'İşaretlersen her sayfada birkaç buton/sekmeye tıklanıp açılan içerik de haritaya eklenir '
      + '(sil/kaydet/gönder/onayla gibi durum değiştiren butonlara asla tıklanmaz, hiçbir forma veri girilmez). '
      + 'Yine de canlı sistemlerde beklenmedik yan etkiler doğurabilir — mümkünse test ortamında kullan; taramayı da yavaşlatır.';
    body.appendChild(interactHint);

    const robotsWrap = document.createElement('label');
    robotsWrap.className = 'sitemap-checkbox-row';
    const robotsCheckbox = document.createElement('input');
    robotsCheckbox.type = 'checkbox';
    robotsWrap.appendChild(robotsCheckbox);
    const robotsText = document.createElement('span');
    robotsText.textContent = 'robots.txt kurallarını yoksay — yalnızca kendi projenin ortamında';
    robotsWrap.appendChild(robotsText);
    body.appendChild(robotsWrap);
    const robotsHint = document.createElement('div');
    robotsHint.className = 'sitemap-field-hint sitemap-login-hint';
    robotsHint.textContent = 'Test/staging ortamları arama motorlarını dışarıda tutmak için genelde '
      + '"Disallow: /" yazar; bu, ekibin kendi QA aracını yasaklamak anlamına gelmez. Bu seçenek YALNIZCA '
      + 'hedef adres projenin kendi host\'u olduğunda uygulanır — yabancı bir sitede yoksayılır.';
    body.appendChild(robotsHint);

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'btn btn-primary sitemap-start-btn';
    startBtn.textContent = 'Taramayı Başlat';
    startBtn.onclick = () => {
      const url = urlField.value.trim();
      if (!url) return;
      startCrawl(url, depthInput.value, pagesInput.value, loginCheckbox.checked, interactCheckbox.checked, robotsCheckbox.checked);
    };
    body.appendChild(startBtn);

    urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });
    requestAnimationFrame(() => urlField.focus());
  }

  function renderProgress(job) {
    body.innerHTML = '';
    const spin = document.createElement('div');
    spin.className = 'sitemap-spinner';
    spin.innerHTML = ICON.refresh;
    body.appendChild(spin);
    const status = document.createElement('div');
    status.className = 'sitemap-progress-text';
    status.textContent = job.visited + ' / ' + job.total + ' sayfa tarandı';
    body.appendChild(status);
    const current = document.createElement('div');
    current.className = 'sitemap-progress-url';
    current.textContent = job.currentUrl || '';
    body.appendChild(current);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'İptal';
    cancelBtn.onclick = () => {
      const jobId = currentJobId;
      closeModal();
      if (jobId) {
        fetch('/api/crawl-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
          body: JSON.stringify({ jobId })
        });
      }
    };
    body.appendChild(cancelBtn);
  }

  function renderWaitingLogin() {
    body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'sitemap-login-msg';
    msg.innerHTML = 'Bilgisayarında az önce yeni bir tarayıcı penceresi açıldı. <strong>O pencerede</strong> siteye normal '
      + 'şekilde giriş yap (e-posta + şifre veya e-posta + kod, site ne istiyorsa). Giriş bilgilerini asla bu uygulamaya '
      + 'girme — yalnızca açılan gerçek tarayıcı penceresinde, doğrudan sitenin kendi giriş ekranına gir. Giriş bitince '
      + 'aşağıdaki butona tıkla.';
    body.appendChild(msg);

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'btn btn-primary sitemap-start-btn';
    continueBtn.textContent = 'Girişi Tamamladım, Taramaya Devam Et';
    continueBtn.onclick = () => {
      loginContinueRequested = true;
      const jobId = currentJobId;
      body.innerHTML = '';
      const spin = document.createElement('div');
      spin.className = 'sitemap-spinner';
      spin.innerHTML = ICON.refresh;
      body.appendChild(spin);
      const txt = document.createElement('div');
      txt.className = 'sitemap-progress-text';
      txt.textContent = 'Taramaya başlanıyor…';
      body.appendChild(txt);
      fetch('/api/crawl-continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
        body: JSON.stringify({ jobId })
      });
    };
    body.appendChild(continueBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.style.marginTop = '10px';
    cancelBtn.textContent = 'İptal';
    cancelBtn.onclick = () => {
      const jobId = currentJobId;
      closeModal();
      if (jobId) {
        fetch('/api/crawl-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
          body: JSON.stringify({ jobId })
        });
      }
    };
    body.appendChild(cancelBtn);
  }

  function renderError(message) {
    body.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'sitemap-error';
    err.textContent = message;
    body.appendChild(err);
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-primary';
    retryBtn.textContent = 'Tekrar Dene';
    retryBtn.onclick = renderForm;
    body.appendChild(retryBtn);
  }

  function renderResult(tree) {
    body.innerHTML = '';
    const count = countNodes(tree);
    const summary = document.createElement('div');
    summary.className = 'sitemap-summary';
    summary.textContent = count + ' öğe bulundu. Ağaca yeni bir modül olarak eklensin mi?';
    body.appendChild(summary);

    const preview = document.createElement('div');
    preview.className = 'sitemap-preview';
    renderPreviewTree(tree, preview, 0);
    body.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'jira-prompt-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Vazgeç';
    cancelBtn.onclick = closeModal;
    actions.appendChild(cancelBtn);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Ağaca Ekle';
    addBtn.onclick = () => {
      assignIds(tree);
      state.tree.push(tree);
      persist();
      renderContent();
      closeModal();
    };
    actions.appendChild(addBtn);
    body.appendChild(actions);
  }

  function poll() {
    if (!currentJobId) return;
    fetch('/api/crawl-status?jobId=' + encodeURIComponent(currentJobId))
      .then(r => r.json())
      .then(data => {
        if (!currentJobId) return; // modal bu arada kapatıldı
        if (!data.ok) {
          clearInterval(pollTimer); pollTimer = null;
          renderError(data.error || 'İş bulunamadı.');
          return;
        }
        const job = data.job;
        if (job.status === 'waiting_login') {
          if (!loginContinueRequested) renderWaitingLogin();
        } else if (job.status === 'running') {
          renderProgress(job);
        } else if (job.status === 'done') {
          clearInterval(pollTimer); pollTimer = null;
          renderResult(job.tree);
        } else if (job.status === 'error') {
          clearInterval(pollTimer); pollTimer = null;
          renderError(job.error || 'Tarama başarısız oldu.');
        } else if (job.status === 'cancelled') {
          clearInterval(pollTimer); pollTimer = null;
          closeModal();
        }
      })
      .catch(() => { /* geçici ağ hatası — bir sonraki pollde tekrar denenir */ });
  }

  function startCrawl(url, maxDepth, maxPages, requireLogin, interactWithUI, ignoreRobots) {
    body.innerHTML = '';
    loginContinueRequested = false;
    const spin = document.createElement('div');
    spin.className = 'sitemap-spinner';
    spin.innerHTML = ICON.refresh;
    body.appendChild(spin);

    fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
      body: JSON.stringify({
        url, maxDepth: Number(maxDepth), maxPages: Number(maxPages),
        requireLogin: !!requireLogin, interactWithUI: !!interactWithUI, ignoreRobots: !!ignoreRobots
      })
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { renderError(data.error || 'Tarama başlatılamadı.'); return; }
        currentJobId = data.jobId;
        poll();
        pollTimer = setInterval(poll, 1200);
      })
      .catch(() => renderError('Panel sunucusuna ulaşılamadı.'));
  }

  renderForm();
  state.root.appendChild(overlay);
}
