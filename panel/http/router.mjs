/**
 * Yönlendirici — `server.mjs`'teki tek dev `if (p === "...")` zincirinin yerine.
 *
 * NEDEN: 3.000 satırlık tek işleyicide her uç kendi başına `requireAuth` ve
 * `readBody` çağırıyordu; birini unutmak sessiz bir güvenlik deliği demekti ve
 * "hangi uçlar token istiyor" sorusunun cevabı hiçbir yerde durmuyordu.
 * Burada bunlar KAYIT SIRASINDA bildirilir:
 *
 *     router.post("/api/run", handler, { auth: true, body: true });
 *
 * `auth:true` → `ctx.requireAuth` geçmeden handler çağrılmaz;
 * `body:true` → JSON gövde okunup `body` olarak verilir (üst sınır ve bozuk
 * JSON eşlemesi `readBody`'de ve dış try/catch'te, burada değil).
 * `list()` ile tüm uçlar ve koruma durumları makine tarafından okunabilir.
 *
 * Handler imzası: `({ req, res, url, body, path, rest, ...ctx }) => void|Promise`.
 * `ctx` sunucunun paylaşılan bağlamı (send, audit, engine, ...); rota modülleri
 * `server.mjs`'in kapanış değişkenlerine DEĞİL buna bağımlı — test edilebilir.
 *
 * Eşleşme: önce tam yol + metod, sonra önek (`prefix`). Yol biliniyor ama
 * metod değilse 405 — 404 "bilinmeyen uç" demek yanlış tanı koydurur.
 */
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

export function createRouter() {
  const exact = new Map();
  const knownPaths = new Set();
  const prefixes = [];

  function add(method, path, handler, opts = {}) {
    if (!METHODS.has(method)) throw new Error(`geçersiz metod: ${method}`);
    if (typeof path !== "string" || !path.startsWith("/")) throw new Error(`geçersiz yol: ${path}`);
    if (typeof handler !== "function") throw new Error(`handler fonksiyon olmalı: ${method} ${path}`);
    const key = `${method} ${path}`;
    if (exact.has(key)) throw new Error(`rota iki kez kaydedildi: ${key}`);
    exact.set(key, { method, path, handler, opts });
    knownPaths.add(path);
  }

  return {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    put: (p, h, o) => add("PUT", p, h, o),
    del: (p, h, o) => add("DELETE", p, h, o),

    /** Önek eşleşmesi (statik dosya servisi gibi). `rest` = önekten sonrası. */
    prefix(method, prefix, handler, opts = {}) {
      if (!METHODS.has(method)) throw new Error(`geçersiz metod: ${method}`);
      if (typeof handler !== "function") throw new Error(`handler fonksiyon olmalı: ${method} ${prefix}*`);
      prefixes.push({ method, prefix, handler, opts });
    },

    /** Kayıtlı uçlar — teşhis ve belge için. */
    list() {
      return [...exact.values()].map((r) => ({
        method: r.method, path: r.path, auth: Boolean(r.opts.auth), body: Boolean(r.opts.body),
      }));
    },

    /**
     * İsteği eşleşen handler'a verir.
     * @returns {Promise<boolean>} true = bu router cevapladı (405 dahil)
     */
    async dispatch(req, res, ctx) {
      const p = ctx.url.pathname;
      let hit = exact.get(`${req.method} ${p}`);
      let rest = "";
      if (!hit) {
        const pre = prefixes.find((x) => x.method === req.method && p.startsWith(x.prefix));
        if (pre) { hit = pre; rest = p.slice(pre.prefix.length); }
      }
      if (!hit) {
        if (knownPaths.has(p)) {
          ctx.send(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", error: `${req.method} bu uçta yok: ${p}` });
          return true;
        }
        return false;
      }
      if (hit.opts.auth && !ctx.requireAuth(req, res)) return true;
      const body = hit.opts.body ? await ctx.readBody(req) : undefined;
      await hit.handler({ ...ctx, req, res, body, path: p, rest });
      return true;
    },
  };
}
