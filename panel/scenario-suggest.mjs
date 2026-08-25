/**
 * Senaryo önerici — QA paneli için.
 *
 * TASARIM İLKESİ: İstem modeli ikna eder, kapıyı KOD tutar.
 * Kural 1 ("dayanağı olmayan senaryo önerme") dört yerde birden zorlanır:
 *   1. İstem            → modele söyler
 *   2. filterOutput()   → boş/uydurma oracleRef'i eler
 *   3. validate()       → bağlamdaki kaynak listesiyle karşılaştırır
 *   4. assertClean()    → hâlâ kirli bir şey varsa REDDEDER (throw)
 *
 * ⚠️ Katmanlar `suggestScenarios()` içinde koşulsuz çalışır ve senaryo döndüren
 * TEK dış yüzey burasıdır. Katmanları çağrı yoluna değil, veri yoluna koymak
 * kasıtlı: yeni bir uç eklenince kapı atlanamıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project.mjs";

/**
 * ⚠️ SDK STATİK IMPORT EDİLMİYOR — TEMBEL YÜKLENİYOR.
 *
 * Eski hali `import Anthropic from "@anthropic-ai/sdk"` idi. `server.mjs` bu
 * modülü statik çektiği için, paket kurulu değilse panel AÇILIŞTA ölüyordu:
 *   Cannot find package '@anthropic-ai/sdk' imported from scenario-suggest.mjs
 * Bozulan tek bir buton değil, panelin tamamıydı (ölçüldü 2026-08-22, paneli
 * SDK'sız bir dizine kopyalayarak). Panel başka projelere taşınabilir bir ürün
 * olacağı ve o projelerde SDK bulunmayacağı için model çağrısı ARTIK OPSİYONEL:
 * paket yoksa panel çalışır, yalnızca senaryo önerici devre dışı kalır.
 */
let AnthropicCtor = null;
async function loadSdk() {
  if (AnthropicCtor) return AnthropicCtor;
  const mod = await import("@anthropic-ai/sdk");
  AnthropicCtor = mod.default ?? mod.Anthropic;
  if (!AnthropicCtor)
    throw new Error("@anthropic-ai/sdk beklenen dışa aktarımı vermedi");
  return AnthropicCtor;
}

/** perf-analyze de aynı tembel yükleyiciyi kullanır — tek uygulama. */
export const loadSdkFor = loadSdk;

/** Paket kurulu mu? (Kimlik ayrı konu — bkz. hasCredentials.) */
export async function hasSdk() {
  try {
    await loadSdk();
    return true;
  } catch {
    return false;
  }
}

export const SDK_HINT =
  "Model çağrısı için `@anthropic-ai/sdk` kurulu değil — senaryo önerici kapalı. " +
  "Panelin geri kalanı (koşumlar, case defteri, Jira, rapor, kanıt) bundan etkilenmez. " +
  "İstersen `npm i @anthropic-ai/sdk` ile açılır; ürünün çalışması için gerekli değildir.";

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

/**
 * Kimlik var mı? SDK'nin çözüm sırası: ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN →
 * `ant auth login` ile yazılan profil (~/.config/anthropic). Hiçbiri yoksa
 * `new Anthropic()` kriptik bir İngilizce hata atıyor — onu kullanıcıya
 * göstermek yerine önden tespit edip anlaşılır mesaj veriyoruz.
 */
export function hasCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
    return true;
  const dir = path.join(process.env.HOME || "", ".config", "anthropic");
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export const AUTH_HINT =
  "Model çağrısı için kimlik yok. İki yol var: (1) `export ANTHROPIC_API_KEY=sk-...` " +
  "verip paneli yeniden başlat, ya da (2) `npm i -g @anthropic-ai/ant && ant auth login` " +
  "ile profil oluştur — SDK profili kendiliğinden okur. Kimlik panele değil ortama verilir.";

export const MODEL = process.env.SCENARIO_MODEL || "claude-opus-5";
export const MAX_TOKENS = Number(process.env.SCENARIO_MAX_TOKENS || 4000);

// ───────────────────────────────────────────────────────── bağlam

/** Spec dosyalarından paketleri ve mevcut senaryoları çıkarır. */
export function readSuites() {
  if (!fs.existsSync(TESTS)) return [];
  return fs
    .readdirSync(TESTS)
    .filter((f) => /^\d+-.+\.spec\.ts$/.test(f))
    .sort()
    .map((f) => {
      const src = fs.readFileSync(path.join(TESTS, f), "utf8");
      const suiteId = f.replace(/\.spec\.ts$/, "");
      const title =
        src.match(/test\.describe\(\s*["'`](.+?)["'`]/)?.[1] ?? suiteId;
      const num = Number(suiteId.slice(0, 2));
      // 01–19 misafir, 20+ üye — repo konvansiyonu
      const layer = num >= 20 ? "member" : "guest";
      const cases = [...src.matchAll(/^\s*test\(\s*["'`](.+?)["'`]/gm)].map(
        (m) => m[1],
      );
      return { suiteId, title, layer, cases };
    });
}

/**
 * Bilinen dayanak kaynakları — SADECE repoda gerçekten var olanlar.
 * Model bunların dışına çıkarsa senaryo reddedilir.
 */
/**
 * `known-issues.ts` içindeki id öneki profilden gelir (`knownIssuePrefix`).
 * Önek tanımlı değilse bu kaynak boş kalır — Jira eşlemesi yine okunur.
 */
/** `jira-map.ts` icindeki kart anahtari oneki profilin Jira projesinden gelir. */
const JIRA_MAP_RE = new RegExp(
  `key:\\s*"(${PROJECT.jira.project}-\\d+)"[\\s\\S]{0,120}?title:\\s*"(.*?)"`,
  "g",
);

const KNOWN_ISSUE_RE = PROJECT.knownIssuePrefix
  ? new RegExp(`id:\\s*"(${PROJECT.knownIssuePrefix}-\\d+)"`, "g")
  : /(?!)/g;

export function readOracleSources() {
  const out = [];
  const ki = path.join(TESTS, "known-issues.ts");
  if (fs.existsSync(ki)) {
    const src = fs.readFileSync(ki, "utf8");
    for (const m of src.matchAll(KNOWN_ISSUE_RE)) {
      out.push({ ref: m[1], kind: "known-issue" });
    }
  }
  const jm = path.join(TESTS, "jira-map.ts");
  if (fs.existsSync(jm)) {
    const src = fs.readFileSync(jm, "utf8");
    for (const m of src.matchAll(JIRA_MAP_RE)) {
      out.push({ ref: m[1], kind: "jira", title: m[2] });
    }
  }
  /*
   * Figma kaynagi PROFILDEN okunur (once figma-map.mjs dosyasi metin olarak
   * parse ediliyordu; veri profile tasindiginda bu kaynak sessizce bosalirdi).
   */
  for (const r of PROJECT.figma?.routes ?? []) {
    if (r.frameId) out.push({ ref: `figma:${r.frameId}`, kind: "figma", title: r.page ?? "" });
  }
  const seen = new Set();
  return out.filter((o) => (seen.has(o.ref) ? false : seen.add(o.ref)));
}

export function buildContext({ slug = PROJECT.id, limit = 5 } = {}) {
  const suites = readSuites();
  return {
    slug,
    limit,
    suites: suites.map(({ suiteId, title, layer }) => ({
      suiteId,
      title,
      layer,
    })),
    existingCases: suites.flatMap((s) => s.cases),
    oracleSources: readOracleSources(),
  };
}

// ───────────────────────────────────────────────────────── istem

export const SYSTEM = `Bir QA platformu için test senaryosu öneriyorsun. Kurallar:
1. Her senaryonun oracleRef alanı ZORUNLU: beklenen davranışın izlenebilir kaynağı (gereksinim kimliği, OpenAPI işlem kimliği ya da doküman bölümü). Kaynağı UYDURMA — verilen bağlamda yoksa o senaryoyu hiç önerme.
2. suiteId yalnızca verilen paket kimliklerinden biri olabilir.
3. caseId kebab-case, kısa ve benzersiz.
4. Var olan senaryoları TEKRARLAMA.
5. Az ve isabetli, çok ve genelden iyidir.
6. En fazla {LIMIT} senaryo öner.`;

export function renderSystem(limit) {
  return SYSTEM.replace("{LIMIT}", String(limit));
}

export function renderUser(ctx, request) {
  const suites = ctx.suites.length
    ? ctx.suites
        .map((s) => `- ${s.suiteId} (${s.title}, layer: ${s.layer})`)
        .join("\n")
    : "(paket listelenmedi)";
  const cases = ctx.existingCases.length
    ? ctx.existingCases.join(", ")
    : "(yok)";
  const oracles = ctx.oracleSources.length
    ? ctx.oracleSources
        .map((o) => `- ${o.ref}${o.title ? ` — ${o.title}` : ""}`)
        .join("\n")
    : "(bağlamda kaynak listelenmedi)";
  return `Proje: ${ctx.slug}

Paketler:
${suites}

Var olan senaryolar:
${cases}

Bilinen dayanak kaynakları:
${oracles}

İstek:
${request}`;
}

// ───────────────────────────────────────────────────────── şema

export const SCHEMA = {
  type: "object",
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          suiteId: { type: "string" },
          caseId: { type: "string" },
          title: { type: "string" },
          oracleRef: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: [
          "suiteId",
          "caseId",
          "title",
          "oracleRef",
          "tags",
          "steps",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["scenarios"],
  additionalProperties: false,
};

// ───────────────────────────────────────────────── KAPI (3 katman)

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Katman 2 — çıktı süzgeci. oracleRef'i boş, boşluk ya da belirgin şekilde
 * kaçamaklı olanları eler. Modele güvenmez, sadece alanın dolu olduğuna bakar.
 */
export function filterOutput(scenarios) {
  const dropped = [];
  const kept = [];
  for (const s of scenarios ?? []) {
    const ref = typeof s?.oracleRef === "string" ? s.oracleRef.trim() : "";
    const empty = ref.length === 0;
    // "bilinmiyor", "yok", "N/A", "-" gibi kacamaklar dayanak degildir
    const evasive = /^(n\/?a|yok|bilinmiyor|belirsiz|tbd|todo|[-–—?.]+)$/i.test(
      ref,
    );
    if (empty || evasive)
      dropped.push({
        caseId: s?.caseId ?? "(caseId yok)",
        reason: empty ? "oracleRef bos" : `oracleRef kacamakli: ${ref}`,
      });
    else kept.push({ ...s, oracleRef: ref });
  }
  return { kept, dropped };
}

/**
 * Katman 3 — bağlamla doğrulama. oracleRef verilen kaynak listesinde OLMALI;
 * suiteId verilen paketlerden biri OLMALI; caseId kebab-case ve benzersiz OLMALI.
 */
export function validate(scenarios, ctx) {
  const suiteIds = new Set(ctx.suites.map((s) => s.suiteId));
  const refs = new Set(ctx.oracleSources.map((o) => o.ref));
  const existing = new Set(
    (ctx.existingCases ?? []).map((c) => c.toLowerCase()),
  );
  const seen = new Set();
  const ok = [];
  const rejected = [];
  for (const s of scenarios) {
    const bad = [];
    if (!suiteIds.has(s.suiteId))
      bad.push(`suiteId baglamda yok: ${s.suiteId}`);
    // oracleRef ya birebir kaynak, ya "KAYNAK#bolum" biciminde olmali
    const base = String(s.oracleRef).split("#")[0].trim();
    if (!refs.has(base))
      bad.push(`oracleRef bilinen kaynak degil: ${s.oracleRef}`);
    if (!KEBAB.test(s.caseId || ""))
      bad.push(`caseId kebab-case degil: ${s.caseId}`);
    if (seen.has(s.caseId)) bad.push(`caseId tekrar: ${s.caseId}`);
    if (existing.has(String(s.title || "").toLowerCase()))
      bad.push(`var olan senaryo tekrari: ${s.title}`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) bad.push("steps bos");
    if (bad.length)
      rejected.push({ caseId: s.caseId ?? "(yok)", reasons: bad });
    else {
      seen.add(s.caseId);
      ok.push(s);
    }
  }
  return { ok, rejected };
}

/**
 * Katman 4 — son ret. Buraya kirli bir kayıt gelirse bu bir KOD hatasıdır,
 * sessizce süzmek yerine patlıyoruz: kapının bir yerinde delik var demektir.
 */
export function assertClean(scenarios, ctx) {
  const refs = new Set(ctx.oracleSources.map((o) => o.ref));
  for (const s of scenarios) {
    const base = String(s.oracleRef ?? "")
      .split("#")[0]
      .trim();
    if (!base || !refs.has(base)) {
      throw new Error(
        `KAPI IHLALI: dayanaksiz senaryo son katmana kadar geldi (caseId=${s.caseId}, oracleRef=${s.oracleRef}). ` +
          `Bu bir kod hatasi — filterOutput/validate atlanmis olabilir.`,
      );
    }
  }
  return scenarios;
}

/** Üç katmanı sırayla uygular. Senaryo döndüren her yol buradan geçer. */
export function gate(rawScenarios, ctx) {
  const { kept, dropped } = filterOutput(rawScenarios);
  const { ok, rejected } = validate(kept, ctx);
  const limited = ok.slice(0, ctx.limit);
  const overLimit = ok.length - limited.length;
  assertClean(limited, ctx);
  return {
    scenarios: limited,
    audit: {
      received: (rawScenarios ?? []).length,
      droppedNoOracle: dropped,
      rejectedByContext: rejected,
      trimmedByLimit: overLimit > 0 ? overLimit : 0,
      accepted: limited.length,
    },
  };
}

// ───────────────────────────────────────────────────────── çağrı

/**
 * Senaryo önerir. Bu, senaryo döndüren TEK dış yüzeydir; kapı içinde koşulsuz
 * çalışır. Yeni bir HTTP ucu eklenirse de buradan geçmek zorunda.
 */
export async function suggestScenarios({
  request,
  slug = PROJECT.id,
  limit = 5,
  client,
} = {}) {
  if (!request || !String(request).trim())
    throw new Error("request bos olamaz");
  const ctx = buildContext({ slug, limit });
  if (!ctx.oracleSources.length) {
    // Kural 1 uygulanamaz: modele neye dayanacagini soyleyemiyoruz.
    return {
      scenarios: [],
      audit: {
        received: 0,
        droppedNoOracle: [],
        rejectedByContext: [],
        trimmedByLimit: 0,
        accepted: 0,
        note: "baglamda dayanak kaynagi yok — istek modele hic gonderilmedi",
      },
      context: ctx,
    };
  }
  /*
   * SIRA ONEMLI: once YAPISAL engel (paket kurulu mu), sonra YAPILANDIRMA
   * engeli (kimlik var mi). Tersi sirada, SDK'siz bir kurulumda kullaniciya
   * "kimlik yok" deniyordu — key'i olsa bile calismayacakken yanlis yere
   * bakmasina sebep oluyordu (olculdu 2026-08-22).
   */
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
  try {
    if (client) {
      anthropic = client;
    } else {
      const Ctor = await loadSdk(); // paket yoksa buradan NO_SDK ile çıkar
      anthropic = new Ctor();
    }
  } catch (e) {
    if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(String(e.message))) {
      const err = new Error(SDK_HINT);
      err.code = "NO_SDK";
      throw err;
    }
    const err = new Error(`${AUTH_HINT} (SDK: ${e.message.slice(0, 120)})`);
    err.code = "NO_CREDENTIALS";
    throw err;
  }
  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: renderSystem(limit),
      messages: [{ role: "user", content: renderUser(ctx, request) }],
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
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Model yapilandirilmis cikti dondurmedi (stop_reason=${res.stop_reason}): ${text.slice(0, 200)}`,
    );
  }
  const out = gate(parsed.scenarios, ctx);
  return {
    ...out,
    context: ctx,
    usage: res.usage,
    stopReason: res.stop_reason,
  };
}
