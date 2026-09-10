/**
 * AI istemci kodu — tek tik uretim (perf yorumu, senaryo, kart) icin ortak parcalar.
 *
 * Klasik script, global: `index.html`'deki `onclick="perfGenerate()"` gibi
 * cagrilar ve `cardGenOneClick` (Jira karti, orada kaldi) bu adlara bakiyor.
 * Sunucudaki karsiligi `panel/routes/ai.mjs`.
 *
 * Kullandigi globaller (index.html satir ici script'te tanimli): `$`, `post`,
 * `esc`, `renderPerfFindings`, `renderScenarios`; `uiToast`/`uiConfirm` dialogs.js'ten.
 * Cagri aninda cozulur — yukleme sirasi onemli degil, tanimli olmalari yeter.
 */
(function () {
  /** Sunucu hangi yolu kullaniyor: api (ANTHROPIC_API_KEY) · cli (yerel Claude Code) · manual. */
  let AI_STATUS = { mode: "manual", oneClick: false };

  async function loadAiStatus() {
    try {
      AI_STATUS = await (await fetch("/api/ai/status")).json();
    } catch {
      AI_STATUS = { mode: "manual", oneClick: false };
    }
    document.querySelectorAll("[data-ai-oneclick]").forEach((el) => {
      el.hidden = !AI_STATUS.oneClick;
      el.title = aiYolMetni();
    });
    return AI_STATUS;
  }

  function aiYolMetni() {
    if (AI_STATUS.mode === "api") return `Panel modeli kendisi çağırır: ${AI_STATUS.model} (API anahtarı, ücretli)`;
    if (AI_STATUS.mode === "cli") {
      const n = (AI_STATUS.accounts ?? []).length;
      return n
        ? `Panel, eklenen Claude hesabıyla çağırır (${n} hesap; üretimde seçersin, ~15-40 sn)`
        : "Panel bu makinedeki Claude Code oturumunu kullanır (~15-40 sn)";
    }
    return "Tek tık kapalı: Bağlantılar → Claude kartından hesap ekle ya da ANTHROPIC_API_KEY ver";
  }

  /**
   * Hangi Claude hesabıyla koşulacak. Tarayıcı hatırlar (kişi kendi
   * aboneliğini seçer); silinmiş hesap hatırlanmışsa ilk hesaba döner.
   * ⚠️ Panel hesaplar arasında OTOMATİK GEÇMEZ — limit dolunca seçim insana kalır.
   */
  const ACCOUNT_KEY = "qa-panel-ai-account";
  function aiAccount() {
    const list = AI_STATUS.accounts ?? [];
    if (!list.length) return null;
    let saved = null;
    try { saved = localStorage.getItem(ACCOUNT_KEY); } catch { saved = null; }
    return list.some((a) => a.id === saved) ? saved : list[0].id;
  }
  function aiAccountSet(id) {
    try { if (id) localStorage.setItem(ACCOUNT_KEY, id); } catch { /* ozel pencere */ }
  }
  const aiAccountLabel = (id) => (AI_STATUS.accounts ?? []).find((a) => a.id === id)?.label ?? id;

  /**
   * Tek tik onayi: yol + maliyet uyarisi tek yerden. Birden fazla Claude hesabi
   * varsa onay kutusu ayni anda hesap secicisidir.
   * @returns {Promise<{ok:boolean, account:string|null}>}
   */
  async function aiOnay(ne) {
    const b = AI_STATUS.budget;
    const list = AI_STATUS.accounts ?? [];
    if (AI_STATUS.mode === "cli" && list.length > 1) {
      const secili = await uiChoose(
        `${ne}\n\nHangi Claude hesabıyla koşulsun? (~15-40 sn)`,
        list.map((a) => ({ value: a.id, label: `${a.label}${a.expired ? " · süresi dolmuş" : ""}` })),
        { title: "Tek tıkla üret", ok: "Üret", value: aiAccount() },
      );
      if (!secili) return { ok: false, account: null };
      aiAccountSet(secili);
      return { ok: true, account: secili };
    }
    const yol = AI_STATUS.mode === "api"
      ? `${AI_STATUS.model} ile API anahtarı üzerinden (ücretli${b?.capUsd ? `, bugün $${b.usd.toFixed(2)} / $${b.capUsd.toFixed(2)}` : ""})`
      : list.length === 1
        ? `"${list[0].label}" Claude hesabıyla`
        : "makinedeki Claude Code CLI ile (bu makinenin oturumu)";
    const ok = await uiConfirm(`${ne}\n\nYol: ${yol}, ~15-40 sn.`, { title: "Tek tıkla üret", ok: "Üret", danger: false });
    return { ok, account: aiAccount() };
  }

  /** Uretim hatasini tek bicimde goster. */
  function aiHata(d, hedefState) {
    const msg = `${d.error || "Üretilemedi."}${d.hint ? `\n${d.hint}` : ""}`;
    if (hedefState) { hedefState.className = "mono err"; hedefState.textContent = d.error || "üretilemedi"; }
    uiToast(msg, { type: "err", title: d.code === "NO_PROVIDER" ? "Tek tık kapalı" : "Üretilemedi" });
  }

  function aiSonucSatiri(d) {
    const cache = d.cache?.read ? ` · önbellek ${d.cache.read} tok` : "";
    const hesap = d.account?.label ? ` · ${d.account.label}` : "";
    return `${(d.ms / 1000).toFixed(1)} sn${d.cost != null ? ` · $${Number(d.cost).toFixed(3)}` : ""}${d.model ? ` · ${d.model}` : ""}${hesap}${d.retrieval?.chunks ? ` · ${d.retrieval.chunks} repo parçası` : ""}${cache}`;
  }

  /** Perf: tek tikla yorum (olcum sunucuda okunur, bulgular kapidan gecer). */
  async function perfGenerate() {
    const onay = await aiOnay("Son perf ölçümü modele yorumlatılacak; uydurma rota içeren bulgular kapıda elenir.");
    if (!onay.ok) return;
    const btn = $("#paBtn"); const one = $("#paOneBtn");
    btn.disabled = true; if (one) one.disabled = true;
    $("#paState").textContent = "model çalışıyor…";
    $("#paOut").innerHTML = ""; $("#paFlow").innerHTML = "";
    try {
      const d = await post("/api/perf/generate", { account: onay.account });
      if (!d.ok) { aiHata(d, $("#paState")); if (d.code === "NO_PROVIDER") await loadAiStatus(); return; }
      renderPerfFindings(d);
      $("#paState").textContent = `${d.findings.length} bulgu${d.dropped?.length ? `, ${d.dropped.length} kapıda elendi` : ""} · ${aiSonucSatiri(d)}`;
    } finally {
      btn.disabled = false; if (one) one.disabled = false;
    }
  }

  /** Senaryo: tek tikla oneri (ayni 3 katmanli kapi). */
  async function scenarioGenerate() {
    const request = $("#sgReq").value.trim();
    if (!request) { $("#sgState").textContent = "istek metni gerekli"; return; }
    const limit = Number($("#sgLimit").value);
    const onay = await aiOnay(`"${request.slice(0, 80)}${request.length > 80 ? "…" : ""}" için en fazla ${limit} senaryo önerilecek; dayanaksız olanlar kapıda elenir.`);
    if (!onay.ok) return;
    const btn = $("#sgBtn"); const one = $("#sgOneBtn");
    btn.disabled = true; if (one) one.disabled = true;
    $("#sgState").textContent = "model çalışıyor…";
    $("#sgOut").innerHTML = ""; $("#sgFlow").innerHTML = "";
    try {
      const d = await post("/api/scenarios/generate", { request, limit, account: onay.account });
      if (!d.ok) {
        if (d.code === "NO_ORACLE") { $("#sgState").textContent = ""; $("#sgOut").innerHTML = `<div class="sg-warn"><p>${esc(d.error)}</p></div>`; return; }
        aiHata(d, $("#sgState")); if (d.code === "NO_PROVIDER") await loadAiStatus(); return;
      }
      renderScenarios(d);
      const a = d.audit || {};
      $("#sgState").textContent = `${a.accepted ?? 0} kabul${a.droppedNoOracle?.length ? `, ${a.droppedNoOracle.length} dayanaksız` : ""}${a.rejectedByContext?.length ? `, ${a.rejectedByContext.length} bağlam dışı` : ""} · ${aiSonucSatiri(d)}`;
    } finally {
      btn.disabled = false; if (one) one.disabled = false;
    }
  }

  // Global yuzey — index.html bunlara adla bakiyor.
  Object.defineProperty(window, "AI_STATUS", { get: () => AI_STATUS, configurable: true });
  window.loadAiStatus = loadAiStatus;
  window.aiYolMetni = aiYolMetni;
  window.aiOnay = aiOnay;
  window.aiHata = aiHata;
  window.aiSonucSatiri = aiSonucSatiri;
  window.perfGenerate = perfGenerate;
  window.scenarioGenerate = scenarioGenerate;
  window.aiAccount = aiAccount;
  window.aiAccountLabel = aiAccountLabel;
})();
