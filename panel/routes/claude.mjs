/**
 * Claude hesap uçları — kişi başına abonelik kimliği.
 *
 *   GET  /api/claude/accounts              liste (TOKEN YOK) + relay + suren akislar
 *   POST /api/claude/accounts/login/start  {label} → {loginId, url}  (panelden giriş)
 *   POST /api/claude/accounts/login/code   {loginId, code} → {id,label}
 *   POST /api/claude/accounts/login/cancel {loginId}
 *   POST /api/claude/accounts              {label, token} → yapıştırma yolu
 *   POST /api/claude/accounts/rename       {id, label}
 *   POST /api/claude/accounts/remove       {id}
 *
 * ⚠️ TOKEN HİÇBİR YANITTA VE HİÇBİR DENETİM KAYDINDA GEÇMEZ. Kayda yalnızca
 * hesabın etiketi ve id'si düşer; liste `tokenTail` ile son dört haneyi gösterir
 * (kişi hangi token'ı eklediğini ayırt edebilsin diye).
 *
 * Giriş akışı iki adımdır ve ikisi de AYNI SÜREÇTE olmak zorunda: PKCE
 * doğrulayıcısı `claude setup-token` sürecinin belleğinde. Bekleyen akış
 * 10 dk sonra düşer; sunucu yeniden başlarsa akış kaybolur ("yeniden başlat").
 */
import * as accounts from "../auth/claude-accounts.mjs";
import { cliBinary } from "../ai/provider.mjs";
import { invalidatePreflight } from "../connectors/index.mjs";

const httpFor = (code) => ({
  NO_RELAY: 501, BUSY: 429, NO_URL: 502, EXPIRED: 410, TIMEOUT: 504, CLI_EXIT: 502,
  BAD_CODE: 400, BAD_INPUT: 400, BAD_TOKEN: 400, DUPLICATE: 409, NOT_FOUND: 404,
}[code] ?? 400);

export function registerClaudeRoutes(router, ctx) {
  const { send, audit } = ctx;
  // `alive`: akis hala ayakta mi — arayuz kod kutusunu kapatsin mi karar verir.
  const fail = (res, e) => send(res, httpFor(e.code), {
    ok: false, code: e.code ?? null, error: e.message, alive: e.alive ?? null,
  });

  router.get("/api/claude/accounts", ({ res }) => send(res, 200, {
    ok: true,
    accounts: accounts.list(),
    relay: accounts.relaySupported({ claudeBin: cliBinary() }),
    cli: cliBinary(),
    pending: accounts.pendingCount(),
    logins: accounts.pendingList(),
  }));

  router.prefix("POST", "/api/claude/accounts", async ({ res, rest, body }) => {
    try {
      switch (rest) {
        case "":
        case "/": {
          // Yapistirma yolu: kisi kendi makinesinde `claude setup-token` kosmus.
          const out = accounts.save({ label: body.label, token: body.token, source: "paste" });
          invalidatePreflight("claude-code");
          audit({ kind: "claude/account-added", id: out.id, label: out.label, source: "paste" });
          return send(res, 200, { ok: true, ...out });
        }
        case "/login/start": {
          const out = await accounts.startLogin({ label: body.label, claudeBin: cliBinary() });
          audit({ kind: "claude/login-start", loginId: out.loginId, label: String(body.label ?? "").slice(0, 60) });
          return send(res, 200, { ok: true, ...out });
        }
        case "/login/code": {
          const out = await accounts.submitCode(body.loginId, body.code);
          invalidatePreflight("claude-code");
          audit({ kind: "claude/account-added", id: out.id, label: out.label, source: "relay" });
          return send(res, 200, { ok: true, ...out });
        }
        case "/login/cancel": {
          const out = accounts.cancelLogin(body.loginId);
          audit({ kind: "claude/login-cancel", loginId: String(body.loginId ?? "").slice(0, 40) });
          return send(res, 200, out);
        }
        case "/rename": {
          const out = accounts.rename(body.id, body.label);
          audit({ kind: "claude/account-renamed", id: out.id, label: out.label });
          return send(res, 200, { ok: true, ...out });
        }
        case "/remove": {
          const out = accounts.remove(body.id);
          invalidatePreflight("claude-code");
          audit({ kind: "claude/account-removed", id: String(body.id ?? "").slice(0, 40) });
          return send(res, 200, out);
        }
        default:
          return send(res, 404, { ok: false, error: `Bilinmeyen uc: /api/claude/accounts${rest}` });
      }
    } catch (e) {
      return fail(res, e);
    }
  }, { auth: true, body: true });
}
