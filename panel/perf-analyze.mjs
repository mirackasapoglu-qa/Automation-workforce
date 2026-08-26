/**
 * Perf ölçümünü modele yorumlatır — **anahtarsız yol.**
 *
 * NEDEN: panel modeli kendisi çağırdığı sürece ikinci bir kimlik istiyordu.
 * Artık iki ucu üstlenir: buildPrompt() ölçümden prompt kurar, applyFromModel()
 * Claude Code'un döndürdüğü JSON'u kapıdan geçirir.
 *
 * Senaryo önericideki kural burada da geçerli: **model veride olmayan şeyi
 * gösteremez.** Orada dayanak kaynağıydı, burada rota adı ve sayı. Model
 * uydurma bir rota ya da ölçmediğimiz bir metrik döndürürse bulgu elenir —
 * kapı çağrı yolunda değil, VERİ yolunda durur, yapıştırılan JSON de geçer.
 */
export const BUDGET = {
  lcp: { warn: 2500, bad: 4000, unit: "ms", src: "Web Vitals" },
  load: { warn: 3000, bad: 5000, unit: "ms", src: "panel bütçesi" },
  ttfb: { warn: 800, bad: 1800, unit: "ms", src: "Web Vitals" },
  requests: { warn: 100, bad: 150, unit: "", src: "panel bütçesi" },
  api: { warn: 10, bad: 15, unit: "", src: "panel bütçesi" },
};

export const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          evidence: { type: "string" },
          recommendation: { type: "string" },
          routes: { type: "array", items: { type: "string" } },
        },
        required: ["severity", "title", "evidence", "recommendation", "routes"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "findings"],
  additionalProperties: false,
};

const SYSTEM = `Bir web performans ölçümünü yorumluyorsun. Kurallar:
1. YALNIZCA verilen ölçümdeki sayıları ve rota adlarını kullan. Ölçümde olmayan
   bir rotadan, metrikten ya da sayıdan BAHSETME — uydurma yapma.
2. Her bulguda kanıt olarak gerçek sayıyı yaz (rota + metrik + değer + bütçe).
3. Bütçe aşımı ile "yavaş ama bütçe içinde" arasında ayrım yap.
4. Yapısal bulguyu (tüm rotaları etkileyen) tek rotalık bulgunun ÖNÜNE koy.
5. Öneri uygulanabilir olsun; "optimize edin" gibi genel laf yazma.
6. En fazla 6 bulgu. Az ve isabetli, çok ve genelden iyidir.`;

function renderPayload(perf) {
  const b = Object.entries(BUDGET)
    .map(
      ([k, v]) =>
        `- ${k}: iyi ≤${v.warn}${v.unit}, zayıf >${v.bad}${v.unit} (${v.src})`,
    )
    .join("\n");
  const routes = perf.routes
    .map(
      (r) =>
        `${r.route} | LCP ${r.lcp ?? "-"} | load ${r.load ?? "-"} | TTFB ${r.ttfb ?? "-"} | istek ${r.requests ?? "-"} | API ${r.api ?? "-"} | mükerrer ${r.duplicates} | 4xx/5xx ${r.siteErrors} | konsol ${r.consoleErrors}${r.notFound ? " | 404" : ""}`,
    )
    .join("\n");
  const eps = perf.endpoints
    .slice(0, 20)
    .map(
      (e) =>
        `${e.endpoint} | en yavaş ${e.maxMs}ms | ${e.routes} rotada | ${e.calls} çağrı | ${e.dupRoutes} rotada mükerrer`,
    )
    .join("\n");
  return `BÜTÇELER
${b}

TOPLAM
${perf.totals.routes} rota · ${perf.totals.requests} istek · ${perf.totals.api} API çağrısı · ${perf.totals.endpoints} endpoint · ${perf.totals.dupEndpoints} mükerrer endpoint
son ölçüm: ${perf.measuredAt ?? "bilinmiyor"}

ROTALAR (LCP'ye göre sıralı)
${routes}

ENDPOINT ENVANTERİ (en yavaş 20)
${eps}`;
}

/** Model uydurma rota gösterirse bulguyu ele. */
export function gate(out, perf) {
  const known = new Set(perf.routes.map((r) => r.route));
  const kept = [];
  const dropped = [];
  for (const f of out.findings ?? []) {
    const bad = (f.routes ?? []).filter((r) => r && !known.has(r));
    if (bad.length)
      dropped.push({
        title: f.title,
        reason: `ölçümde olmayan rota: ${bad.join(", ")}`,
      });
    else kept.push(f);
  }
  return { summary: out.summary ?? "", findings: kept.slice(0, 6), dropped };
}

/**
 * Claude Code'a verilecek prompt'u kurar. Model çağrısı YOK.
 * Ölçüm yoksa prompt üretilmez: yorumlanacak sayı olmadan model yalnızca
 * genel geçer laf üretebilir.
 */
export function buildPrompt(perf) {
  if (!perf?.routes?.length)
    throw new Error("ölçüm yok — önce scripts/perf-sweep.mjs koşulmalı");
  return {
    prompt: [
      SYSTEM,
      "",
      "Çıktıyı SADECE şu JSON biçiminde ver, başka hiçbir metin ekleme:",
      '{"summary":"...","findings":[{"severity":"high|medium|low","title":"...",'
        + '"evidence":"...","recommendation":"...","routes":["..."]}]}',
      "",
      "---",
      renderPayload(perf),
    ].join("\n"),
    routes: perf.routes.length,
    measuredAt: perf.measuredAt ?? null,
  };
}

/**
 * Claude Code'un döndürdüğü JSON'u kapıdan geçirir. Bulgu döndüren TEK dış
 * yüzey burasıdır; ölçüm sunucuda yeniden okunduğu için (istemciden gelmediği
 * için) uydurma rota listesiyle kapı geçilemez.
 */
export function applyFromModel(perf, out) {
  if (!perf?.routes?.length)
    throw new Error("ölçüm yok — önce scripts/perf-sweep.mjs koşulmalı");
  if (!out || typeof out !== "object" || !Array.isArray(out.findings))
    throw new Error("findings dizisi bekleniyor");
  return gate(out, perf);
}
