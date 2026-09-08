/**
 * Panel arayüzünün ayrı JS dosyaları — `panel/public/js/*.js`.
 *
 * `index.html` tek dosyaydı; diyalog ve AI/koşum istemci kodu buradan ayrı
 * servis ediliyor. Yol kontrolü diğer statik uçlarla aynı: normalize sonrası
 * kök kontrolü + uzantı beyaz listesi (yalnız .js). Uzun süreli önbellek YOK:
 * dosyalar içerik-hash'siz, deploy sonrası eski JS tarayıcıda kalmasın.
 */
import fs from "node:fs";
import path from "node:path";

export function registerAssetRoutes(router, { send, publicDir }) {
  const root = path.join(publicDir, "js");
  router.prefix("GET", "/js/", ({ res, rest }) => {
    const file = path.normalize(path.join(root, rest));
    if (!file.startsWith(root + path.sep)) return send(res, 403, { error: "yol reddedildi" });
    if (path.extname(file) !== ".js") return send(res, 403, { error: "yalniz .js" });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: "yok" });
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    return res.end(fs.readFileSync(file));
  });
}
