/**
 * BAĞLANTILAR (connectors) AÇILIR PANELİ — üst bardaki `connectors` düğmesinin
 * içeriği ve davranışı. Panel (/) ve Kapsam ekranı (/scope) AYNI dosyayı yükler.
 *
 * `index.html`'den ayrıldı (2026-09-12): Kapsam ekranında da bağlantı durumu
 * ve kurtarma yolları görünsün istendi; kopya yerine tek kaynak. Klasik script,
 * ESM DEĞİL — kartlardaki `onclick="cxCut(...)"` çağrıları ada bakıyor, o yüzden
 * gerekli fonksiyonlar en altta window'a açılıyor.
 *
 * Bağımlılıklar (ikisi de isteğe bağlı, yoksa yumuşak düşüş):
 *   /js/dialogs.js  → uiToast / uiConfirm (yoksa console + window.confirm)
 *   panelin kendi globalleri → post (403/eski-süreç mesajı), AI_STATUS,
 *     loadAiStatus, refreshGate (Kapsam ekranında yok; kapı yenileme yalnız Panel'de)
 * Markup nav.js'ten gelir: `#cxWrap > #cxBtn + #cxPanel`. Düğme yoksa (yüzey
 * kapalıysa) bu dosya hiçbir istek atmaz.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PANEL_TOKEN = document.querySelector('meta[name=panel-token]')?.content || window.PANEL_TOKEN || '';

  /** Panelin kendi post()'u varsa onu kullan (403 / "Bilinmeyen uc" açıklamaları orada). */
  async function post(url, body) {
    if (typeof window.post === 'function') return window.post(url, body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-panel-token': PANEL_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json().catch(() => ({ ok: false, error: 'yanit okunamadi' }));
  }
  const uiToast = (m, o) => (typeof window.uiToast === 'function' ? window.uiToast(m, o) : console.warn('[connectors]', m));
  const uiConfirm = (m, o) => (typeof window.uiConfirm === 'function' ? window.uiConfirm(m, o) : Promise.resolve(window.confirm(m)));
  // `let AI_STATUS` klasik script'te window'a yazılmaz; sözcüksel global olarak
  // typeof ile yoklanır. Çağrı anında (yükleme değil) bakıldığı için TDZ yok.
  const aiStatus = () => { try { return typeof AI_STATUS !== 'undefined' ? AI_STATUS : null; } catch { return null; } };
  const loadAiStatus = async () => { if (typeof window.loadAiStatus === 'function') await window.loadAiStatus(); };
  const refreshGate = () => {
    if (typeof window.refreshGate === 'function') return window.refreshGate();
    uiToast('Kapı yenileme yalnızca Panel ekranından yapılır: Panel → connectors → Kapıyı yenile', { type: 'warn' });
  };
  /** Kapsam ekranındaysak hash değişimi tek başına modalı açmaz (açıcı yüklemede çalışır) — yenile. */
  const gotoScopeImport = () => {
    if (location.pathname.replace(/\/$/, '').endsWith('/scope')) { location.hash = 'import'; location.reload(); }
    else location.href = '/scope#import';
  };

  const PF_ICON = {
    slack: '<svg class="pf-ico" viewBox="0 0 122.8 122.8" aria-hidden="true">'
      + '<path fill="#e01e5a" d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9zM32.3 77.6a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z"/>'
      + '<path fill="#36c5f0" d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9zM45.2 32.3a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z"/>'
      + '<path fill="#2eb67d" d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97zM90.5 45.2a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z"/>'
      + '<path fill="#ecb22e" d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97zM77.6 90.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z"/>'
      + '</svg>',
    linear: '<svg class="pf-ico" viewBox="0 0 100 100" aria-hidden="true">'
      + '<rect width="100" height="100" rx="22" fill="#5e6ad2"/>'
      + '<g fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round">'
      + '<path d="M22 48A26 26 0 0 0 48 22"/><path d="M22 66A44 44 0 0 0 66 22"/>'
      + '<path d="M28 79A56 56 0 0 0 79 28"/></g>'
      + '</svg>',
    figma: '<svg class="pf-ico" viewBox="0 0 38 57" aria-hidden="true">'
      + '<path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"/>'
      + '<path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z"/>'
      + '<path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 0 0 0-19H19z"/>'
      + '<path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/>'
      + '<path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/>'
      + '</svg>',
    jira: '<svg class="pf-ico" viewBox="0 0 32 32" aria-hidden="true">'
      + '<path fill="#2684ff" d="M30.7 15.2 17.2 1.7 15.9.4 5.7 10.6 1 15.2a1.1 1.1 0 0 0 0 1.6l9.4 9.4'
      + ' 5.5 5.5 10.2-10.2.2-.2 4.4-4.4a1.1 1.1 0 0 0 0-1.7zM15.9 21.4 11.2 16l4.7-4.7 4.7 4.7z"/>'
      + '<path fill="#0052cc" d="M15.9 11.3a7.9 7.9 0 0 1 0-11.1L5.7 10.4l5.5 5.5z"/>'
      + '<path fill="#0052cc" d="M20.6 15.9 15.9 20.6a7.9 7.9 0 0 1 0 11.2l10.2-10.2z"/>'
      + '</svg>',
  };

  /**
   * BAGLANTILAR PANELI
   *
   * Pill'ler durumu soyluyor ama "neden" ve "nasil duzeltilir" hicbir yerde
   * yoktu: kimlik hangi dosyada, kota ne zaman aciliyor, kapali ise ne yapmali.
   * Anthropic'in cozumu ornegin yalnizca Senaryo oner kutusundaki uyari metninde
   * duruyordu — baglanti kapaliysa cozum durumun YANINDA olmali.
   *
   * Ust bardaki `connectors` dugmesinden acilan dropdown. Eskiden ayrica bir
   * ONKOSULLAR seridi vardi; ayni bilgiyi iki yerde gostermek gereksizdi, serit
   * kaldirildi. Veri `/api/preflight`ten geliyor, panel acmak EK ISTEK YAPMAZ.
   */
  let PF_LAST = null;

  const PF_WORD = {
    ok: 'bağlandı', warn: 'sorunlu', blocked: 'bloke', off: 'kapalı', unknown: 'bilinmiyor',
  };

  /**
   * "kimlik" satirinin sonuna token uretme sayfasi linki. Adres connector'in
   * kendisinden gelir (`connectors/<servis>.mjs → setupUrl`), arayuzde SABIT
   * DEGIL — yeni bir servis eklenince burada is yok.
   *
   * NEDEN: satir "LINEAR_API_KEY ortam degiskeni ya da ~/.linear-credentials"
   * diyordu ama anahtarin NEREDEN alindigini soylemiyordu; kullanici oraya
   * tiklayip servise gitmeyi bekliyor (2026-09-02). MobAI gibi yerel
   * connector'larda setupUrl yok, link de cikmaz.
   */
  function cxSetupLink(c) {
    if (!c.setupUrl) return '';
    const u = String(c.setupUrl);
    if (!/^https:\/\//.test(u)) return ''; // yalnizca https
    return ` <a class="cx-setup" href="${esc(u)}" target="_blank" rel="noreferrer noopener"`
      + ` title="${esc(u)}">token al ↗</a>`;
  }

  function pfCard(c) {
    const ico = PF_ICON[c.icon] ?? '';
    const name = String(c.label).replace(/\s+(bağlandı|bloke|sorunlu|yok)$/, '');
    const parts = (c.parts ?? []).map(p =>
      `<div class="cx-row"><span class="cx-k">${esc(p.label)}</span>`
      + `<span class="pf-dot ${esc(p.state)}"></span>`
      + `<span class="cx-v">${esc(p.detail ?? '')}</span></div>`).join('');
    const fix = (c.fix ?? []).length
      ? `<div class="cx-fix"><div class="cx-fix-h">ÇÖZÜM</div>`
        + c.fix.map(f => `<code>${esc(f)}</code>`).join('') + `</div>`
      : '';
    const bp = cxBadgePlan(c);
    const soz = esc(c.cut ? 'koparıldı' : (PF_WORD[c.state] ?? c.state));
    const rozet = bp
      ? `<button type="button" class="pf ${esc(c.state)}"`
        + ` onclick="${bp.kind === 'cut' ? `cxCut('${esc(c.key)}',true)` : `cxRecover('${esc(c.key)}')`}"`
        + ` title="Tıkla: ${esc(bp.label)} — ${esc(bp.hint)}">${soz}`
        + `<span class="cx-sw">${bp.kind === 'cut' ? '⏻' : '↻'}</span></button>`
      : `<span class="pf ${esc(c.state)}">${soz}</span>`;
    return `<div class="cx-card" data-cx="${esc(c.key)}"${c.state === 'ok' ? '' : ' data-bad="1"'}>
      <div class="cx-head">
        <span class="cx-name">${ico}${esc(name)}</span>
        ${rozet}
      </div>
      ${c.parts?.length ? parts : `<div class="cx-row"><span class="cx-v">${esc(c.detail ?? '')}</span></div>`}
      ${c.credential ? `<div class="cx-row"><span class="cx-k">kimlik</span><span class="cx-v mono">${c.credentialSource ? `<b>${esc(c.credentialSourceLabel)}</b> · ` : ''}${esc(c.credential)}${cxSetupLink(c)}</span></div>` : ''}
      ${c.note ? `<div class="cx-note">${esc(c.note)}</div>` : ''}
      ${cxActions(c)}
      ${fix}
    </div>`;
  }

  /**
   * Kartin eylem satiri — "Claude Desktop gibi tek tikla baglan" isteginin
   * karsiligi (2026-09-02).
   *
   * Uc durum var, sirasi onemli:
   *   1. OAuth uygulamasi KAYITLI DEGIL → tek seferlik kurulum kutusu. OAuth'ta
   *      tek tik ancak uygulama saglayicida bir kere kaydedilirse mumkun.
   *   2. Kayitli ama bagli degil → "Bağlan" (tarayici navigasyonu, token ?t= ile).
   *   3. Bagli → "bağlantıyı kes".
   * Ayrica connector bu projede KULLANILMIYORSA (passive) "bu projede kullan"
   * dugmesi cikar: yetenek eslemesini panel-data/connectors.json'a yazar.
   */
  /**
   * KURTARMA YOLU — "koptuysa tiklayinca geri gelsin".
   *
   * NEDEN: kart yalnizca durumu soyluyordu. OAuth'lu servislerde bir "Baglan"
   * dugmesi vardi, ama kapi dolunca / oturum bitince / Jira token'i eskiyince
   * kartta tiklanacak hicbir sey yoktu — cozum metni okunup elle uygulaniyordu
   * (2026-09-03 istegi). Artik her kopuk satirin TEK bir kurtarma eylemi var ve
   * ayni eylem hem rozete hem dugmeye bagli.
   *
   * Dondurdugu `kind` kurtarmanin cinsi:
   *   oauth   → izin ekranina git (token'i kullanici gormez)
   *   setup   → OAuth uygulamasi hic kayitli degil, tek seferlik kutu
   *   gate    → whitelist'li `gate-refresh` kosumu (gatePill ile ayni)
   *   session → Kapsam ekranindaki gorunur giris penceresi
   *   token   → servisin token sayfasi; kimlik dosyasina yazmak insana kalir
   * `null` = otomatiklestirilebilir yol yok (ornegin MobAI: yerel kopru, cozum
   * adimlari zaten kartta).
   */
  function cxRecoverPlan(c) {
    // Elle koparilmis: geri acmak salteri cevirmek, kimlik zaten yerinde.
    if (c.cut) return { kind: 'uncut', label: 'Geri bağla', hint: 'kimlik yerinde duruyor, tek tık' };
    const o = c.oauth;
    if (o?.supported && !o.connected) {
      return o.clientReady
        ? { kind: 'oauth', label: c.state === 'ok' ? 'Bağlan' : 'Yeniden bağlan',
            hint: "izin ekranına gider, token'ı sen görmezsin" }
        : { kind: 'setup', label: 'Bağlan…', hint: 'ilk kez: uygulama kaydı gerekiyor' };
    }
    /*
     * ⚠️ COK HESAPLI SAGLAYICI, `state === 'ok'` KONTROLUNDEN ONCE. Aksi halde
     * ilk hesap eklenip kart "ok" olunca "Hesap ekle" dugmesi kayboluyor ve
     * IKINCI hesap hic eklenemiyordu (olculdu 2026-09-10 — tarayicida kutu hic
     * acilmadi). Hesap eklemek bir kurtarma degil, surekli bir eylem.
     */
    if (c.auth?.accounts) {
      const n = c.auth.accounts.list?.length ?? 0;
      return { kind: 'connect', label: n ? 'Hesap ekle / yönet…' : 'Hesap ekle…',
               hint: n ? `${n} hesap bağlı — yenisini ekle ya da sil` : 'kendi Claude hesabınla bağlan' };
    }
    if (c.state === 'ok') return null;
    if (c.key === 'gate') return { kind: 'gate', label: 'Kapıyı yenile', hint: "~45 sn, whitelist'li koşum" };
    if (c.key === 'sessions') return { kind: 'session', label: 'Oturum aç', hint: 'Kapsam ekranı, görünür pencere' };
    if (c.auth?.apiKey) {
      return { kind: 'connect', label: c.auth.apiKey.connected ? 'Yeniden bağlan' : 'Bağlan…',
               hint: 'kimliği panele gir — kaydedince doğrulanır' };
    }
    return null;
  }

  /**
   * Rozetin ne yapacagi. Baglantili ve anahtari olan satirda rozet KOPARIR —
   * "istedigimde koparabilmem lazim" (2026-09-03). Kopmus satirda kurtarir.
   */
  function cxBadgePlan(c) {
    if (c.state === 'ok' && c.canCut && !c.cut) {
      return { kind: 'cut', label: 'Kopar', hint: 'kimlik silinmez, geri açmak tek tık' };
    }
    return c.state === 'ok' ? null : cxRecoverPlan(c);
  }

  /** Salteri cevir. Hicbir kimlik silinmez — sunucu tarafi da oyle. */
  async function cxCut(key, kes) {
    const d = await post('/api/connectors/cut', { key, cut: kes });
    if (d.error) return uiToast(d.error, { type: 'err', title: kes ? 'Koparılamadı' : 'Bağlanamadı' });
    uiToast(kes ? 'Bağlantı koparıldı — rozete tıklayınca geri gelir' : 'Bağlantı geri geldi',
      { type: kes ? 'warn' : 'ok' });
    loadPreflight(true);
  }

  /** Rozet ve dugme AYNI yeri cagirir; kurtarma mantigi tek kopya. */
  async function cxRecover(key) {
    const c = PF_LAST?.checks.find(x => x.key === key);
    const plan = c && cxRecoverPlan(c);
    if (!plan) return;
    if (plan.kind === 'uncut') return cxCut(key, false);
    if (plan.kind === 'oauth') { location.href = `/api/oauth/${key}/start?t=${encodeURIComponent(PANEL_TOKEN)}`; return; }
    if (plan.kind === 'setup') return cxConnectOpen(key);
    if (plan.kind === 'gate') { pfPanelClose(); return refreshGate(); }
    if (plan.kind === 'session') { gotoScopeImport(); return; }
    if (plan.kind === 'connect') return cxConnectOpen(key);
  }

  /** Token sekmesinden donunce durumu tazele — el ile "yenile"ye basilmasin. */
  let CX_RECHECK = false;
  window.addEventListener('focus', () => {
    if (!CX_RECHECK) return;
    CX_RECHECK = false;
    loadPreflight(!$('#cxPanel').hidden);
  });

  function cxActions(c) {
    const o = c.oauth;
    const parcalar = [];
    const plan = cxRecoverPlan(c);

    if (o?.supported && o.connected && !c.cut) {
      const ne = o.connectedAt ? new Date(o.connectedAt).toLocaleString('tr-TR') : '';
      // İki ayri sey: "kopar" geri alinabilir bir salter, "token'i sil" OAuth
      // kaydini gercekten siler. Etiketler bunu karistirmayacak kadar acik olmali.
      parcalar.push(`<span class="cx-ok">OAuth ile bağlı${ne ? ` · ${esc(ne)}` : ''}</span>`
        + `<button class="cx-btn" onclick="cxCut('${esc(c.key)}',true)">kopar</button>`
        + `<button class="cx-btn" onclick="cxDisconnect('${esc(c.key)}')">token'ı sil</button>`);
    } else if (plan) {
      parcalar.push(`<button class="cx-btn cx-btn-go" onclick="cxRecover('${esc(c.key)}')">${esc(plan.label)}</button>`
        + `<span class="cx-hint">${esc(plan.hint)}</span>`);
    }

    // OAuth'suz ama saglam baglantilarda da kopar dugmesi: rozet tek yol olmasin.
    if (!o?.connected && !c.cut && c.state === 'ok' && c.canCut) {
      parcalar.push(`<button class="cx-btn" onclick="cxCut('${esc(c.key)}',true)">kopar</button>`
        + `<span class="cx-hint">kimlik silinmez, geri açmak tek tık</span>`);
    }

    if (c.passive && c.capabilities?.length) {
      parcalar.push(`<button class="cx-btn" onclick="cxUse('${esc(c.key)}','${esc(c.capabilities[0])}')">`
        + `bu projede kullan</button>`);
    }

    if (c.auth?.apiKey?.source === 'store' && !c.cut) {
      parcalar.push(`<button class="cx-btn" onclick="cxCredRemove('${esc(c.key)}')">kimliği sil</button>`
        + `<span class="cx-hint">panel kaydı silinir; ortam değişkeni ya da dosya varsa kalır</span>`);
    }
    if (!parcalar.length && !c.auth?.apiKey) return '';
    return `<div class="cx-act">${parcalar.join('')}</div>`
      + (c.auth?.apiKey || o?.supported ? `<div class="cx-setup-box" id="cxSetup-${esc(c.key)}" hidden></div>` : '');
  }

  /**
   * BAGLANTI KUTUSU — saglayici ne sunuyorsa onu gosterir (Faz 1, 2026-09-08):
   *   OAuth destekliyorsa: izin ekranina git (uygulama kaydi yoksa tek seferlik kurulum)
   *   API anahtari aliyorsa: alanlar sunucudan (auth.apiKey.vars), "kaydet ve dogrula"
   * Iki yol ayni kutuda; kimlik sunucuda panel-data/credentials/<svc>.json (0600).
   * Eskiden Jira/Figma icin dugme yalnizca token sayfasini yeni sekmede aciyordu
   * ve kimligi dosyaya yazmak insana kaliyordu — sunucuda imkansizdi.
   */
  function cxConnectOpen(key) {
    const c = PF_LAST?.checks.find(x => x.key === key);
    const box = document.getElementById(`cxSetup-${key}`);
    if (!c || !box) return;
    const ak = c.auth?.apiKey;
    const o = c.auth?.oauth2;
    box.hidden = false;
    const oauthPart = !o?.supported ? '' : o.clientReady
      ? `<div class="cx-fix-h">OAUTH</div>
         <button class="cx-btn cx-btn-go" onclick="cxRecoverOauth('${esc(key)}')">${o.connected ? 'Yeniden bağlan' : 'İzin ekranına git'}</button>
         <span class="cx-hint">token'ı sen görmezsin; süresi dolunca kendiliğinden yenilenir</span>`
      : `<div class="cx-fix-h">OAUTH — TEK SEFERLİK KURULUM</div>
         ${(o.appSetupSteps || []).map((x, i) => `<div class="cx-step">${i + 1}. ${esc(x)}</div>`).join('')}
         <a class="cx-setup" href="${esc(o.appSetupUrl)}" target="_blank" rel="noreferrer noopener">uygulama oluştur ↗</a>
         <div class="cx-step">Callback / Redirect URL:</div>
         <code class="cx-copy" onclick="cxCopy(this)" title="Kopyalamak için tıkla">${esc(o.redirectUri)}</code>
         <input id="cxCid-${esc(key)}" placeholder="Client ID" autocomplete="off">
         <input id="cxSec-${esc(key)}" placeholder="Client Secret" autocomplete="off">
         <button class="cx-btn cx-btn-go" onclick="cxSaveClient('${esc(key)}')">kaydet ve bağlan</button>`;
    const accPart = c.auth?.accounts ? cxClaudeBox(c) : '';
    const keyPart = !ak ? '' : `<div class="cx-fix-h">${accPart ? 'YA DA API ANAHTARI' : (o?.supported ? 'YA DA API ANAHTARI' : 'KİMLİK')}</div>
         ${(ak.steps || []).map((x, i) => `<div class="cx-step">${i + 1}. ${esc(x)}</div>`).join('')}
         ${ak.setupUrl ? `<a class="cx-setup" href="${esc(ak.setupUrl)}" target="_blank" rel="noreferrer noopener">token al ↗</a>` : ''}
         ${ak.vars.map(v => `<input id="cxVar-${esc(key)}-${esc(v.name)}" type="${v.secret ? 'password' : 'text'}" placeholder="${esc(v.label)}" autocomplete="off">`).join('')}
         <button class="cx-btn cx-btn-go" onclick="cxSaveCreds('${esc(key)}')">kaydet ve doğrula</button>
         <span class="cx-hint" id="cxCredState-${esc(key)}">${ak.source && ak.source !== 'store' ? `şu an kaynak: ${esc(c.credentialSourceLabel)}` : ''}</span>`;
    box.innerHTML = accPart + oauthPart + keyPart;
    box.querySelector('input')?.focus();
  }

  function cxRecoverOauth(key) {
    location.href = `/api/oauth/${key}/start?t=${encodeURIComponent(PANEL_TOKEN)}`;
  }

  async function cxSaveCreds(key) {
    const c = PF_LAST?.checks.find(x => x.key === key);
    const ak = c?.auth?.apiKey;
    if (!ak) return;
    const vars = {};
    for (const v of ak.vars) {
      const el = document.getElementById(`cxVar-${key}-${v.name}`);
      vars[v.name] = el?.value?.trim() ?? '';
      if (!vars[v.name]) return uiToast(`${v.label} zorunlu`, { type: 'err' });
    }
    const st = document.getElementById(`cxCredState-${key}`);
    if (st) st.textContent = 'doğrulanıyor…';
    const d = await post(`/api/connectors/${key}/credentials`, { vars });
    if (!d.ok) {
      if (st) st.textContent = '';
      return uiToast(`${d.error}${d.fix?.length ? '\n' + d.fix.join('\n') : ''}`, { type: 'err', title: 'Bağlanamadı' });
    }
    uiToast(`${c.label} bağlandı: ${d.detail || d.state}`, { type: 'ok' });
    loadPreflight(true);
  }

  async function cxCredRemove(key) {
    if (!(await uiConfirm(`${key} için panel kaydı silinsin mi? Ortam değişkeni ya da dosya varsa onlar kalır.`, { ok: 'Sil' }))) return;
    const d = await post(`/api/connectors/${key}/credentials/remove`, {});
    if (d.error) return uiToast(d.error, { type: 'err' });
    uiToast('Panel kaydı silindi', { type: 'ok' });
    loadPreflight(true);
  }

  /**
   * CLAUDE HESAPLARI — kisi kendi abonelgiyle baglanir (API anahtari sart degil).
   *
   * Iki yol, ikisi de ayni depoya yazar:
   *   Panelden giris (sunucu, Linux): panel `claude setup-token`'i sozde terminalde
   *     baslatir, Anthropic'in giris adresini burada gosterir; kisi kendi
   *     tarayicisinda girer, donen kodu buraya yapistirir.
   *   Token yapistir: kisi kendi makinesinde `claude setup-token` kosar, cikan
   *     sk-ant-oat… token'ini buraya yapistirir. Her yerde calisir.
   *
   * ⚠️ Limit dolunca panel BASKA hesaba GECMEZ (abonelik paylasimi); uretimde
   * hangi hesabin kosacagini kullanici secer.
   */
  let CX_LOGIN = null;   // suren panelden-giris akisi: { loginId, key }

  function cxClaudeBox(c) {
    const list = c.auth?.accounts?.list ?? aiStatus()?.accounts ?? [];
    const relay = c.auth?.accounts?.relay ?? aiStatus()?.relay ?? { ok: false };
    const logins = c.auth?.accounts?.logins ?? aiStatus()?.logins ?? [];
    const satirlar = list.length
      ? list.map(a => `<div class="cx-row"><span class="cx-k">${esc(a.label)}</span>`
          + `<span class="cx-v mono">${esc(a.id)} · ${esc(a.tokenTail || '')}`
          + `${a.expired ? ' · <b>süresi dolmuş</b>' : ''}${a.lastUsedAt ? ` · son kullanım ${esc(new Date(a.lastUsedAt).toLocaleDateString('tr-TR'))}` : ' · hiç kullanılmadı'}</span>`
          + `<button class="cx-btn" onclick="cxClaudeRemove('${esc(a.id)}')">sil</button></div>`).join('')
      : '<div class="cx-step">Henüz hesap yok.</div>';
    const girisDugmesi = relay.ok
      ? `<button class="cx-btn cx-btn-go" onclick="cxClaudeLogin()">Panelden giriş</button>`
        + `<span class="cx-hint">adres çıkar, kendi tarayıcında girersin</span>`
      : `<span class="cx-hint">${esc(relay.reason || 'panelden giriş bu makinede kapalı')}</span>`;
    // Suren akislar: loginId yalniz tarayici bellegindeydi, sayfa yenilenince
    // akis sunucuda yasamaya devam edip slot tutuyor ama kartta GORUNMUYORDU.
    const surenler = logins.length
      ? `<div class="cx-fix-h">SÜREN GİRİŞLER</div>` + logins.map(l => `<div class="cx-row">`
          + `<span class="cx-k">${esc(l.label || l.loginId)}</span>`
          + `<span class="cx-v mono">${l.alive ? `${Math.max(0, Math.round(l.ttlSec / 60))} dk kaldı` : 'süreç kapandı'}</span>`
          + (l.alive && l.url ? `<button class="cx-btn cx-btn-go" onclick="cxClaudeResume('${esc(l.loginId)}')">devam et</button>` : '')
          + `<button class="cx-btn" onclick="cxClaudeDropLogin('${esc(l.loginId)}')">vazgeç</button></div>`).join('')
      : '';
    return `<div class="cx-fix-h">CLAUDE HESAPLARI</div>${satirlar}${surenler}
      <div class="cx-fix-h">HESAP EKLE</div>
      <input id="cxAccLabel" placeholder="Kimin hesabı (ör. Murat)" autocomplete="off">
      ${girisDugmesi}
      <div id="cxAccLogin"></div>
      <div class="cx-step">Ya da kendi makinende <code>claude setup-token</code> çalıştırıp token'ı yapıştır:</div>
      <input id="cxAccToken" type="password" placeholder="sk-ant-oat…" autocomplete="off">
      <button class="cx-btn cx-btn-go" onclick="cxClaudeToken()">Token'ı kaydet</button>`;
  }

  async function cxClaudeLogin() {
    const label = document.getElementById('cxAccLabel')?.value?.trim();
    if (!label) return uiToast('Önce hesabın kime ait olduğunu yaz.', { type: 'err' });
    const box = document.getElementById('cxAccLogin');
    box.innerHTML = '<div class="cx-step">giriş adresi hazırlanıyor…</div>';
    const d = await post('/api/claude/accounts/login/start', { label });
    if (!d.ok) { box.innerHTML = ''; return uiToast(d.error || 'Başlatılamadı.', { type: 'err', title: 'Panelden giriş' }); }
    // ⚠️ Burada loadPreflight CAGIRMA: kart yeniden cizilir ve kod kutusu ucar.
    cxLoginBox(d.loginId, d.url);
  }

  /** Kod kutusu — hem yeni akista hem "devam et"te AYNI govde kullanilir. */
  function cxLoginBox(loginId, url) {
    CX_LOGIN = { loginId };
    const box = document.getElementById('cxAccLogin');
    if (!box) return;
    box.innerHTML = `<div class="cx-step">1. Bu adresi <b>kendi tarayıcında</b> aç ve kendi Claude hesabınla gir:</div>
      <a class="cx-setup" href="${esc(url)}" target="_blank" rel="noreferrer noopener">giriş sayfasını aç ↗</a>
      <code class="cx-copy" onclick="cxCopy(this)" title="Kopyalamak için tıkla">${esc(url)}</code>
      <div class="cx-step">2. Sayfadaki kodu buraya yapıştır:</div>
      <input id="cxAccCode" placeholder="Anthropic'in verdiği kod" autocomplete="off">
      <button class="cx-btn cx-btn-go" onclick="cxClaudeCode()">Kodu gönder</button>
      <button class="cx-btn" onclick="cxClaudeCancel()">vazgeç</button>
      <span class="cx-hint">akış 10 dk açık kalır · kod kabul edilmezse aynı kutuda yeniden dene</span>`;
    document.getElementById('cxAccCode')?.focus();
  }

  /**
   * Sayfa yenilenmis: sunucuda duran akisa geri baglan. Adres onclick'e
   * GOMULMEZ (`esc` tek tirnagi kacirmiyor) — son preflight verisinden okunur.
   */
  function cxClaudeResume(loginId) {
    const akislar = PF_LAST?.checks?.find(c => c.key === 'claude-code')?.auth?.accounts?.logins ?? [];
    const l = akislar.find(x => x.loginId === loginId);
    if (!l?.url) return uiToast('Akışın adresi kayboldu — yeniden başlat.', { type: 'err' });
    cxLoginBox(loginId, l.url);
  }

  /** Terk edilmis akisi dusur (slot bosalsin). */
  async function cxClaudeDropLogin(loginId) {
    await post('/api/claude/accounts/login/cancel', { loginId });
    if (CX_LOGIN?.loginId === loginId) { CX_LOGIN = null; const b = document.getElementById('cxAccLogin'); if (b) b.innerHTML = ''; }
    loadPreflight(true);
  }

  async function cxClaudeCode() {
    if (!CX_LOGIN) return;
    const code = document.getElementById('cxAccCode')?.value?.trim();
    if (!code) return uiToast('Kodu yapıştır.', { type: 'err' });
    const btn = document.querySelector('#cxAccLogin .cx-btn-go');
    if (btn) { btn.disabled = true; btn.textContent = 'kod işleniyor…'; }
    const d = await post('/api/claude/accounts/login/code', { loginId: CX_LOGIN.loginId, code });
    if (btn) { btn.disabled = false; btn.textContent = 'Kodu gönder'; }
    if (!d.ok) {
      // Akis AYAKTA kaldiysa (gecersiz kod, zaman asimi) kutu durur: kullanici
      // ayni kutuda yeniden dener. Surec olduyse (CLI_EXIT) kutu kapanir.
      uiToast(d.error || 'Kod kabul edilmedi.', { type: 'err', title: 'Giriş' });
      if (d.alive === false || d.code === 'EXPIRED' || d.code === 'CLI_EXIT') {
        CX_LOGIN = null;
        const b = document.getElementById('cxAccLogin'); if (b) b.innerHTML = '';
        loadPreflight(true);
      }
      return;
    }
    CX_LOGIN = null;
    uiToast(`"${d.label}" hesabı eklendi (${d.id}).`, { type: 'ok' });
    await loadAiStatus();
    loadPreflight(true);
  }

  async function cxClaudeCancel() {
    if (CX_LOGIN) await post('/api/claude/accounts/login/cancel', { loginId: CX_LOGIN.loginId });
    CX_LOGIN = null;
    const box = document.getElementById('cxAccLogin');
    if (box) box.innerHTML = '';
    loadPreflight(true);
  }

  async function cxClaudeToken() {
    const label = document.getElementById('cxAccLabel')?.value?.trim();
    const token = document.getElementById('cxAccToken')?.value?.trim();
    if (!label) return uiToast('Önce hesabın kime ait olduğunu yaz.', { type: 'err' });
    if (!token) return uiToast('Token boş.', { type: 'err' });
    const d = await post('/api/claude/accounts', { label, token });
    if (!d.ok) return uiToast(d.error || 'Kaydedilemedi.', { type: 'err', title: 'Hesap eklenemedi' });
    uiToast(`"${d.label}" hesabı eklendi (${d.id}).`, { type: 'ok' });
    await loadAiStatus();
    loadPreflight(true);
  }

  async function cxClaudeRemove(id) {
    if (!(await uiConfirm(`${id} hesabı panelden silinsin mi? Token claude.ai ayarlarından ayrıca iptal edilebilir.`, { ok: 'Sil' }))) return;
    const d = await post('/api/claude/accounts/remove', { id });
    if (!d.ok) return uiToast(d.error || 'Silinemedi.', { type: 'err' });
    uiToast('Hesap silindi', { type: 'ok' });
    await loadAiStatus();
    loadPreflight(true);
  }

  function cxCopy(el) {
    navigator.clipboard?.writeText(el.textContent.trim());
    const eski = el.textContent;
    el.textContent = 'kopyalandı';
    setTimeout(() => { el.textContent = eski; }, 900);
  }

  async function cxSaveClient(key) {
    const clientId = document.getElementById(`cxCid-${key}`)?.value?.trim();
    const clientSecret = document.getElementById(`cxSec-${key}`)?.value?.trim();
    if (!clientId || !clientSecret) return uiToast('Client ID ve Secret zorunlu', { type: 'err' });
    const d = await post(`/api/oauth/${key}/client`, { clientId, clientSecret });
    if (d.error) return uiToast(d.error, { type: 'err', title: 'Kaydedilemedi' });
    // Kayit tamam: dogrudan izin ekranina gonder — "kaydet ve baglan" sozu bu.
    location.href = `/api/oauth/${key}/start?t=${encodeURIComponent(PANEL_TOKEN)}`;
  }

  async function cxDisconnect(key) {
    if (!(await uiConfirm(`${key} bağlantısını kes?`, { ok: 'Kes' }))) return;
    const d = await post(`/api/oauth/${key}/disconnect`, {});
    if (d.error) return uiToast(d.error, { type: 'err', title: 'Kesilemedi' });
    uiToast('Bağlantı kesildi', { type: 'ok' });
    loadPreflight(true);
  }

  async function cxUse(key, capability) {
    const d = await post('/api/connectors/use', { capability, connector: key });
    if (d.error) return uiToast(d.error, { type: 'err', title: 'Açılamadı' });
    uiToast(`${key} artık bu projede "${capability}" olarak kullanılıyor`, { type: 'ok' });
    loadPreflight(true);
  }

  function pfPanelOpen() {
    if (!PF_LAST) return;
    const el = $('#cxPanel');
    el.innerHTML = `<div class="cx-top"><b>BAĞLANTILAR</b>
        <span class="cx-when">${esc(new Date(PF_LAST.at).toLocaleTimeString('tr-TR'))}</span>
        <button onclick="loadPreflight(true)">yenile</button>
        <button onclick="pfPanelClose()" aria-label="Kapat">×</button></div>`
      + PF_LAST.checks.map(pfCard).join('');
    el.hidden = false;
    /*
     * Panel kopmus satira BAKARAK acilir: `connectors`a basan kisi zaten bir sey
     * calismadigi icin basiyor, listeyi gozle taramasin. Pasif satirlar
     * (Slack/Linear — panel onlari kullanmiyor) tetiklemez; ust rozeti de
     * etkilemiyorlar, ikisi ayni kurali izlemeli.
     */
    const kopuk = PF_LAST.checks.filter(c => !c.passive && c.state !== 'ok');
    // Kurtarma yolu OLAN kart oncelikli: aksi halde panel, tiklanacak hicbir seyi
    // olmayan bir karti (ornegin MobAI) isaret edip yardim etmemis oluyor.
    const ilkKopuk = kopuk.find(cxRecoverPlan) ?? kopuk[0];
    const kart = ilkKopuk && el.querySelector(`.cx-card[data-cx="${CSS.escape(ilkKopuk.key)}"]`);
    if (kart) { kart.classList.add('cx-flash'); kart.scrollIntoView({ block: 'nearest' }); }
  }
  function pfPanelClose() { $('#cxPanel').hidden = true; }
  function pfPanelToggle() { $('#cxPanel').hidden ? pfPanelOpen() : pfPanelClose(); }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') pfPanelClose(); });
  /**
   * Disina tiklama kapatir. ⚠️ `#cxWrap` HARIC tutulmali: connectors dugmesi
   * panelin kardesi, panelin ICINDE degil. Haric tutulmazsa dugmeye basmak once
   * paneli aciyor, sonra AYNI tiklama buraya kadar kabararak hemen kapatiyor —
   * panel hic gorunmuyor.
   */
  document.addEventListener('click', e => {
    const p = $('#cxPanel');
    if (!p || p.hidden) return;
    if (!p.contains(e.target) && !e.target.closest('#cxWrap')) pfPanelClose();
  });

  async function loadPreflight(keepOpen) {
    try {
      const d = await (await fetch('/api/preflight')).json();
      PF_LAST = d;

      /**
       * connectors dugmesinin durum noktasi. `d.worst`i KULLANMIYOR: o `off`u
       * `blocked` sayiyor ve Anthropic anahtari kasitli yokken dugme surekli
       * kirmizi kaliyor. Ayrim onemli — "kota bloke/bozuk" (kirmizi) ile
       * "kurulmamis" (amber) ayni sey degil.
       */
      // `passive` satirlar (Slack/Linear — gosterim amacli, panel onlari
      // kullanmiyor) rozeti ETKILEMEZ: eksik token dugmeyi surekli amber
      // yakmamali. Sunucu tarafinda `worst` de ayni sekilde disliyor.
      const active = d.checks.filter(c => !c.passive);
      const states = active.map(c => c.state);
      const badge = states.includes('blocked') ? 'blocked'
        : states.some(s => s === 'off' || s === 'warn') ? 'warn' : 'ok';
      const btn = $('#cxBtn');
      if (btn) {
        btn.className = badge;
        const bad = active.filter(c => c.state !== 'ok');
        btn.title = bad.length
          ? `Bağlantılar — sorunlu: ${bad.map(c => c.label).join(', ')}`
          : 'Bağlantılar — hepsi bağlı';
      }
      // ⚠️ Suren "panelden giris" akisinda kart YENIDEN CIZILMEZ: periyodik
      // yenileme (10 dk) kod kutusunu ve icindeki yazilmis kodu ucuruyordu.
      const girisAcik = !!CX_LOGIN && document.getElementById('cxAccCode');
      if (!girisAcik && (keepOpen || !$('#cxPanel').hidden)) pfPanelOpen();
    } catch (e) {
      // Ust seritte gosterecek yer yok; hata connectors dugmesinde durur.
      const btn = $('#cxBtn');
      if (btn) { btn.className = 'blocked'; btn.title = `Bağlantılar okunamadı: ${e.message}`; }
    }
  }

  /* Kartlardaki onclick'ler ve nav.js'teki düğme bu adlara bakıyor. */
  Object.assign(window, { cxSetupLink, pfCard, cxRecoverPlan, cxBadgePlan, cxCut, cxRecover, cxActions, cxConnectOpen, cxRecoverOauth, cxSaveCreds, cxCredRemove, cxClaudeBox, cxClaudeLogin, cxLoginBox, cxClaudeResume, cxClaudeDropLogin, cxClaudeCode, cxClaudeCancel, cxClaudeToken, cxClaudeRemove, cxCopy, cxSaveClient, cxDisconnect, cxUse, pfPanelOpen, pfPanelClose, pfPanelToggle, loadPreflight });

  /* İlk yükleme + 10 dk'da bir tazeleme. Düğme yoksa (yüzeyde kapalı) hiç istek atma. */
  function cxInit() {
    if (!$('#cxBtn')) return;
    loadPreflight();
    setInterval(loadPreflight, 10 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cxInit);
  else cxInit();
})();
