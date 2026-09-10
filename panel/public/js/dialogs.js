/**
 * Panel bildirimleri — uiToast / uiConfirm / uiPrompt (klasik script, global).
 *
 * `index.html`'den ayrildi: uc diyalog ilkeli tek dosyada dursun, Flowscope'taki
 * ES modul karsiligi (`scope/js/dialog.js`) ile ayni davranissa yan yana
 * karsilastirilabilsin. Global fonksiyon olarak KALDI: index.html'deki 40+
 * cagiran `onclick="..."` ve satir ici script bunlara adla bakiyor.
 *
 * Kurallar (degismedi):
 *  - Hata toast'i KENDILIGINDEN KAPANMAZ (ms:0). Bilgi/basari 6 sn.
 *  - uiConfirm/uiPrompt ASENKRON: `await` sart. `if (!uiConfirm(...))` her zaman
 *    false doner (Promise truthy) ve yikici islem onaysiz calisir.
 *  - Escape ve disa tiklama = vazgec; Enter = onay.
 */
(function () {
  const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function uiToast(mesaj, opt = {}) {
    const tip = opt.type || "info";
    let yigin = document.getElementById("uiToasts");
    if (!yigin) {
      yigin = document.createElement("div");
      yigin.id = "uiToasts";
      document.body.appendChild(yigin);
    }
    const t = document.createElement("div");
    t.className = "ui-toast " + (tip === "err" ? "err" : tip === "ok" ? "ok" : "");
    t.setAttribute("role", tip === "err" ? "alert" : "status");
    const renk = tip === "err" ? "var(--no)" : tip === "ok" ? "var(--ok)" : "var(--acc)";
    const baslik = opt.title || (tip === "err" ? "Hata" : tip === "ok" ? "Tamam" : "Bilgi");
    t.innerHTML = `<div class="hd"><span class="dot" style="background:${renk}"></span>${escHtml(baslik)}
        <button class="x" title="Kapat">×</button></div>
      <div class="bd">${escHtml(mesaj)}</div>`;
    t.querySelector(".x").onclick = () => t.remove();
    yigin.appendChild(t);
    const sure = opt.ms ?? (tip === "err" ? 0 : 6000);
    if (sure) setTimeout(() => t.remove(), sure);
    return t;
  }

  /** Ortak diyalog iskeleti: baslik + mesaj + (opsiyonel input) + iki dugme. */
  function askBox({ title, mesaj, input, okLabel, cancelLabel, danger }) {
    document.getElementById("uiAsk")?.remove();
    const ov = document.createElement("div");
    ov.id = "uiAsk";
    ov.innerHTML = `<div class="box" role="dialog" aria-modal="true">
        <h3>${escHtml(title)}</h3>
        <div class="msg">${escHtml(mesaj)}</div>
        ${input ? `<input id="uiAskInput" type="text" style="width:100%;margin:0 0 12px" value="${escHtml(input.value)}">` : ""}
        <div class="row3">
          <button id="uiAskNo">${escHtml(cancelLabel)}</button>
          <button id="uiAskYes" class="${danger ? "danger" : ""}">${escHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    return ov;
  }

  /** @returns {Promise<boolean>} */
  function uiConfirm(mesaj, opt = {}) {
    return new Promise((resolve) => {
      const ov = askBox({
        title: opt.title || "Onay gerekiyor", mesaj,
        okLabel: opt.ok || "Devam et", cancelLabel: opt.cancel || "Vazgeç", danger: opt.danger !== false,
      });
      const kapat = (cevap) => { document.removeEventListener("keydown", tus); ov.remove(); resolve(cevap); };
      const tus = (e) => { if (e.key === "Escape") kapat(false); if (e.key === "Enter") kapat(true); };
      ov.querySelector("#uiAskNo").onclick = () => kapat(false);
      ov.querySelector("#uiAskYes").onclick = () => kapat(true);
      ov.onclick = (e) => { if (e.target === ov) kapat(false); };
      document.addEventListener("keydown", tus);
      ov.querySelector("#uiAskYes").focus();
    });
  }

  /**
   * Tek satirlik metin sorusu — tarayicinin `prompt()`unun temali karsiligi.
   * Vazgec/Escape → null, Enter/Tamam → metin.
   * @returns {Promise<string|null>}
   */
  function uiPrompt(mesaj, varsayilan = "", opt = {}) {
    return new Promise((resolve) => {
      const ov = askBox({
        title: opt.title || "Bilgi gerekiyor", mesaj, input: { value: varsayilan },
        okLabel: opt.ok || "Tamam", cancelLabel: opt.cancel || "Vazgeç", danger: false,
      });
      const input = ov.querySelector("#uiAskInput");
      const kapat = (cevap) => { document.removeEventListener("keydown", tus); ov.remove(); resolve(cevap); };
      const tus = (e) => { if (e.key === "Escape") kapat(null); if (e.key === "Enter") kapat(input.value); };
      ov.querySelector("#uiAskNo").onclick = () => kapat(null);
      ov.querySelector("#uiAskYes").onclick = () => kapat(input.value);
      ov.onclick = (e) => { if (e.target === ov) kapat(null); };
      document.addEventListener("keydown", tus);
      input.focus();
      input.select();
    });
  }

  /**
   * Listeden secim — `uiConfirm`in acilir kutulu kardesi. Vazgec/Escape → null.
   * Claude hesap secimi bunu kullaniyor: hangi abonelikle kosulacagi kullanicinin
   * karari, panel kendiliginden baskasinin hesabina gecmez.
   * @param {string} mesaj
   * @param {{value:string,label:string}[]} secenekler
   * @returns {Promise<string|null>}
   */
  function uiChoose(mesaj, secenekler, opt = {}) {
    return new Promise((resolve) => {
      const list = (secenekler || []).filter((s) => s && s.value != null);
      if (!list.length) return resolve(null);
      const ov = askBox({
        title: opt.title || "Seçim", mesaj,
        okLabel: opt.ok || "Devam et", cancelLabel: opt.cancel || "Vazgeç", danger: false,
      });
      const box = ov.querySelector(".box");
      const sel = document.createElement("select");
      sel.id = "uiAskSelect";
      sel.style.cssText = "width:100%;margin:0 0 12px";
      for (const s of list) {
        const o = document.createElement("option");
        o.value = s.value;
        o.textContent = s.label ?? s.value;
        if (opt.value != null && String(opt.value) === String(s.value)) o.selected = true;
        sel.appendChild(o);
      }
      box.insertBefore(sel, box.querySelector(".row3"));
      const kapat = (cevap) => { document.removeEventListener("keydown", tus); ov.remove(); resolve(cevap); };
      const tus = (e) => { if (e.key === "Escape") kapat(null); if (e.key === "Enter") kapat(sel.value); };
      ov.querySelector("#uiAskNo").onclick = () => kapat(null);
      ov.querySelector("#uiAskYes").onclick = () => kapat(sel.value);
      ov.onclick = (e) => { if (e.target === ov) kapat(null); };
      document.addEventListener("keydown", tus);
      sel.focus();
    });
  }

  window.uiToast = uiToast;
  window.uiConfirm = uiConfirm;
  window.uiPrompt = uiPrompt;
  window.uiChoose = uiChoose;
})();
