/**
 * Bağlantı uçları — sağlayıcı kayıt defterinin HTTP yüzü.
 *
 *   POST /api/connectors/use                      yetenek → sağlayıcı eşlemesi; token
 *   POST /api/connectors/cut                      kopar / geri bağla; token
 *   POST /api/connectors/<key>/credentials        panelden kimlik gir → kaydet → DOĞRULA; token
 *   POST /api/connectors/<key>/credentials/remove panel kaydını sil; token
 *   GET  /api/oauth/<svc>/start?t=<panel token>   izin ekranına 302 (tarayıcı navigasyonu)
 *   GET  /api/oauth/callback                      sağlayıcıdan dönüş → token depoya
 *   POST /api/oauth/<svc>/client                  tek seferlik uygulama kaydı; token
 *   POST /api/oauth/<svc>/disconnect              OAuth token'ını sil; token
 *
 * KİMLİK KAYDI KURALI: yazılan değer denetim kaydına DÜŞMEZ (yalnız değişken
 * adları). Kaydettikten sonra sağlayıcının `check()`i çağrılır; "off" dönerse
 * kayıt geri alınır — yanlış token panelde bağlıymış gibi durmaz. Ortam
 * değişkeni verilmişse panel kaydı onu EZEMEZ (öncelik ortamda); kullanıcıya
 * bu söylenir, sessizce görmezden gelinmez.
 *
 * OAuth `/start` token'ı query'de alır: tarayıcı navigasyonu başlık gönderemez.
 * Sebep CSRF'ten fazlası: panel açık bir domainde durursa yabancı biri akışı
 * başlatıp KENDİ hesabını panele bağlayabilirdi.
 */
import * as store from "../auth/credential-store.mjs";
import * as oauth2 from "../auth/oauth2.mjs";
import { ALL, setCapability, setConnectorCut, invalidatePreflight } from "../connectors/index.mjs";
import { isCut } from "../connectors/cuts.mjs";

const KEY_RE = /^[a-z0-9-]+$/;

export function registerConnectorRoutes(router, ctx) {
  const { send, audit, DATA_DIR, panelToken, publicOriginFor } = ctx;
  const provider = (key) => (KEY_RE.test(String(key)) ? ALL[key] ?? null : null);
  const cfgFor = (svc) => provider(svc)?.auth?.oauth2 ?? null;

  router.post("/api/connectors/use", ({ res, body }) => {
    try {
      const out = setCapability(body.capability, body.connector ?? null);
      audit({ kind: "connectors/use", capability: String(body.capability), connector: String(body.connector) });
      return send(res, 200, out);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/connectors/cut", ({ res, body }) => {
    try {
      const out = setConnectorCut(String(body.key ?? ""), Boolean(body.cut));
      audit({ kind: "connectors/cut", connector: String(body.key), cut: Boolean(body.cut) });
      return send(res, 200, out);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  // ---- panelden kimlik: /api/connectors/<key>/credentials[/remove]
  router.prefix("POST", "/api/connectors/", async ({ res, rest, body }) => {
    const m = /^([a-z0-9-]+)\/credentials(\/remove)?$/.exec(rest);
    if (!m) return send(res, 404, { ok: false, error: `Bilinmeyen uc: /api/connectors/${rest}` });
    const key = m[1];
    const p = provider(key);
    if (!p) return send(res, 404, { ok: false, error: `Bilinmeyen sağlayıcı: ${key}` });

    if (m[2]) {
      const out = store.remove(key);
      invalidatePreflight(key);
      audit({ kind: "connectors/credentials-removed", connector: key, removed: out.removed });
      return send(res, 200, { ok: true, ...out });
    }

    const ak = p.auth?.apiKey;
    if (!ak) return send(res, 400, { ok: false, error: `${p.label} panelden kimlik almıyor (kimlik ortamdan ya da yerel köprüden gelir).` });
    const vars = {};
    for (const v of ak.vars) {
      const val = String(body?.vars?.[v.name] ?? "").trim();
      if (!val) return send(res, 400, { ok: false, error: `${v.label ?? v.name} zorunlu`, field: v.name });
      vars[v.name] = val;
    }
    const envSet = ak.vars.map((v) => v.name).filter((n) => process.env[n]);
    if (envSet.length) {
      return send(res, 409, {
        ok: false, code: "ENV_WINS",
        error: `Bu değerler ortam değişkeninden geliyor (${envSet.join(", ")}); panel kaydı onları ezemez. Sunucuda env'i değiştir ya da kaldır.`,
      });
    }

    if (isCut(key)) setConnectorCut(key, false); // "bağlan" demek "kullan" demek
    const prev = store.stored(key);
    store.save(key, { kind: "apiKey", vars });
    invalidatePreflight(key);
    /*
     * DOĞRULAMA: sağlayıcı `probe()` sunuyorsa o (ağa çıkmayan Figma gibi
     * "kimlik var, kota yüzünden çağrı yok" diyebilir); yoksa `check()` ve
     * yalnız `ok`/`unknown` kabul. `warn` de RED: Jira 401'i "token eskimiş
     * olabilir" diye warn veriyor, sahte kimlik bununla kabul edilmişti (ölçüldü).
     */
    let ok = false;
    let detail = "";
    try {
      if (typeof p.probe === "function") {
        const r = await p.probe();
        ok = Boolean(r?.ok);
        detail = String(r?.detail ?? "");
      } else {
        const r = await p.check();
        ok = r.state === "ok" || r.state === "unknown";
        detail = String(r.detail ?? "");
      }
    } catch (e) {
      ok = false;
      detail = String(e.message);
    }
    if (!ok) {
      // Eski kayıt geri gelsin: yanlış bir denemenin çalışan bağlantıyı bozması yanlış.
      if (prev) store.save(key, prev); else store.remove(key);
      invalidatePreflight(key);
      audit({ kind: "connectors/credentials-rejected", connector: key, vars: Object.keys(vars), detail: detail.slice(0, 120) });
      return send(res, 400, { ok: false, code: "VERIFY_FAILED", error: `Doğrulanamadı: ${detail}`, fix: p.setupFix ?? [] });
    }
    audit({ kind: "connectors/credentials-saved", connector: key, vars: Object.keys(vars) });
    return send(res, 200, { ok: true, state: "ok", detail, source: "store" });
  }, { auth: true, body: true });

  // ---- OAuth
  router.get("/api/oauth/callback", async ({ req, res, url }) => {
    const page = (baslik, govde, iyi) => {
      res.writeHead(iyi ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(`<!doctype html><meta charset="utf-8"><title>${baslik}</title>`
        + `<style>body{font:14px/1.5 system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f7f7f8;color:#18181b}`
        + `.k{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:22px 26px;max-width:520px}`
        + `b{color:${iyi ? "#15803d" : "#b91c1c"}}code{background:#f4f4f5;padding:1px 5px;border-radius:4px;word-break:break-all}`
        + `a{color:#5b5bd6}</style>`
        + `<div class="k"><p><b>${baslik}</b></p><p>${govde}</p><p><a href="/">← QA Paneli'ne dön</a></p></div>`);
    };
    try {
      const r = await oauth2.handleCallback({ dataDir: DATA_DIR, query: url.searchParams, origin: publicOriginFor(req), cfgFor });
      invalidatePreflight(r.svc);
      audit({ kind: "oauth/connected", service: r.svc, expiresAt: r.expiresAt });
      return page(`${r.label} bağlandı`, "Token panele kaydedildi; süresi dolmadan kendiliğinden yenilenir. Bu sekmeyi kapatabilirsin.", true);
    } catch (e) {
      return page("Bağlanamadı", `<code>${String(e.message).replace(/</g, "&lt;")}</code>`, false);
    }
  });

  router.prefix("GET", "/api/oauth/", ({ req, res, rest, url }) => {
    const m = /^([a-z0-9-]+)\/start$/.exec(rest);
    if (!m) return send(res, 404, { ok: false, error: `Bilinmeyen uc: /api/oauth/${rest}` });
    const svc = m[1];
    if (url.searchParams.get("t") !== panelToken) {
      return send(res, 403, { code: "STALE_TOKEN", error: "Panel token gerekli (baglanti akisi panelden baslatilir)." });
    }
    const cfg = cfgFor(svc);
    if (!cfg) return send(res, 400, { ok: false, error: `${svc}: OAuth desteklemiyor` });
    try {
      const origin = publicOriginFor(req);
      const to = oauth2.authorizeUrl({ dataDir: DATA_DIR, svc, cfg, origin });
      audit({ kind: "oauth/start", service: svc, origin });
      res.writeHead(302, { location: to, "cache-control": "no-store" });
      return res.end();
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  });

  router.prefix("POST", "/api/oauth/", ({ res, rest, body }) => {
    const m = /^([a-z0-9-]+)\/(client|disconnect)$/.exec(rest);
    if (!m) return send(res, 404, { ok: false, error: `Bilinmeyen uc: /api/oauth/${rest}` });
    const [, svc, op] = m;
    if (!cfgFor(svc)) return send(res, 400, { ok: false, error: `${svc}: OAuth desteklemiyor` });
    try {
      if (op === "client") {
        const out = oauth2.saveClientCreds(DATA_DIR, svc, body.clientId, body.clientSecret);
        audit({ kind: "oauth/client-saved", service: svc });
        return send(res, 200, out);
      }
      const out = store.remove(svc);
      invalidatePreflight(svc);
      audit({ kind: "oauth/disconnect", service: svc });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });
}
