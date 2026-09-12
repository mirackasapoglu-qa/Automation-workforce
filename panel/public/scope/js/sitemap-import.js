// URL'den içerik haritası çıkarma: backend'deki Playwright tabanlı /api/crawl işini
// başlatır, ilerlemeyi periyodik olarak sorgular, sonucu önizleyip ağaca ekler.
import { state, newId, newResourceLinkId } from './state.js';
import { ICON } from './constants.js';
import { persist } from './data.js';
import { renderContent } from './shell.js';
import { uiToast } from './dialog.js';

let pollTimer = null;
let currentJobId = null;
let loginContinueRequested = false;
/** Son başlatılan taramanın parametreleri — sonuç ekranındaki "Daha Detaylı Tara"
 *  linki forma dönerken bunları temel alıp derinlik/sayfayı bir üst kademeye taşır. */
let lastParams = null;

/**
 * "Sinema" modu: tarama sürerken pop-up büyür, tüm ekranın arkasında bulanık,
 * döngülü bir video oynar; modal ve içerik cam (liquid-glass) katmanlarda durur. Yalnızca bekleme
 * ekranlarında; form ve sonuç ekranı normal boyuta döner. Video dışarıdan
 * gelir; yüklenemezse modalın kendi koyu degrade zemini kalır, akış bozulmaz.
 */
// Ana kaynak: Mux HLS akışı (uyarlanabilir bit hızı, hızlı ilk kare). Safari HLS'i yerel oynatır;
// Chrome/Firefox için hls.js ihtiyaç anında CDN'den yüklenir. Akış ya da hls.js gelmezse
// eski MP4'e düşülür; o da gelmezse modalın koyu degrade zemini kalır.
const BG_VIDEO_HLS = 'https://stream.mux.com/8wrHPCX2dC3msyYU9ObwqNdm00u3ViXvOSHUMRYSEe5Q.m3u8';
const BG_VIDEO_MP4 = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260511_230229_7c9bc431-46cf-489a-948d-e8144d8eb5d4.mp4';
const HLS_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.15/hls.min.js';
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let hlsJsPromise = null;
/** hls.js'i bir kez, sinema modu ilk açıldığında yükler (sayfa açılışını şişirmez). */
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsJsPromise) {
    hlsJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS_JS_SRC; s.async = true;
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js global yok')));
      s.onerror = () => reject(new Error('hls.js yüklenemedi'));
      document.head.appendChild(s);
    }).catch((e) => { hlsJsPromise = null; throw e; });
  }
  return hlsJsPromise;
}

function closeModal() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentJobId = null;
  lastParams = null;
  const overlay = state.root.querySelector('.sitemap-overlay');
  if (!overlay) return;
  // Sinema videosu DOM'dan kopsa da hls.js segment indirmeyi sürdürür — önce yık.
  const video = overlay.querySelector('.sitemap-cinema-video');
  if (video) {
    video.pause();
    if (video._hls) { try { video._hls.destroy(); } catch { /* yoksay */ } video._hls = null; }
  }
  overlay.remove();
}

/** Ağaca eklenmeden önce her düğüme gerçek id, her kaynak linkine de id basar;
 *  seçim ekranının kullandığı geçici `_checked` alanını temizler. */
function assignIds(node) {
  node.id = newId();
  delete node._checked;
  (node.resourceLinks || []).forEach(rl => { if (!rl.id) rl.id = newResourceLinkId(); });
  (node.children || []).forEach(assignIds);
  return node;
}

/** Yalnızca http(s) ve mutlak adres; aksi hâlde boş. Hash'ten gelen değer güvenilmez girdi. */
function safeHttpUrl(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

function countPages(node) {
  return (node.type === 'page' ? 1 : 0) + (node.children || []).reduce((s, c) => s + countPages(c), 0);
}

/**
 * Türkçe-uyumlu küçültme: RAG indeksinde (scripts/rag-index.mjs) kullanılan aynı ilke —
 * İ/ı önce NFD'ye ayrılıp işaretler atılır, sonra küçültülür. Naif toLowerCase() Türkçe
 * büyük İ'yi yanlış katlar (bkz. CLAUDE.md "Homee seçici tuzakları").
 */
function trNormalize(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

/** node ya da altındaki HERHANGİ bir düğüm arama metniyle eşleşiyor mu (boş arama = hepsi eşleşir). */
function nodeMatches(node, needle) {
  if (!needle) return true;
  if (trNormalize(node.name).includes(needle)) return true;
  return (node.children || []).some(c => nodeMatches(c, needle));
}

/** node ve tüm alt ağacına aynı seçim değerini basar (kaskad). */
function setAll(node, value) {
  node._checked = value;
  (node.children || []).forEach(c => setAll(c, value));
}

/**
 * Tri-state seçim ağacını tek geçişte tutarlı hâle getirir. `clickedNode` verilirse o
 * düğüm ve tüm alt ağacına `clickedValue` kaskad edilir; her durumda üst düğümler
 * çocuklarının durumuna göre true/false/'partial' olarak yeniden hesaplanır. Toplu
 * "görünenleri seç/kaldır" gibi çoklu-değişiklik sonrası `clickedNode` olarak var
 * olmayan bir değer (ör. null) vermek saf bir "aşağıdan yukarı" yeniden hesap yapar.
 */
function rollup(node, clickedNode, clickedValue) {
  if (node === clickedNode) {
    setAll(node, clickedValue);
    return clickedValue;
  }
  if (!node.children || !node.children.length) {
    return node._checked === true;
  }
  const states = node.children.map(c => rollup(c, clickedNode, clickedValue));
  const allTrue = states.every(s => s === true);
  const allFalse = states.every(s => s === false);
  node._checked = allTrue ? true : (allFalse ? false : 'partial');
  return node._checked;
}

function initSelection(node) {
  node._checked = true;
  (node.children || []).forEach(initSelection);
}

/** Seçili olmayan (false) düğümleri ve onların tüm alt ağacını budar; kalanları yeni bir ağaç olarak döner. */
function pruneBySelection(node) {
  if (node._checked === false) return null;
  const children = (node.children || []).map(pruneBySelection).filter(Boolean);
  return { ...node, children };
}

function renderPreviewTree(node, container, depth, needle, onToggle, forceShow) {
  if (!forceShow && !nodeMatches(node, needle)) return;
  const row = document.createElement('div');
  row.className = 'sitemap-preview-row';
  row.style.paddingLeft = (depth * 16) + 'px';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sitemap-preview-check';
  checkbox.checked = node._checked === true;
  checkbox.indeterminate = node._checked === 'partial';
  checkbox.onchange = () => onToggle(node, checkbox.checked);
  row.appendChild(checkbox);

  const name = document.createElement('span');
  name.textContent = node.name;
  row.appendChild(name);
  const badge = document.createElement('span');
  badge.className = 'sitemap-preview-type';
  badge.textContent = node.type;
  row.appendChild(badge);
  container.appendChild(row);
  // Düğümün kendi ADI eşleşiyorsa altındaki her şey süzülmeden gösterilir — arama
  // "Playwright Test Report"ı bulduğunda o sayfanın alt başlıkları da görünsün diye.
  const selfMatch = !needle || trNormalize(node.name).includes(needle);
  const childForce = forceShow || selfMatch;
  (node.children || []).forEach(c => renderPreviewTree(c, container, depth + 1, needle, onToggle, childForce));
}

/** Bir sayfanın kaynak URL'sini host+path'e indirger — takma protokol/trailing-slash farkları eşleşmeyi kaçırmasın diye. */
function normalizeForCompare(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return (u.host + path).toLowerCase();
  } catch { return null; }
}

/** Mevcut ağaçtaki her düğümün kaynak URL'sini (varsa) normalize edilmiş hâliyle indeksler. */
function collectExistingUrlMap() {
  const map = new Map();
  (function walk(nodes) {
    (nodes || []).forEach(n => {
      (n.resourceLinks || []).forEach(rl => {
        const norm = normalizeForCompare(rl.url);
        if (norm && !map.has(norm)) map.set(norm, n);
      });
      walk(n.children);
    });
  })(state.tree);
  return map;
}

/** Yeni taranan ağaçtaki PAGE düğümlerinden hangilerinin ağaçta zaten bir karşılığı var — URL eşleşmesiyle. */
function findConflicts(prunedTree, existingMap) {
  const conflicts = [];
  (function walk(n) {
    if (n.type === 'page') {
      const srcLink = (n.resourceLinks || [])[0];
      const norm = srcLink ? normalizeForCompare(srcLink.url) : null;
      const existing = norm ? existingMap.get(norm) : null;
      if (existing) conflicts.push({ incoming: n, existing });
    }
    (n.children || []).forEach(walk);
  })(prunedTree);
  return conflicts;
}

/**
 * @param {{url?: string, autoStart?: boolean}} [opts]
 *   `url`       — kutuyu bu adresle dolu aç (landing'deki "URL'i gir, başla" kutusu).
 *   `autoStart` — formu göstermeden varsayılanlarla (derinlik 2, 15 sayfa, girişsiz,
 *                 etkileşimsiz, robots'a uyar) taramayı HEMEN başlat. Yalnızca http/https
 *                 adres kabul edilir; başka her şey düz forma düşer.
 */
export function openSitemapImportModal(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const startUrl = safeHttpUrl(o.url);
  const autoStart = Boolean(startUrl) && o.autoStart !== false;
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'sitemap-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const modal = document.createElement('div');
  modal.className = 'sitemap-modal';
  overlay.appendChild(modal);

  function setCinema(on) {
    modal.classList.toggle('sitemap-modal--cinema', on);
    overlay.classList.toggle('sitemap-overlay--cinema', on);
    let video = overlay.querySelector('.sitemap-cinema-video');
    let loader = modal.querySelector('.sitemap-cinema-loader');
    if (on && !video && !REDUCED_MOTION) {
      video = document.createElement('video');
      video.className = 'sitemap-cinema-video';
      // Öznitelikler src'den ÖNCE: tarayıcı sessiz-otomatik oynatma kararını yüklemeye başlarken verir.
      video.muted = true; video.defaultMuted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
      video.setAttribute('muted', ''); video.setAttribute('autoplay', ''); video.setAttribute('loop', ''); video.setAttribute('playsinline', '');
      video.preload = 'auto';
      // Durdurulursa (sekme arka plana düştü, enerji tasarrufu) geri dönüşte tekrar oynat.
      const oynat = () => video.play().catch(() => { /* engellenirse sessizce degrade */ });
      video.addEventListener('loadeddata', oynat);
      video.addEventListener('pause', () => { if (video.isConnected && modal.classList.contains('sitemap-modal--cinema')) oynat(); });
      // Yedek MP4: HLS (akış, hls.js ya da MSE) herhangi bir noktada çökerse tek sefer buraya düşülür.
      let mp4Denendi = false;
      const mp4eDus = () => {
        if (mp4Denendi || !video.isConnected) return;
        mp4Denendi = true;
        if (video._hls) { try { video._hls.destroy(); } catch { /* yoksay */ } video._hls = null; }
        video.removeAttribute('src'); video.load();
        video.src = BG_VIDEO_MP4;
        oynat();
      };
      video.addEventListener('error', () => { if (mp4Denendi) video.remove(); else mp4eDus(); }); // MP4 de yoksa zemin degrade kalır
      overlay.insertBefore(video, overlay.firstChild); // tam ekran, modalın arkasında
      // Yerel HLS yalnızca MSE olmayan tarayıcıda (iOS Safari). Masaüstü Chrome canPlayType'a
      // "maybe" der ama akışı oynatamaz; o yüzden MSE varsa daima hls.js önce.
      const yerelHls = () => {
        if (!video.canPlayType('application/vnd.apple.mpegurl')) return mp4eDus();
        video.src = BG_VIDEO_HLS;
        oynat();
      };
      const mseVar = 'MediaSource' in window || 'ManagedMediaSource' in window;
      if (!mseVar) {
        yerelHls();
      } else {
        loadHlsJs().then((Hls) => {
          if (!video.isConnected || video._hls || mp4Denendi) return; // bu arada sinema kapandı / yedeğe geçildi
          if (!Hls.isSupported()) return yerelHls();
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30, capLevelToPlayerSize: true });
          video._hls = hls;
          hls.on(Hls.Events.ERROR, (_evt, data) => { if (data && data.fatal) mp4eDus(); });
          hls.on(Hls.Events.MANIFEST_PARSED, oynat);
          hls.loadSource(BG_VIDEO_HLS);
          hls.attachMedia(video);
        }).catch(yerelHls); // hls.js (CDN) gelmezse yerel HLS, o da yoksa MP4
      }
    } else if (!on && video) {
      video.pause();
      if (video._hls) { try { video._hls.destroy(); } catch { /* yoksay */ } video._hls = null; }
      video.remove();
    }
    // Renk dalgası: videonun üstünde süzülen iki bulanık renk lekesi (screen karışımı).
    // Klipte küre neredeyse sabit; hareket hissini bu katman veriyor.
    let glow = overlay.querySelector('.sitemap-cinema-glow');
    if (on && !glow && !REDUCED_MOTION) {
      glow = document.createElement('div');
      glow.className = 'sitemap-cinema-glow';
      glow.setAttribute('aria-hidden', 'true');
      glow.innerHTML = '<span class="blob blob-a"></span><span class="blob blob-b"></span><span class="blob blob-c"></span>';
      overlay.insertBefore(glow, modal);
    } else if (!on && glow) {
      glow.remove();
    }
    // Kürenin ortasındaki yükleyici: dönen ışık halkası + nabız halesi.
    if (on && !loader) {
      loader = document.createElement('div');
      loader.className = 'sitemap-cinema-loader';
      loader.setAttribute('aria-hidden', 'true');
      loader.innerHTML = '<span class="ring ring-a"></span><span class="ring ring-b"></span><span class="core"></span>';
      modal.insertBefore(loader, body);
    } else if (!on && loader) {
      loader.remove();
    }
  }

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

  function renderForm(prefill) {
    const p = prefill || {};
    setCinema(false);
    body.innerHTML = '';
    loginContinueRequested = false;

    const hint = document.createElement('div');
    hint.className = 'drawer-hint';
    hint.textContent = 'Verilen URL ve aynı site içindeki bağlantılar taranır (JS ile render edilen sitelerde de çalışır); '
      + 'her sayfadaki başlık yapısından (h1/h2/h3) otomatik bir modül/sayfa/bölüm ağacı çıkarılır.';
    body.appendChild(hint);

    if (p.note) {
      const prefillNote = document.createElement('div');
      prefillNote.className = 'sitemap-prefill-note';
      prefillNote.textContent = p.note;
      body.appendChild(prefillNote);
    }

    const urlField = document.createElement('input');
    urlField.className = 'drawer-input sitemap-url-input';
    urlField.placeholder = 'https://example.com';
    urlField.type = 'url';
    const urlValue = p.url || startUrl;
    if (urlValue) urlField.value = urlValue;
    body.appendChild(urlField);

    const row = document.createElement('div');
    row.className = 'sitemap-field-row';

    const depthWrap = document.createElement('label');
    depthWrap.className = 'sitemap-field';
    const depthLabel = document.createElement('span');
    depthLabel.textContent = 'Derinlik';
    depthWrap.appendChild(depthLabel);
    const depthInput = document.createElement('input');
    depthInput.type = 'number'; depthInput.min = '0'; depthInput.max = '4'; depthInput.value = String(p.maxDepth ?? 2);
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
    pagesInput.type = 'number'; pagesInput.min = '1'; pagesInput.max = '60'; pagesInput.value = String(p.maxPages ?? 15);
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
    loginCheckbox.checked = !!p.requireLogin;
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
    interactCheckbox.checked = !!p.interactWithUI;
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

    /**
     * Oturum kasası bilgisi. Kullanıcının en sık düştüğü tuzak buydu: korumalı
     * bir siteyi oturumsuz tarayınca her sayfa giriş/kapı ekranı döner, hata
     * verilmez ve ağaç sessizce çöp olur. Artık taramadan ÖNCE söylüyoruz.
     */
    const sessionHint = document.createElement('div');
    sessionHint.className = 'sitemap-field-hint';
    sessionHint.textContent = '';
    body.appendChild(sessionHint);

    let sessionTimer = null;
    const oturumKontrol = () => {
      const val = urlField.value.trim();
      if (!/^https?:\/\//.test(val)) { sessionHint.textContent = ''; return; }
      fetch('/api/session/for?url=' + encodeURIComponent(val))
        .then(r => r.json())
        .then(d => {
          sessionHint.textContent = d.found
            ? `✓ Bu adres için kayıtlı oturum var (${d.source}${d.hoursLeft === null ? '' : `, ~${d.hoursLeft} saat`}) — giriş gerekmez.`
            : 'Bu adres için kayıtlı oturum yok. Site giriş istiyorsa aşağıdaki kutuyu işaretle; oturum bir kez açılıp kaydedilir.';
        })
        .catch(() => { sessionHint.textContent = ''; });
    };
    urlField.addEventListener('input', () => {
      clearTimeout(sessionTimer);
      sessionTimer = setTimeout(oturumKontrol, 500);
    });

    const robotsWrap = document.createElement('label');
    robotsWrap.className = 'sitemap-checkbox-row';
    const robotsCheckbox = document.createElement('input');
    robotsCheckbox.type = 'checkbox';
    robotsCheckbox.checked = !!p.ignoreRobots;
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
    setCinema(true);
    body.innerHTML = '';
    const spin = document.createElement('div');
    spin.className = 'sitemap-spinner';
    spin.innerHTML = '<i class="dot"></i><span>Taranıyor</span>';
    body.appendChild(spin);
    const status = document.createElement('div');
    status.className = 'sitemap-progress-text';
    status.textContent = job.visited + ' / ' + job.total + ' sayfa tarandı';
    body.appendChild(status);
    const current = document.createElement('div');
    current.className = 'sitemap-progress-url';
    current.textContent = job.currentUrl || '';
    body.appendChild(current);
    if (autoStart) {
      const not = document.createElement('div');
      not.className = 'sitemap-field-hint';
      not.textContent = 'Varsayılan ayarlarla başlatıldı (derinlik 2, en fazla 15 sayfa, girişsiz). '
        + 'Site giriş istiyorsa veya sonuç boş gelirse: İptal → "URL’den İçe Aktar" ile seçenekleri aç.';
      body.appendChild(not);
    }

    if (job.session || job.sessionSaved) {
      const oturum = document.createElement('div');
      oturum.className = 'sitemap-field-hint';
      oturum.textContent = (job.sessionSaved ? 'Oturum kaydedildi · ' : '')
        + (job.session ? `oturum: ${job.session.source}${job.session.hoursLeft === null ? '' : ` (~${job.session.hoursLeft} saat)`}` : '');
      body.appendChild(oturum);
    }

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
    setCinema(true);
    body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'sitemap-login-msg';
    msg.innerHTML = 'Bilgisayarında az önce yeni bir tarayıcı penceresi açıldı. <strong>O pencerede</strong> siteye normal '
      + 'şekilde giriş yap (e-posta + şifre veya e-posta + kod, site ne istiyorsa). Giriş bilgilerini asla bu uygulamaya '
      + 'girme — yalnızca açılan gerçek tarayıcı penceresinde, doğrudan sitenin kendi giriş ekranına gir. Giriş bitince '
      + 'aşağıdaki butona tıkla.';
    body.appendChild(msg);

    const kasaNot = document.createElement('div');
    kasaNot.className = 'sitemap-field-hint';
    kasaNot.textContent = 'Oturum bu adres için kaydedilecek; sonraki taramalarda ve testlerde yeniden giriş istenmeyecek. '
      + 'Şifren kaydedilmez — yalnızca sitenin verdiği oturum çerezleri saklanır.';
    body.appendChild(kasaNot);

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
    setCinema(false);
    body.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'sitemap-error';
    err.textContent = message;
    body.appendChild(err);
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-primary';
    retryBtn.textContent = 'Tekrar Dene';
    retryBtn.onclick = () => renderForm();
    body.appendChild(retryBtn);
  }

  /** Atlanan sayfa / sınır bilgisini özetler; hiçbiri yoksa null döner (satır hiç açılmaz). */
  function buildSkipSummary(job) {
    const skipped = job.skipped || [];
    const templateCapped = job.templateCapped || 0;
    const navErrors = skipped.filter(s => s.reason === 'nav_error').length;
    const robotsBlocked = skipped.filter(s => s.reason === 'robots').length;
    if (!navErrors && !robotsBlocked && !templateCapped) return null;

    const wrap = document.createElement('div');
    wrap.className = 'sitemap-skip-summary';
    const parts = [];
    if (navErrors) parts.push(`${navErrors} sayfa yüklenemediği için atlandı`);
    if (robotsBlocked) parts.push(`${robotsBlocked} sayfa robots.txt tarafından engellendi`);
    if (templateCapped) parts.push(`${templateCapped} benzer görünümlü link örnekleme sınırından atlandı`);
    const line = document.createElement('div');
    line.textContent = parts.join(' · ');
    wrap.appendChild(line);

    if (skipped.length) {
      const details = document.createElement('details');
      details.className = 'sitemap-skip-details';
      const summaryEl = document.createElement('summary');
      summaryEl.textContent = 'Atlanan adresleri göster';
      details.appendChild(summaryEl);
      skipped.forEach(s => {
        const row = document.createElement('div');
        row.className = 'sitemap-skip-row';
        row.textContent = (s.reason === 'robots' ? 'robots.txt: ' : 'yüklenemedi: ') + s.url;
        details.appendChild(row);
      });
      wrap.appendChild(details);
    }
    return wrap;
  }

  /**
   * "Daha Detaylı Tara" notunu ve önerilen derinlik/sayfa değerlerini hesaplar.
   * Kör bir "her zaman +1/+15" yerine crawler'ın bıraktığı iz sürülür:
   * kuyrukta sayfa sınırından bekleyen link mi vardı (sayfayı artırmak işe yarar),
   * derinlik sınırına tam denk gelip linkleri hiç incelenmemiş sayfa mı vardı
   * (derinliği artırmak işe yarar), yoksa site zaten sonuna kadar mı tarandı
   * (ikisi de işe yaramaz, giriş/etkileşim önerilir).
   */
  function buildMoreDetailPlan(job, count) {
    const prevDepth = lastParams.maxDepth;
    const prevPages = lastParams.maxPages;
    const queueRemaining = job.queueRemaining || 0;
    const depthCapped = job.depthCapped || 0;
    const atMaxDials = prevDepth >= 4 && prevPages >= 60;

    let nextDepth = prevDepth;
    let nextPages = prevPages;
    let note;

    if (atMaxDials) {
      note = `Önceki tarama ${count} öğe buldu ve zaten en yüksek derinlik/sayfa sınırındaydı (derinlik 4, 60 sayfa). `
        + 'Farklı sonuç istiyorsan giriş ya da etkileşim seçeneklerini dene.';
    } else if (!queueRemaining && !depthCapped) {
      note = `Önceki tarama ${count} öğe buldu ve bu adresten ulaşılabilecek her şeyi, sınıra hiç takılmadan buldu — `
        + 'derinlik/sayfayı artırmak muhtemelen yeni bir şey getirmez. Farklı sonuç istiyorsan giriş yaparak ya da '
        + 'etkileşimli taramayı açarak dene.';
    } else if (queueRemaining && !depthCapped) {
      nextPages = Math.min(60, prevPages + 15);
      note = `Önceki tarama ${count} öğe buldu; sırada henüz taranmamış en az ${queueRemaining} sayfa vardı, sayfa `
        + `sınırına takıldın. Derinlik yeterliydi, sadece en fazla sayfayı ${nextPages}'e çıkarıyorum.`;
    } else if (!queueRemaining && depthCapped) {
      nextDepth = Math.min(4, prevDepth + 1);
      note = `Önceki tarama ${count} öğe buldu; ${depthCapped} sayfanın linkleri derinlik sınırı yüzünden hiç `
        + `incelenmedi. Sayfa sınırına takılmadın, sadece derinliği ${nextDepth}'e çıkarıyorum.`;
    } else {
      nextDepth = Math.min(4, prevDepth + 1);
      nextPages = Math.min(60, prevPages + 15);
      note = `Önceki tarama ${count} öğe buldu (derinlik ${prevDepth}, en fazla ${prevPages} sayfa) — hem sayfa hem `
        + `derinlik sınırına takıldın. Derinlik ${nextDepth}, en fazla ${nextPages} sayfa ile tekrar dene — istersen `
        + 'kendin de değiştirebilirsin.';
    }
    return { nextDepth, nextPages, note };
  }

  function finalizeAdd(finalTree, summary) {
    if (finalTree && countNodes(finalTree) > 1) {
      state.tree.push(finalTree);
    }
    persist();
    renderContent();
    closeModal();
    if (summary) uiToast(summary, { type: 'ok' });
  }

  /** Çakışma yoksa direkt ekler; varsa her biri için "Atla / İçeriğini Güncelle / Ayrı Ekle" soran ekrana geçer. */
  function proceedToAdd(prunedTree) {
    const existingMap = collectExistingUrlMap();

    // Kökün KENDİSİ (taramanın başlangıç adresi) ağaçta zaten varsa: kökün doğrudan
    // çıkardığı başlık/tekrar-bloğu çocukları gerçek bir alt SAYFA değil, o adresin
    // kendi içeriğidir — her yeniden taramada aynen yeniden üretilip çoğalmasın diye
    // burada elenir. Gerçek alt sayfalar (type: 'page') normal çakışma akışına girmeye devam eder.
    const rootLink = (prunedTree.resourceLinks || [])[0];
    const rootNorm = rootLink ? normalizeForCompare(rootLink.url) : null;
    const rootConflict = rootNorm ? existingMap.get(rootNorm) : null;
    const tree = rootConflict
      ? { ...prunedTree, children: prunedTree.children.filter(c => c.type === 'page') }
      : prunedTree;

    const conflicts = findConflicts(tree, existingMap);
    if (!conflicts.length) {
      const pageCount = countPages(tree);
      if (!pageCount && rootConflict) {
        closeModal();
        uiToast('Bu adresteki içerik ağaçta zaten vardı, yeni bir şey eklenmedi.', { type: 'info' });
        return;
      }
      finalizeAdd(tree, `${pageCount} sayfa ağaca eklendi.`);
      return;
    }
    renderConflicts(tree, conflicts);
  }

  function renderConflicts(prunedTree, conflicts) {
    setCinema(false);
    body.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'sitemap-summary';
    summary.textContent = `${conflicts.length} sayfa ağaçta zaten var (aynı adres). Her biri için ne yapalım?`;
    body.appendChild(summary);

    const OPTIONS = [
      ['skip', 'Atla (ekleme)'],
      ['update', 'İçeriğini Güncelle'],
      ['add', 'Ayrı Ekle']
    ];
    const resolutions = new Map();

    const bulkRow = document.createElement('div');
    bulkRow.className = 'sitemap-conflict-bulk';
    const bulkLabel = document.createElement('span');
    bulkLabel.textContent = 'Hepsi için:';
    bulkRow.appendChild(bulkLabel);
    const bulkSelect = document.createElement('select');
    bulkSelect.className = 'drawer-input';
    OPTIONS.forEach(([v, l]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      bulkSelect.appendChild(opt);
    });
    bulkRow.appendChild(bulkSelect);
    const bulkApplyBtn = document.createElement('button');
    bulkApplyBtn.type = 'button';
    bulkApplyBtn.className = 'btn';
    bulkApplyBtn.textContent = 'Uygula';
    bulkRow.appendChild(bulkApplyBtn);
    body.appendChild(bulkRow);

    const list = document.createElement('div');
    list.className = 'sitemap-conflict-list';
    body.appendChild(list);

    const rowSelects = [];
    conflicts.forEach(({ incoming, existing }) => {
      resolutions.set(incoming, 'skip'); // güvenli varsayılan: mevcut (belki zaten doğrulanmış) düğüme dokunma
      const row = document.createElement('div');
      row.className = 'sitemap-conflict-row';
      const label = document.createElement('div');
      label.className = 'sitemap-conflict-label';
      label.textContent = incoming.name;
      const sub = document.createElement('div');
      sub.className = 'sitemap-field-hint';
      sub.textContent = 'Ağaçta zaten var: ' + (existing.name || existing.id);
      label.appendChild(sub);
      row.appendChild(label);
      const select = document.createElement('select');
      select.className = 'drawer-input';
      OPTIONS.forEach(([v, l]) => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = l;
        select.appendChild(opt);
      });
      select.value = 'skip';
      select.onchange = () => resolutions.set(incoming, select.value);
      row.appendChild(select);
      list.appendChild(row);
      rowSelects.push(select);
    });

    bulkApplyBtn.onclick = () => {
      const v = bulkSelect.value;
      rowSelects.forEach(s => { s.value = v; });
      conflicts.forEach(c => resolutions.set(c.incoming, v));
    };

    const actions = document.createElement('div');
    actions.className = 'jira-prompt-actions';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn';
    backBtn.textContent = 'Vazgeç';
    backBtn.onclick = closeModal;
    actions.appendChild(backBtn);
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = 'Devam Et';
    applyBtn.onclick = () => {
      const skip = new Set();
      let updatedCount = 0, addedCount = 0;
      conflicts.forEach(({ incoming, existing }) => {
        const action = resolutions.get(incoming);
        if (action === 'skip') {
          skip.add(incoming);
        } else if (action === 'update') {
          existing.children = incoming.children; // id'ler zaten assignIds ile basıldı
          skip.add(incoming); // ayrıca yeni düğüm olarak eklenmesin
          updatedCount++;
        } else {
          addedCount++;
        }
      });
      function prune(node) {
        if (skip.has(node)) return null;
        const children = (node.children || []).map(prune).filter(Boolean);
        return { ...node, children };
      }
      const finalTree = prune(prunedTree);
      const notConflicting = countPages(prunedTree) - conflicts.length;
      addedCount += notConflicting;
      const parts = [];
      if (addedCount) parts.push(`${addedCount} sayfa eklendi`);
      if (updatedCount) parts.push(`${updatedCount} sayfanın içeriği güncellendi`);
      const skipCount = Array.from(resolutions.values()).filter(v => v === 'skip').length;
      if (skipCount) parts.push(`${skipCount} sayfa atlandı`);
      finalizeAdd(finalTree, parts.join(' · ') || 'Değişiklik yapılmadı.');
    };
    actions.appendChild(applyBtn);
    body.appendChild(actions);
  }

  function renderResult(job) {
    setCinema(false);
    body.innerHTML = '';
    const tree = job.tree;
    initSelection(tree);

    const count = countNodes(tree);
    const summary = document.createElement('div');
    summary.className = 'sitemap-summary';
    summary.textContent = count + ' öğe bulundu. Ağaca eklemek istediklerini seç.';
    body.appendChild(summary);

    const skipInfo = buildSkipSummary(job);
    if (skipInfo) body.appendChild(skipInfo);

    const toolsRow = document.createElement('div');
    toolsRow.className = 'sitemap-preview-tools';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'drawer-input sitemap-preview-search';
    searchInput.placeholder = 'Sayfa adında ara…';
    toolsRow.appendChild(searchInput);
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'btn';
    selectAllBtn.textContent = 'Görünenleri Seç';
    toolsRow.appendChild(selectAllBtn);
    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.type = 'button';
    deselectAllBtn.className = 'btn';
    deselectAllBtn.textContent = 'Görünenleri Kaldır';
    toolsRow.appendChild(deselectAllBtn);
    body.appendChild(toolsRow);

    const preview = document.createElement('div');
    preview.className = 'sitemap-preview';
    body.appendChild(preview);

    const selectedCountEl = document.createElement('div');
    selectedCountEl.className = 'sitemap-field-hint sitemap-selected-count';
    body.appendChild(selectedCountEl);

    const totalPages = countPages(tree);
    let addBtn; // actions bölümünde atanır, repaint() içinde kullanılır

    function countSelectedPages(node) {
      let n = 0;
      (function walk(x) {
        if (x.type === 'page' && x._checked !== false) n++;
        (x.children || []).forEach(walk);
      })(node);
      return n;
    }

    function repaint() {
      preview.innerHTML = '';
      const needle = trNormalize(searchInput.value.trim());
      renderPreviewTree(tree, preview, 0, needle, onToggle);
      if (!preview.children.length) {
        const empty = document.createElement('div');
        empty.className = 'sitemap-preview-empty';
        empty.textContent = 'Eşleşme yok.';
        preview.appendChild(empty);
      }
      const sel = countSelectedPages(tree);
      selectedCountEl.textContent = totalPages ? `${sel} / ${totalPages} sayfa seçili` : '';
      if (addBtn) addBtn.disabled = sel === 0;
    }

    function onToggle(node, value) {
      rollup(tree, node, value);
      repaint();
    }

    searchInput.addEventListener('input', repaint);
    selectAllBtn.onclick = () => {
      const needle = trNormalize(searchInput.value.trim());
      (tree.children || []).forEach(top => { if (nodeMatches(top, needle)) setAll(top, true); });
      rollup(tree, null, null);
      repaint();
    };
    deselectAllBtn.onclick = () => {
      const needle = trNormalize(searchInput.value.trim());
      (tree.children || []).forEach(top => { if (nodeMatches(top, needle)) setAll(top, false); });
      rollup(tree, null, null);
      repaint();
    };

    const plan = buildMoreDetailPlan(job, count);
    const moreWrap = document.createElement('div');
    moreWrap.className = 'sitemap-more-detail';
    const moreQ = document.createElement('span');
    moreQ.className = 'sitemap-more-detail-q';
    moreQ.textContent = 'Bu sonucu beğenmedin mi?';
    moreWrap.appendChild(moreQ);
    const moreLink = document.createElement('button');
    moreLink.type = 'button';
    moreLink.className = 'sitemap-more-detail-link';
    moreLink.textContent = 'Daha Detaylı Tara →';
    moreLink.onclick = () => {
      renderForm({
        url: lastParams.url,
        maxDepth: plan.nextDepth,
        maxPages: plan.nextPages,
        requireLogin: lastParams.requireLogin,
        interactWithUI: lastParams.interactWithUI,
        ignoreRobots: lastParams.ignoreRobots,
        note: plan.note
      });
    };
    moreWrap.appendChild(moreLink);
    body.appendChild(moreWrap);

    const actions = document.createElement('div');
    actions.className = 'jira-prompt-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Vazgeç';
    cancelBtn.onclick = closeModal;
    actions.appendChild(cancelBtn);
    addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Ağaca Ekle';
    addBtn.onclick = () => {
      const pruned = pruneBySelection(tree);
      if (!pruned) return; // buton zaten disabled olmalı, ek güvenlik
      assignIds(pruned);
      proceedToAdd(pruned);
    };
    actions.appendChild(addBtn);
    body.appendChild(actions);

    repaint();
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
          renderResult(job);
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
    lastParams = {
      url,
      maxDepth: Number(maxDepth),
      maxPages: Number(maxPages),
      requireLogin: !!requireLogin,
      interactWithUI: !!interactWithUI,
      ignoreRobots: !!ignoreRobots
    };
    setCinema(true);
    body.innerHTML = '';
    loginContinueRequested = false;
    const spin = document.createElement('div');
    spin.className = 'sitemap-spinner';
    spin.innerHTML = '<i class="dot"></i><span>Tarayıcı açılıyor…</span>';
    body.appendChild(spin);
    const hedef = document.createElement('div');
    hedef.className = 'sitemap-progress-text';
    hedef.textContent = 'Tarama başlıyor';
    body.appendChild(hedef);
    const adres = document.createElement('div');
    adres.className = 'sitemap-progress-url';
    adres.textContent = url;
    body.appendChild(adres);

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

  if (autoStart) {
    // Form atlanır; hata olursa renderError → "Tekrar Dene" dolu forma döner.
    startCrawl(startUrl, 2, 15, false, false, false);
  } else {
    renderForm();
  }
  state.root.appendChild(overlay);
}
