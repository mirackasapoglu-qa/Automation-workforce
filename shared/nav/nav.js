/**
 * ORTAK UST BAR — markup + davranis. Panel (/), Flowscope (/scope) ve landing
 * (4321) barlarinin TEK kaynagi. Bicimi kardesi `nav.css` tasir.
 *
 * KLASIK SCRIPT, bilincli olarak ESM DEGIL: panelin 236 KB'lik `index.html`i
 * bardaki id'lere (`#cmdInput`, `#gatePill`, `#cxBtn`, `#themeBtn`, `#sbToggle`)
 * yukleme aninda calisan IIFE'lerden bakiyor. `type="module"` ertelenir ve o
 * IIFE'ler bos DOM bulurdu. `<script src="nav.js">` + hemen ardindan
 * `HqNav.mount(...)` senkron kosar; bar, panelin kendi script'lerinden ONCE
 * yerinde olur.
 *
 * ⚠️ URETILEN ID'LER PANELIN SOZLESMESI. `#cmdInput`, `#cmdMenu`, `#crumbLeaf`,
 * `#panelTitle`, `#activePill`, `#orderPill`, `#scopeLink`, `#cxWrap`, `#cxBtn`,
 * `#cxPanel`, `#gatePill`, `#envPill`, `#themeBtn`, `#sbToggle` — bunlari
 * yeniden adlandirirsan panelin ilgili davranisi sessizce oler. Ekleme
 * serbest, yeniden adlandirma degil.
 */
(function () {
  "use strict";

  /* =========================================================================
     YAPILANDIRMA — "tek yer" burasi. Yeni bir yuzey ya da yeni bir gecis
     baglantisi eklemek icin yalnizca bu blok degisir.
     ========================================================================= */

  /**
   * `on`   : bu yuzeyde acik olan bar parcalari.
   * `go`   : bardaki gecis dugmeleri — bulundugun yer haric, SIRAYLA.
   * `root` : kirilimin sol yarisi ("<proje> / <sayfa>"). `meta` yazarsa
   *          /api/meta'dan proje adi cekilir (panel origin'i sart).
   * `home` : HQ rozetinin gittigi yer. Yoksa rozet tiklanmaz (zaten oradasin).
   */
  var SURFACES = {
    panel: {
      label: "Panel",
      title: "QA Paneli — kosumlar, sonuclar, Jira, performans",
      icon: "grid",
      origin: "panel",
      path: "/",
      root: "QA Paneli",     // panelin kendi load()'u /api/meta ile ustune yazar
      leaf: "Genel bakis",
      go: ["scope"],
      on: { sidebarToggle: true, cmd: true, status: true },
    },
    scope: {
      label: "Kapsam",
      title: "Kapsam agaci — urun hiyerarsisi, durum ve test case'ler",
      icon: "scope",
      accent: true,          // gecis eylemi: durum gostergelerinden AYRISIR
      linkId: "scopeLink",   // panelin bugunku id'si korunuyor
      origin: "panel",
      path: "/scope",
      root: "meta",
      leaf: "Kapsam",
      home: "panel",
      go: ["panel", "landing"],
      // Komut kutusu KAPALI: Flowscope'un kendi "Ara..." kutusu var (toolbar),
      // ustune ikinci bir arama alani koymak iki farkli kapsami ayni gorunumle
      // yan yana getirirdi. Aramasi bir gun bara tasinirsa burasi `cmd: true`.
      on: {},
    },
    landing: {
      label: "Landing",
      title: "Tanitim sayfasi",
      icon: "globe",
      origin: "landing",
      path: "/",
      // Kirilim kokunu SITE veriyor (mount opts.root): bu dosya cok projeli
      // panelin cekirdeginde, icinde proje adi gecemez — bkz. panel:check.
      root: "QA",
      leaf: "Landing",
      go: ["onboarding", "panel", "scope"],
      // Tanitim sayfasinda arayacak bir sey yok: bar marka + gecis + tema.
      on: {},
    },
    onboarding: {
      label: "Onboarding",
      title: "Baslangic rehberi",
      icon: "spark",
      origin: "landing",
      path: "/onboarding",
      root: "QA",
      leaf: "Baslangic",
      home: "landing",
      go: ["landing", "panel", "scope"],
      on: {},
    },
  };

  var DEFAULT_PORT = { panel: 4646, landing: 4321 };
  var LOCAL_HOSTS = { localhost: 1, "127.0.0.1": 1, "::1": 1, "[::1]": 1 };

  /* ========================================================================= */

  var ICON = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    // Kapsam ekraninin KENDI isareti (scope/js/constants.js → ICON.logo) — uydurma degil.
    scope: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="4.5" cy="4.5" r="1.9"/><circle cx="15.5" cy="4.5" r="1.9"/><circle cx="10" cy="15.5" r="1.9"/><path d="M6 5.8 9 13.2"/><path d="M14 5.8 11 13.2"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l2.1 5.4L19.5 10l-5.4 1.6L12 17l-2.1-5.4L4.5 10l5.4-1.6z"/></svg>',
  };

  var THEME_KEY = "qa-panel-theme";
  var THEME_LABEL = { dark: "◐ gece", light: "◑ açık" };

  var providers = [];   // komut kutusu kaynaklari
  var current = null;   // aktif yuzeyin id'si
  var els = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---- adresler ----------------------------------------------------------
   * Bir yuzeyin adresi hangi SURECTE kostuguna bagli: panel + Kapsam ayni
   * origin'de (4646), landing + onboarding baska bir surecte (4321).
   *
   * ⚠️ Karar istegin HOST'una gore verilir, ortam degiskenine gore DEGIL.
   * Sunucuda landing HIC YOK; oradaki bar localhost:4321'e giden OLU bir link
   * gostermemeli — adres cozulemezse dugme HIC BASILMAZ.
   */
  function originFor(kind) {
    var cfg = (window.HQ_NAV || {});
    var given = cfg[kind];
    if (typeof given === "string") {
      var v = given.trim();
      return v === "" || v.toLowerCase() === "off" ? "" : v.replace(/\/+$/, "");
    }
    // Bulundugumuz yuzey zaten bu surecteyse: kendi origin'imiz.
    if (current && SURFACES[current] && SURFACES[current].origin === kind) return location.origin;
    // Degilse yalnizca lokalde tahmin yururlukte.
    var host = location.hostname;
    if (!LOCAL_HOSTS[host]) return "";
    return location.protocol + "//" + host + ":" + DEFAULT_PORT[kind];
  }

  function urlFor(id) {
    var s = SURFACES[id];
    if (!s) return "";
    var o = originFor(s.origin);
    if (!o) return "";
    return o + (s.path === "/" ? "/" : s.path);
  }

  /* ---- tema --------------------------------------------------------------
   * Secim localStorage'da, yoksa sistem tercihi. Panel ve Kapsam ayni origin
   * oldugu icin ayni anahtari PAYLASIR — panelde koyuya gecince Kapsam da koyu
   * acilir. Landing ayri origin: kendi tercihi olur, bu beklenen.
   */
  function applyTheme(mode) {
    if (mode) document.documentElement.setAttribute("data-theme", mode);
    else document.documentElement.removeAttribute("data-theme");
    var eff = mode || (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark");
    if (els.theme) {
      els.theme.textContent = THEME_LABEL[eff];
      els.theme.setAttribute("aria-pressed", String(eff === "light"));
    }
  }

  function readTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function wireTheme(btn) {
    els.theme = btn;
    applyTheme(readTheme());
    btn.addEventListener("click", function () {
      var eff = document.documentElement.getAttribute("data-theme")
        || (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark");
      var next = eff === "light" ? "dark" : "light";
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* depolama kapali */ }
      applyTheme(next);
      // Panelin gecis animasyonu bu sinifi bekliyor; yoksa hicbir sey olmaz.
      document.documentElement.classList.add("theme-anim");
      setTimeout(function () { document.documentElement.classList.remove("theme-anim"); }, 450);
    });
  }

  /* ---- komut kutusu (⌘K) -------------------------------------------------
   * Mekanik burada, ICERIK yuzeyden gelir: her yuzey `registerCommands` ile
   * kendi kaynagini ekler (panel → whitelist'teki kosumlar + sekmeler).
   * Yuzey gecisleri her yerde HAZIR gelir, ayrica kaydedilmeleri gerekmez.
   */
  var CMD = { items: [], sec: 0 };

  function surfaceCommands(q) {
    var out = [];
    var s = SURFACES[current];
    var list = (s && s.go) || [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i], t = SURFACES[id], href = urlFor(id);
      if (!t || !href) continue;
      if (q && t.label.toLowerCase().indexOf(q) < 0) continue;
      out.push({ k: "git", ad: t.label, ip: href.replace(/^https?:\/\//, ""), yap: (function (h) {
        return function () { location.href = h; };
      })(href) });
    }
    return out;
  }

  function cmdBuild(raw) {
    var q = String(raw || "").trim().toLowerCase();
    var out = [];
    for (var i = 0; i < providers.length; i++) {
      try { out = out.concat(providers[i](q) || []); } catch (e) { /* bir kaynak patlarsa digerleri kalsin */ }
    }
    return out.concat(surfaceCommands(q)).slice(0, 8);
  }

  function cmdRender() {
    var el = els.cmdMenu;
    if (!el) return;
    if (!CMD.items.length) { el.hidden = true; return; }
    el.innerHTML = CMD.items.map(function (i, n) {
      return '<div class="cmd-item ' + (n === CMD.sec ? "on" : "") + '" data-n="' + n + '">'
        + '<span class="cmd-k">' + esc(i.k) + "</span><span>" + esc(i.ad) + "</span>"
        + '<span class="cmd-s">' + esc(i.ip) + "</span></div>";
    }).join("");
    el.hidden = false;
    el.querySelectorAll(".cmd-item").forEach(function (d) {
      d.onclick = function () { cmdPick(Number(d.dataset.n)); };
    });
  }

  function cmdPick(n) {
    var i = CMD.items[n];
    if (!i) return;
    els.cmdMenu.hidden = true;
    els.cmdInput.value = "";
    i.yap();
  }

  function wireCmd(input, menu) {
    els.cmdInput = input;
    els.cmdMenu = menu;
    var refresh = function () { CMD.items = cmdBuild(input.value); CMD.sec = 0; cmdRender(); };
    input.addEventListener("input", refresh);
    input.addEventListener("focus", refresh);
    input.addEventListener("blur", function () { setTimeout(function () { menu.hidden = true; }, 150); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { CMD.sec = Math.min(CMD.sec + 1, CMD.items.length - 1); cmdRender(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { CMD.sec = Math.max(CMD.sec - 1, 0); cmdRender(); e.preventDefault(); }
      else if (e.key === "Enter") { cmdPick(CMD.sec); e.preventDefault(); }
      else if (e.key === "Escape") { menu.hidden = true; input.blur(); }
    });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
        e.preventDefault(); input.focus(); input.select();
      }
    });
  }

  /* ---- markup ------------------------------------------------------------ */

  function goLink(id) {
    var s = SURFACES[id];
    var href = urlFor(id);
    if (!href) return "";           // adres yoksa OLU LINK basma
    var cls = "hqn-go" + (s.accent ? " hqn-accent" : "");
    var idAttr = s.linkId ? ' id="' + s.linkId + '"' : "";
    /*
     * HEPSI AYNI SEKMEDE. Ayri surecteki yuzeyler (landing ↔ panel) once
     * `target="_blank"` ile aciliyordu; kullanici acisindan bu "baska bir
     * sayfaya atildim" demekti. Bar dort yuzeyde de AYNI dosyadan geliyor ve
     * AYNI yukseklikte duruyor (--hq-nav-h), o yuzden ayni sekmede gecis
     * "ust serit sabit, altindaki degisti" gibi gorunuyor — istenen bu.
     *
     * ⚠️ Yeni sekme istegi geri gelirse `rel="noreferrer noopener"` de geri
     * gelmeli; `target="_blank"`i tek basina eklemek acilan sayfaya
     * `window.opener` verir.
     */
    return '<a' + idAttr + ' class="' + cls + '" href="' + esc(href) + '"'
      + ' title="' + esc(s.title) + '">'
      + '<span class="sl-mark" aria-hidden="true">' + ICON[s.icon] + "</span>"
      + "<span>" + esc(s.label) + "</span></a>";
  }

  function build(surface, opts) {
    var s = SURFACES[surface];
    var on = s.on || {};
    var root = opts.root || (s.root === "meta" ? "QA Paneli" : s.root);
    var leaf = opts.leaf || s.leaf || "";
    var home = s.home ? urlFor(s.home) : "";

    var html = "";

    if (on.sidebarToggle) {
      html += '<button id="sbToggle" type="button" onclick="toggleSidebar()"'
        + ' title="Yan paneli daralt/genislet ( [ )" aria-label="Yan paneli daralt">'
        + ICON.chevron + "</button>";
    }

    html += home
      ? '<a class="hq-badge" href="' + esc(home) + '" title="' + esc(SURFACES[s.home].title) + '">HQ</a>'
      : '<span class="hq-badge" aria-hidden="true">HQ</span>';

    html += '<span class="crumb"><span class="crumb-root" id="panelTitle">' + esc(root) + "</span>"
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb-leaf" id="crumbLeaf">' + esc(leaf) + "</span></span>";

    if (on.cmd) {
      html += '<label class="cmdbox" title="Komut: kosum adi ya da sayfa yaz, Enter">'
        + ICON.search
        + '<input id="cmdInput" placeholder="kos, ac, bug... her sey buradan" autocomplete="off">'
        + "<kbd>&#8984;K</kbd></label>"
        + '<div id="cmdMenu" hidden></div>';
    }

    html += '<span class="spacer"></span>';

    if (on.status) {
      html += '<span class="pill" id="activePill" role="status" aria-atomic="true"></span>'
        + '<span class="pill" id="orderPill" role="status" aria-atomic="true" hidden></span>';
    }

    var go = s.go || [];
    for (var i = 0; i < go.length; i++) html += goLink(go[i]);

    if (on.status) {
      html += '<span id="cxWrap"><button id="cxBtn" type="button" onclick="pfPanelToggle()"'
        + ' title="Bağlantılar — kimlik, kota ve çözüm adımları">'
        + '<span class="cx-badge"></span>connectors</button><div id="cxPanel" hidden></div></span>'
        + '<button id="gatePill" class="unknown" type="button" onclick="refreshGate()"'
        + ' title="Tiklayinca kapi oturumunu yeniler">kapi: —</button>'
        + '<span class="pill" id="envPill" role="status" aria-atomic="true" title="Aktif ortam">—</span>';
    }

    html += '<button id="themeBtn" type="button" title="Tema degistir" aria-label="Tema degistir"></button>';

    return html;
  }

  /**
   * Proje adini panelin kendi ucundan al. Kapsam ekrani icin: panel adini
   * `/api/meta`dan okur, boylece `PANEL_PROJECT` degisince kirilim de degisir
   * ve iki yuzde iki farkli proje adi gorunmez.
   */
  function fillRootFromMeta() {
    fetch("/api/meta").then(function (r) { return r.json(); }).then(function (m) {
      var t = m && m.project && m.project.title;
      if (!t) return;
      var el = document.getElementById("panelTitle");
      if (el) el.textContent = t;
    }).catch(function () { /* meta yoksa yapilandirmadaki ad kalir */ });
  }

  /* ---- genel API --------------------------------------------------------- */

  var HqNav = {
    surfaces: SURFACES,
    url: urlFor,

    /**
     * @param {{surface:string, leaf?:string, root?:string, target?:Element}} opts
     * @returns {HTMLElement} olusturulan <header>
     */
    mount: function (opts) {
      opts = opts || {};
      var surface = opts.surface;
      if (!SURFACES[surface]) throw new Error("HqNav: bilinmeyen yuzey: " + surface);
      current = surface;

      var header = document.createElement("header");
      header.className = "hq-nav";
      header.dataset.surface = surface;
      header.innerHTML = build(surface, opts);

      var target = opts.target || document.body;
      if (opts.target && opts.replace) target.replaceWith(header);
      else target.insertBefore(header, target.firstChild);

      var themeBtn = header.querySelector("#themeBtn");
      if (themeBtn) wireTheme(themeBtn);

      var input = header.querySelector("#cmdInput");
      var menu = header.querySelector("#cmdMenu");
      if (input && menu) wireCmd(input, menu);

      if (SURFACES[surface].root === "meta") fillRootFromMeta();

      els.header = header;
      return header;
    },

    /** Kirilimin sag yarisi — bulundugun sayfa/sekme. */
    setLeaf: function (text) {
      var el = document.getElementById("crumbLeaf");
      if (el) el.textContent = text;
    },

    /** Kirilimin sol yarisi — proje adi. */
    setRoot: function (text) {
      var el = document.getElementById("panelTitle");
      if (el) el.textContent = text;
    },

    /**
     * Komut kutusuna kaynak ekle.
     * @param {(q:string) => Array<{k:string, ad:string, ip:string, yap:Function}>} fn
     */
    registerCommands: function (fn) {
      if (typeof fn === "function") providers.push(fn);
    },
  };

  window.HqNav = HqNav;
})();
