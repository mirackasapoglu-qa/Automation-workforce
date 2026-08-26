/**
 * Senaryo önerici — QA paneli için. **Anahtarsız yol.**
 *
 * NEDEN: panel modeli kendisi çağırdığı sürece ikinci bir kimlik istiyordu
 * (ANTHROPIC_API_KEY ya da `ant auth login` profili). Kullanıcı modeli zaten
 * Claude Code'da çalıştırıyor. Panel artık iki ucu üstlenir:
 *   1) buildPrompt()     — bağlamdan (paketler, mevcut senaryolar, dayanak
 *                          kaynakları) hazır prompt üretir,
 *   2) applyFromModel()  — Claude Code'un döndürdüğü JSON'u kapıdan geçirir.
 *
 * TASARIM İLKESİ: İstem modeli ikna eder, kapıyı KOD tutar.
 * Kural 1 ("dayanağı olmayan senaryo önerme") dört yerde birden zorlanır:
 *   1. İstem            → modele söyler
 *   2. filterOutput()   → boş/uydurma oracleRef'i eler
 *   3. validate()       → bağlamdaki kaynak listesiyle karşılaştırır
 *   4. assertClean()    → hâlâ kirli bir şey varsa REDDEDER (throw)
 *
 * ⚠️ Katmanlar `applyFromModel()` içinde koşulsuz çalışır ve senaryo döndüren
 * TEK dış yüzey burasıdır. Modelin nereden geldiği (API mı, kopyala-yapıştır mı)
 * kapıyı ilgilendirmez: kapı çağrı yolunda değil, VERİ yolunda. Elle yapıştırılan
 * JSON de aynı üç katmandan geçer — yapıştırma kapıyı atlamanın yolu değildir.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project.mjs";

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

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

// ─────────────────────────────────────────────── prompt · uygulama

/**
 * Claude Code'a verilecek prompt'u kurar. Model çağrısı YOK — panel yalnızca
 * bağlamı toplar ve şema talimatını yazar.
 *
 * Bağlamda dayanak kaynağı yoksa prompt HİÇ üretilmez: Kural 1 uygulanamıyorsa
 * modele neye yaslanacağını söyleyemiyoruz, üretilen her senaryo kapıda elenirdi.
 */
export function buildPrompt({ request, slug = PROJECT.id, limit = 5 } = {}) {
  if (!request || !String(request).trim())
    throw new Error("request bos olamaz");
  const ctx = buildContext({ slug, limit });
  if (!ctx.oracleSources.length) {
    const e = new Error(
      "Baglamda dayanak kaynagi yok — oneri kapali. tests/known-issues.ts, " +
        "tests/jira-map.ts ya da profildeki Figma rotalari doldurulmali.",
    );
    e.code = "NO_ORACLE";
    throw e;
  }
  const prompt = [
    renderSystem(limit),
    "",
    "Çıktıyı SADECE şu JSON biçiminde ver, başka hiçbir metin ekleme:",
    '{"scenarios":[{"suiteId":"...","caseId":"...","title":"...","oracleRef":"...",'
      + '"tags":["..."],"steps":["..."],"rationale":"..."}]}',
    "",
    "---",
    renderUser(ctx, String(request)),
  ].join("\n");
  return { prompt, context: ctx, limit };
}

/**
 * Claude Code'un döndürdüğü JSON'u kapıdan geçirir. Senaryo döndüren TEK dış
 * yüzey burasıdır; `gate()` koşulsuz çalışır.
 *
 * ⚠️ Bağlam PROMPT'TAKİYLE aynı yerden (repodan) yeniden okunur, istemcinin
 * gönderdiğinden değil: yoksa paket/kaynak listesini uydurup kapıyı geçirmek
 * mümkün olurdu.
 */
export function applyFromModel({ scenarios, slug = PROJECT.id, limit = 5 } = {}) {
  if (!Array.isArray(scenarios))
    throw new Error("scenarios dizisi bekleniyor");
  const ctx = buildContext({ slug, limit });
  return { ...gate(scenarios, ctx), context: ctx };
}
