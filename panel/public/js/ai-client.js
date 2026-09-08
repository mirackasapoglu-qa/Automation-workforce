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
    if (AI_STATUS.mode === "cli") return "Panel makinedeki Claude Code CLI'sini çağırır (kullanıcının oturumu, ~15-40 sn)";
    return "Tek tık kapalı: ANTHROPIC_API_KEY ver ya da Claude Code CLI kur";
  }

  /** Tek tik onayi: yol + maliyet uyarisi tek yerden. */
  async function aiOnay(ne) {
    const b = AI_STATUS.budget;
    const yol = AI_STATUS.mode === "api"
      ? `${AI_STATUS.model} ile API anahtarı üzerinden (ücretli${b?.capUsd ? `, bugün $${b.usd.toFixed(2)} / $${b.capUsd.toFixed(2)}` : ""})`
      : "makinedeki Claude Code CLI ile (kullanıcının oturumu)";
    return uiConfirm(`${ne}\n\nYol: ${yol}, ~15-40 sn.`, { title: "Tek tıkla üret", ok: "Üret", danger: false });
  }

  /** Uretim hatasini tek bicimde goster. */
  function aiHata(d, hedefState) {
    const msg = `${d.error || "Üretilemedi."}${d.hint ? `\n${d.hint}` : ""}`;
    if (hedefState) { hedefState.className = "mono err"; hedefState.textContent = d.error || "üretilemedi"; }
    uiToast(msg, { type: "err", title: d.code === "NO_PROVIDER" ? "Tek tık kapalı" : "Üretilemedi" });
  }

  function aiSonucSatiri(d) {
    const cache = d.cache?.read ? ` · önbellek ${d.cache.read} tok` : "";
    return `${(d.ms / 1000).toFixed(1)} sn${d.cost != null ? ` · $${Number(d.cost).toFixed(3)}` : ""}${d.model ? ` · ${d.model}` : ""}${d.retrieval?.chunks ? ` · ${d.retrieval.chunks} repo parçası` : ""}${cache}`;
  }

  /** Perf: tek tikla yorum (olcum sunucuda okunur, bulgular kapidan gecer). */
  async function perfGenerate() {
    if (!await aiOnay("Son perf ölçümü modele yorumlatılacak; uydurma rota içeren bulgular kapıda elenir.")) return;
    const btn = $("#paBtn"); const one = $("#paOneBtn");
    btn.disabled = true; if (one) one.disabled = true;
    $("#paState").textContent = "model çalışıyor…";
    $("#paOut").innerHTML = ""; $("#paFlow").innerHTML = "";
    try {
      const d = await post("/api/perf/generate", {});
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
    if (!await aiOnay(`"${request.slice(0, 80)}${request.length > 80 ? "…" : ""}" için en fazla ${limit} senaryo önerilecek; dayanaksız olanlar kapıda elenir.`)) return;
    const btn = $("#sgBtn"); const one = $("#sgOneBtn");
    btn.disabled = true; if (one) one.disabled = true;
    $("#sgState").textContent = "model çalışıyor…";
    $("#sgOut").innerHTML = ""; $("#sgFlow").innerHTML = "";
    try {
      const d = await post("/api/scenarios/generate", { request, limit });
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
})();
