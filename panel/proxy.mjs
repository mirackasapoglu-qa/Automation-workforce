/**
 * QA Paneli — site proxy'si (panel içinde canlı iframe için)
 *
 * Neden gerekli: hedef site `x-frame-options: SAMEORIGIN` gönderiyor, bu yüzden
 * `localhost:4646` içine doğrudan iframe olarak gömülemez. Proxy siteyi kendi
 * origin'inden servis eder ve frame engelleyen başlıkları söker.
 *
 * Ek işler:
 *  - "Geçici Erişim" cookie'sini (`temporary_auth_verified`) enjekte eder → kapı ekranı çıkmaz
 *  - Set-Cookie'lerden `Domain=` ve `Secure` bayraklarını temizler → localhost'ta (http) tutunur
 *  - Redirect `Location` başlığını proxy'ye çevirir → yönlendirmeler iframe içinde kalır
 *  - HTML yanıtlarına küçük bir script enjekte eder: iframe içindeki her navigasyonu
 *    `postMessage` ile panele bildirir. (Panel 4646, proxy 4647 → farklı origin olduğu
 *    için panel iframe'in URL'sini başka yolla okuyamaz.)
 *
 * Hedef sitenin API'si `access-control-allow-origin: *` döndüğü sürece iframe
 * içinden sepet/login çağrıları da çalışır — bu kurulumda ölçüldü. Farklı bir
 * projede API `*` döndürmüyorsa kimlikli çağrılar iframe içinde düşer.
 */
import http from "node:http";

const STRIP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function mergeCookie(existing, extra) {
  const parts = (existing ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const name = extra.split("=")[0];
  if (!parts.some((p) => p.startsWith(name + "="))) parts.push(extra);
  return parts.join("; ");
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function startProxy({ baseURL, port, gateCookie = "temporary_auth_verified=true" }) {
  const target = new URL(baseURL);
  const selfOrigin = `http://localhost:${port}`;

  const server = http.createServer(async (req, res) => {
    try {
      const upstream = new URL(req.url, target.origin);

      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (["host", "connection", "accept-encoding", "content-length"].includes(k)) continue;
        headers[k] = v;
      }
      headers.host = target.host;
      headers.origin = target.origin;
      headers.referer = target.origin + req.url;
      headers.cookie = mergeCookie(req.headers.cookie, gateCookie);

      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);

      const upstreamRes = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        redirect: "manual",
      });

      const out = {};
      upstreamRes.headers.forEach((value, key) => {
        if (STRIP.has(key.toLowerCase())) return;
        if (key.toLowerCase() === "set-cookie") return; // ayrıca ele alınıyor
        if (key.toLowerCase() === "location") {
          out.location = value.startsWith(target.origin)
            ? value.replace(target.origin, selfOrigin)
            : value;
          return;
        }
        out[key] = value;
      });

      // Set-Cookie: Domain ve Secure temizlenir ki localhost/http'de tutunsun
      const cookies = (upstreamRes.headers.getSetCookie?.() ?? []).map((c) =>
        c
          .split(";")
          .filter((part) => !/^\s*(domain|secure)\s*(=|$)/i.test(part))
          .join(";"),
      );
      if (cookies.length) out["set-cookie"] = cookies;

      // HTML ise: gövdeyi tampona al ve navigasyon bildirim script'ini enjekte et
      const ctype = String(out["content-type"] ?? "");
      if (ctype.includes("text/html")) {
        const html = await upstreamRes.text();
        const injected = html.replace(
          /<\/head>/i,
          `<script>(function(){
  function ping(){ try { parent.postMessage({ type:"qa-nav", href: location.href, path: location.pathname + location.search, title: document.title }, "*"); } catch(e){} }
  ping();
  addEventListener("load", ping);
  addEventListener("popstate", ping);
  var ps=history.pushState, rs=history.replaceState;
  history.pushState=function(){ var r=ps.apply(this,arguments); setTimeout(ping,60); return r; };
  history.replaceState=function(){ var r=rs.apply(this,arguments); setTimeout(ping,60); return r; };
  setInterval(ping, 1500);
  // kaydirma bildirimi (yan yana tasarim gorunumu icin senkron)
  var lastY = -1, t = 0;
  function pingScroll(){
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    if (Math.abs(y - lastY) < 4) return;
    lastY = y;
    try { parent.postMessage({ type:"qa-scroll", y: y,
      h: document.documentElement.scrollHeight, vh: window.innerHeight }, "*"); } catch(e){}
  }
  addEventListener("scroll", function(){ var n = Date.now(); if (n - t > 80) { t = n; pingScroll(); } }, { passive: true });

  /* ── KAYDEDICI ────────────────────────────────────────────────────────────
     Varsayilan KAPALI; panel {type:"qa-rec",on:true} yollayinca acilir.
     Codegen'i iframe'e koymak mumkun degil (ayri tarayici sureci) — bunun
     yerine tiklama/yazma olaylarini burada yakalayip panele adim olarak
     gonderiyoruz. Locator uretimi rol+erisilebilir ad onceligiyle: bu sitede
     aria-label'lar iyi ("Menuyu kapat", "Urunu kaldir"), CSS'e dusmeye gerek yok. */
  var REC = false;
  addEventListener("message", function(e){
    if (e.data && e.data.type === "qa-rec") { REC = !!e.data.on; if (!REC) setAssert(false); }
    if (e.data && e.data.type === "qa-rec-assert") setAssert(!!e.data.on);
  });

  function implicitRole(el){
    var tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "summary") return "button";
    if (tag === "input") {
      var ty = (el.type || "text").toLowerCase();
      if (ty === "checkbox") return "checkbox";
      if (ty === "radio") return "radio";
      if (ty === "submit" || ty === "button") return "button";
      if (ty === "search") return "searchbox";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return null;
  }

  function cssPath(el){
    var parts = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      var sel = n.tagName.toLowerCase();
      if (n.id) { parts.unshift("#" + n.id); break; }
      var sibs = n.parentNode ? Array.prototype.filter.call(n.parentNode.children, function(c){ return c.tagName === n.tagName; }) : [];
      if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(n) + 1) + ")";
      parts.unshift(sel); n = n.parentElement; depth++;
    }
    return parts.join(" > ");
  }

  function target(el){
    /* tiklanabilir ataya cik: ikon span'ina degil butona baglanmali */
    var n = el, hops = 0;
    while (n && hops < 4 && !/^(a|button|summary|input|select|textarea|label)$/i.test(n.tagName)
           && !n.getAttribute("role") && !n.getAttribute("data-testid")) { n = n.parentElement; hops++; }
    return n || el;
  }

  function locator(el){
    var tid = el.getAttribute && el.getAttribute("data-testid");
    if (tid) return { kind: "testid", value: tid };
    var role = el.getAttribute("role") || implicitRole(el);
    var name = (el.getAttribute("aria-label") || el.innerText || el.value || el.title || "").trim().replace(/\\s+/g, " ").slice(0, 60);
    if (role && name) return { kind: "role", role: role, name: name };
    if (el.placeholder) return { kind: "placeholder", value: el.placeholder };
    if (name) return { kind: "text", value: name };
    return { kind: "css", value: cssPath(el) };
  }

  function step(s){ try { parent.postMessage({ type: "qa-rec-step", step: s }, "*"); } catch(e){} }

  /*
   * IDDIA MODU. Kaydedici yalnizca EYLEM yakaliyordu (click/fill/press) —
   * boyle bir dosya script'tir, test degildir: locator kirilmadikca her zaman
   * gecer, urun yanlis davransa bile. Iddia modunda tiklama bir eylem degil,
   * bir DOGRULAMA olarak kaydedilir.
   *
   * Kritik ayrinti: modda tiklama YUTULUR (preventDefault + stopPropagation).
   * Yoksa iddia bırakmak icin tikladigin link seni sayfadan goturur.
   */
  var ASSERT = false;
  var styleEl = null;
  function setAssert(on){
    ASSERT = !!on;
    if (ASSERT && !styleEl) {
      styleEl = document.createElement("style");
      styleEl.textContent = "*{cursor:crosshair!important}"
        + "[data-qa-assert-hover]{outline:2px solid #f59e0b!important;outline-offset:1px!important;"
        + "background:rgba(245,158,11,.12)!important}";
      document.head.appendChild(styleEl);
    } else if (!ASSERT && styleEl) {
      styleEl.remove(); styleEl = null;
      var prev = document.querySelector("[data-qa-assert-hover]");
      if (prev) prev.removeAttribute("data-qa-assert-hover");
    }
  }

  document.addEventListener("mouseover", function(e){
    if (!REC || !ASSERT) return;
    var prev = document.querySelector("[data-qa-assert-hover]");
    if (prev) prev.removeAttribute("data-qa-assert-hover");
    var el = target(e.target);
    if (el && el !== document.documentElement) el.setAttribute("data-qa-assert-hover", "1");
  }, true);

  document.addEventListener("click", function(e){
    if (!REC) return;
    var el = target(e.target);
    if (!el || el === document.documentElement) return;
    if (ASSERT) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var txt = (el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 80);
      /* Metin varsa ve kisa ise metin iddiasi; yoksa gorunurluk iddiasi.
         Tek kural — hangi iddianin cikacagi tahmin edilebilir olsun. */
      step({ action: "assert", loc: locator(el), value: txt, at: Date.now() });
      return;
    }
    step({ action: "click", loc: locator(el), tag: el.tagName.toLowerCase(), at: Date.now() });
  }, true);

  document.addEventListener("change", function(e){
    if (!REC || ASSERT) return;
    var el = e.target;
    if (!el || !/^(input|select|textarea)$/i.test(el.tagName)) return;
    var ty = (el.type || "").toLowerCase();
    if (ty === "checkbox" || ty === "radio") {
      step({ action: el.checked ? "check" : "uncheck", loc: locator(el), at: Date.now() });
    } else {
      step({ action: "fill", loc: locator(el), value: String(el.value ?? "").slice(0, 120), at: Date.now() });
    }
  }, true);

  document.addEventListener("keydown", function(e){
    if (!REC || ASSERT) return;
    if (e.key === "Enter") step({ action: "press", key: "Enter", loc: locator(target(e.target)), at: Date.now() });
  }, true);
})();</script></head>`,
        );
        res.writeHead(upstreamRes.status, out);
        res.end(injected);
        return;
      }

      res.writeHead(upstreamRes.status, out);
      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Proxy hatasi: ${e?.message ?? e}`);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, url: selfOrigin }));
  });
}
