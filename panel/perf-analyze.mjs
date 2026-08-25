/**
 * Perf ölçümünü modele yorumlatır.
 *
 * Senaryo önericideki kural burada da geçerli: **model veride olmayan şeyi
 * gösteremez.** Orada dayanak kaynağıydı, burada rota adı ve sayı. Model
 * uydurma bir rota ya da ölçmediğimiz bir metrik döndürürse bulgu elenir.
 */
/**
 * SDK burada da TEMBEL yükleniyor — gerekçe scenario-suggest.mjs'de yazılı:
 * statik import, paket kurulu olmayan bir projede paneli açılışta düşürüyordu.
 */
import {
  hasCredentials,
  AUTH_HINT,
  MODEL,
  SDK_HINT,
  loadSdkFor,
} from "./scenario-suggest.mjs";

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

export async function analyze(perf, { client } = {}) {
  if (!perf?.routes?.length)
    throw new Error("ölçüm yok — önce scripts/perf-sweep.mjs koşulmalı");
  if (!client && !(await hasSdk())) {
    const e = new Error(SDK_HINT);
    e.code = "NO_SDK";
    throw e;
  }
  if (!client && !hasCredentials()) {
    const e = new Error(AUTH_HINT);
    e.code = "NO_CREDENTIALS";
    throw e;
  }
  let anthropic;
  if (client) {
    anthropic = client;
  } else {
    try {
      const Ctor = await loadSdkFor();
      anthropic = new Ctor();
    } catch (e) {
      const err = new Error(SDK_HINT);
      err.code = /Cannot find package|ERR_MODULE_NOT_FOUND/.test(
        String(e.message),
      )
        ? "NO_SDK"
        : "NO_CREDENTIALS";
      throw err;
    }
  }
  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: renderPayload(perf) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) {
      const err = new Error(`${AUTH_HINT} (API ${e.status})`);
      err.code = "NO_CREDENTIALS";
      throw err;
    }
    throw e;
  }
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    ...gate(JSON.parse(text), perf),
    usage: res.usage,
    stopReason: res.stop_reason,
  };
}
