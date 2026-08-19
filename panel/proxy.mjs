/**
 * Homee QA Paneli — site proxy'si (panel içinde canlı iframe için)
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
 * Sitenin API'si (`ecom-api.test.tepehome.com.tr`) `access-control-allow-origin: *`
 * döndüğü için iframe içinden sepet/login çağrıları da çalışır — ölçüldü.
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
  function ping(){ try { parent.postMessage({ type:"homee-nav", href: location.href, path: location.pathname + location.search, title: document.title }, "*"); } catch(e){} }
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
    try { parent.postMessage({ type:"homee-scroll", y: y,
      h: document.documentElement.scrollHeight, vh: window.innerHeight }, "*"); } catch(e){}
  }
  addEventListener("scroll", function(){ var n = Date.now(); if (n - t > 80) { t = n; pingScroll(); } }, { passive: true });
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
