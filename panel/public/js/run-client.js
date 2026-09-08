/**
 * Kosum istemci kodu — /api/run cagrilarinin TEK gecidi.
 *
 * Sunucu `requestId` ile idempotent ve `queue:true` ile sirali calisiyordu ama
 * arayuz bunlari GONDERMIYORDU (olculdu 2026-09-08: cift tik hala 409 aliyordu).
 * Burada:
 *  - requestId = kosum + parametre + 5 sn'lik zaman kovasi → ayni dugmeye ust
 *    uste basmak AYNI istegi tekrarlar, sunucu ilk sonucu doner (deduped).
 *  - 409 BUSY gelirse kullaniciya "siraya al?" sorulur; evet → ayni istek
 *    `queue:true` ile tekrar gider.
 *  - `stopRun()` Genel Bakis'taki "durdur" dugmesi icin (eskiden tanimsizdi).
 *
 * Klasik script, global. Kullandigi globaller: `post`, `uiToast`, `uiConfirm`.
 */
(function () {
  const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

  function runIdempotencyKey(body) {
    const bucket = Math.floor(Date.now() / 5000);
    return `${body.id}:${hash(JSON.stringify(body.params ?? null))}:${body.headless ? "h" : "v"}:${bucket}`;
  }

  /**
   * @param {{id:string, params?:object, headless?:boolean, record?:boolean}} body
   * @param {{label?:string, offerQueue?:boolean}} [opt]
   * @returns {Promise<object>} sunucu yaniti (ok/queued/deduped/error)
   */
  async function runRequest(body, opt = {}) {
    const requestId = runIdempotencyKey(body);
    const r = await post("/api/run", { ...body, requestId });
    if (r.ok) {
      if (r.deduped) uiToast("Aynı istek zaten başlatıldı; ikinci kez başlatılmadı.", { type: "info", ms: 4000 });
      if (r.queued) uiToast(`Sıraya alındı (${r.position}.). Süren koşum bitince başlar.`, { type: "ok" });
      return r;
    }
    if (r.code === "BUSY" && opt.offerQueue !== false) {
      const ne = opt.label || body.id;
      const ok = await uiConfirm(
        `Şu an "${r.active?.label ?? r.active?.id ?? "bir koşum"}" koşuyor.\n"${ne}" o bitince sıraya alınsın mı?`,
        { title: "Koşum meşgul", ok: "Sıraya al", cancel: "Vazgeç", danger: false },
      );
      if (!ok) return r;
      const q = await post("/api/run", { ...body, requestId: `${requestId}:q`, queue: true });
      if (q.ok) uiToast(`Sıraya alındı (${q.position}.). Süren koşum bitince başlar.`, { type: "ok" });
      else uiToast(q.error || "Sıraya alınamadı.", { type: "err" });
      return q;
    }
    return r;
  }

  /** Genel Bakis satirindaki "durdur": suren kosum + sira. */
  async function stopRun() {
    const r = await post("/api/stop");
    if (!r.ok) uiToast(r.error || "Durdurulamadı.", { type: "err", title: "Koşum" });
    else uiToast(`Koşum durduruluyor${r.cleared ? `, sıradaki ${r.cleared} koşum iptal edildi` : ""}.`, { type: "info" });
    return r;
  }

  window.runRequest = runRequest;
  window.runIdempotencyKey = runIdempotencyKey;
  window.stopRun = stopRun;
})();
