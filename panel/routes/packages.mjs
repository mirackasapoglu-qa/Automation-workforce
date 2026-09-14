/**
 * Paketler uçları.
 *
 *   GET /api/scope/packages  — tüm paketler (açık, ağacın GET'i gibi)
 *   PUT /api/scope/packages  — tümünü değiştirir; istemci tam listeyi gönderir
 *                              (tree.json'ın PUT'uyla aynı desen — parça
 *                              güncelleme yok, her persist() tüm diziyi yazar)
 *
 * Sunucu içeriği doğrulamaz: hangi nodeId/testCaseId'nin ağaçta gerçekten
 * var olduğu istemcide çözülür (bkz. panel/public/scope/js/packages.js).
 */
import { readPackages, writePackages } from "../packages.mjs";

export function registerPackagesRoutes(router, ctx) {
  const { send, audit } = ctx;

  router.get("/api/scope/packages", ({ res }) => {
    return send(res, 200, { packages: readPackages() });
  });

  router.put("/api/scope/packages", ({ res, body }) => {
    const info = writePackages(body.packages);
    audit({ event: "scope-packages-save", count: info.count });
    return send(res, 200, { ok: true, ...info });
  }, { auth: true, body: true });
}
