/**
 * Kapsam ağacındaki bir düğüm için test case ÜRETİCİ.
 *
 * NEDEN: Flowscope'un kendi "Test Case İste" düğmesi modele gidecek PROMPT'u
 * üretip kullanıcıdan kopyala-yapıştır bekliyor (kaynak tasarımda API bağlantısı
 * kasıtlı yok). Sonucu ölçülebilir: 39 case'e karşı 3 koşum — kimse yapıştırmıyor.
 * Tarama 131 düğüm getirdiğinde bu iyice imkânsız hale geliyor.
 *
 * Bu modül aynı işi sunucuda yapar ve çıkan case'leri doğrudan düğüme yazar.
 * Model çağrısı `scenario-suggest.mjs`'teki kalıbın aynısı: yapılandırılmış
 * çıktı, aynı hata kodları (NO_SDK / NO_CREDENTIALS).
 *
 * ÜRETİLEN CASE'LER TASLAKTIR:
 *  - `generated: true` ile işaretlenir, elle yazılanlardan ayırt edilir.
 *  - Koşum kaydı YOKTUR; yani "geçti" seçilemez (kaynak kural R13/R14).
 *    Üretilmiş bir case, koşulana kadar kanıt değildir.
 */
import { loadSdkFor, hasSdk, hasCredentials, SDK_HINT, AUTH_HINT, MODEL } from "./scenario-suggest.mjs";
import { readTree, writeTree, findNode } from "./scope.mjs";

const MAX_TOKENS = Number(process.env.TESTCASE_MAX_TOKENS || 4000);

/** Arayüzdeki test türü anahtarları → modele verilecek açıklama. */
export const TYPES = {
  happy: "Happy path — akışın beklenen şekilde tamamlanması",
  negative: "Negatif / validasyon — hatalı veya eksik girdi",
  boundary: "Sınır değerler — en az/en çok, 0, taşma",
  empty: "Boş/dolu veri — liste boşken ve doluyken",
  regression: "Regresyon — bilinen hataların tekrarı",
  recovery: "Hata kurtarma — ağ hatası, yeniden deneme",
  ui: "UI / görsel tutarlılık",
  a11y: "Erişilebilirlik — klavye, etiket, kontrast",
  perf: "Performans — yüklenme ve tepki süresi",
  security: "Güvenlik — yetki, veri sızıntısı",
};

/** Düğümün ağaçtaki yolu — modelin bağlamı anlaması için. */
function pathOf(tree, id, yol = []) {
  for (const n of tree ?? []) {
    const bu = [...yol, n.name];
    if (n.id === id) return bu;
    const alt = pathOf(n.children, id, bu);
    if (alt) return alt;
  }
  return null;
}

/** Modelin göreceği bağlam. Uydurmasın diye SADECE gerçekten bilinenler. */
export function buildContext(tree, node) {
  const yol = pathOf(tree, node.id) ?? [node.name];
  const altBaslıklar = (node.children ?? []).map((c) => `${c.type}: ${c.name}`).slice(0, 40);
  return {
    yol: yol.join(" › "),
    ad: node.name,
    tur: node.type,
    altBaslıklar,
    mevcutCaseler: (node.testCases ?? []).map((t) => t.title).filter(Boolean),
    kartlar: (node.jiraTasks ?? []).map((t) => t.taskId),
    otomatikSpec: node.runRef?.specs ?? [],
  };
}

export const SYSTEM = `Bir QA ekibi için test case yazıyorsun. Kurallar:

1. YALNIZCA sana verilen bağlama dayan. Bağlamda olmayan bir ekran, alan veya
   buton UYDURMA. Sayfa hakkında bilmediğin bir şey varsa o konuda case yazma.
2. Her case somut ADIMLARDAN oluşur: her adımda ne yapıldığı (action) ve ne
   beklendiği (expected) ayrı ayrı yazılır. "Test et", "kontrol et" gibi
   belirsiz ifadeler kullanma.
3. Beklenen sonuç ÖLÇÜLEBİLİR olsun: hangi metin görünür, hangi sayı değişir,
   nereye yönlenir.
4. Türkçe yaz. Başlıklar kısa ve ayırt edici olsun.
5. Mevcut case başlıkları listelendi — aynısını ya da çok benzerini tekrar üretme.
6. VERİ DEĞİŞTİREN adımlar (silme, satın alma, şifre değiştirme) için case
   yazacaksan başlığa "[yıkıcı]" ekle ki koşum sırası ayrı değerlendirilsin.`;

export const SCHEMA = {
  type: "object",
  properties: {
    cases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string", description: "istenen tür anahtarlarından biri" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                expected: { type: "string" },
              },
              required: ["action", "expected"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "type", "steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["cases"],
  additionalProperties: false,
};

export function renderUser(ctx, types, limit) {
  const istenen = types.map((t) => `- ${t}: ${TYPES[t] ?? t}`).join("\n");
  return [
    `Ağaçtaki yol: ${ctx.yol}`,
    `Düğüm: "${ctx.ad}" (tür: ${ctx.tur})`,
    ctx.altBaslıklar.length
      ? `Bu sayfada tespit edilen bölüm/işlevler:\n${ctx.altBaslıklar.map((s) => `  - ${s}`).join("\n")}`
      : "Bu düğüm için alt bölüm bilgisi yok — yalnızca ad ve yol üzerinden yaz.",
    ctx.kartlar.length ? `Bağlı kartlar: ${ctx.kartlar.join(", ")}` : "",
    ctx.otomatikSpec.length ? `Bu düğümde zaten otomatik koşan spec: ${ctx.otomatikSpec.join(", ")}` : "",
    ctx.mevcutCaseler.length
      ? `Mevcut case başlıkları (TEKRARLAMA):\n${ctx.mevcutCaseler.map((s) => `  - ${s}`).join("\n")}`
      : "Bu düğümde henüz case yok.",
    `İstenen türler:\n${istenen}`,
    `En fazla ${limit} case üret.`,
  ].filter(Boolean).join("\n\n");
}

/** `tc`/`tcs` id sayacı — arayüzün sayaçlarıyla çakışmasın. */
function nextId(tree, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  (function walk(a) {
    for (const n of a ?? []) {
      for (const tc of n.testCases ?? []) {
        const m = re.exec(tc.id ?? ""); if (m) max = Math.max(max, Number(m[1]));
        for (const s of tc.steps ?? []) { const m2 = re.exec(s.id ?? ""); if (m2) max = Math.max(max, Number(m2[1])); }
      }
      walk(n.children);
    }
  })(tree);
  return `${prefix}${max + 1}`;
}

/**
 * Üretilen case'leri düğüme yazar. Aynı başlık varsa ATLAR.
 * @returns {{written:number, skipped:string[]}}
 */
export function applyCases(tree, node, cases) {
  const at = new Date().toISOString();
  const mevcut = new Set((node.testCases ?? []).map((t) => (t.title ?? "").trim().toLowerCase()));
  const skipped = [];
  let written = 0;
  node.testCases = node.testCases ?? [];

  for (const c of cases ?? []) {
    const baslik = String(c.title ?? "").trim();
    if (!baslik) continue;
    if (mevcut.has(baslik.toLowerCase())) { skipped.push(baslik); continue; }
    mevcut.add(baslik.toLowerCase());
    node.testCases.push({
      id: nextId(tree, "tc"),
      title: baslik,
      /** Üretildi işareti: elle yazılan ve otomatik koşan case'lerden ayrı. */
      generated: true,
      source: "ai",
      caseType: c.type ?? null,
      steps: (c.steps ?? []).map((s) => ({
        id: nextId(tree, "tcs"),
        action: String(s.action ?? "").trim(),
        expected: String(s.expected ?? "").trim(),
      })).filter((s) => s.action),
      // Koşum kaydı YOK: koşulana kadar "geçti" seçilemez (R13/R14).
      runs: [],
      status: "⬜",
      createdAt: at,
      updatedAt: at,
    });
    written++;
  }
  return { written, skipped };
}

/**
 * Tek düğüm için case üretir ve ağaca yazar.
 * `client` verilirse model çağrısı onun üzerinden yapılır (test edilebilirlik).
 */
export async function generateForNode({ nodeId, types = ["happy", "negative"], limit = 5, client }) {
  const { tree } = readTree();
  const node = findNode(tree, nodeId);
  if (!node) throw new Error(`Düğüm bulunamadı: ${nodeId}`);

  const secilen = types.filter((t) => TYPES[t]);
  if (!secilen.length) throw new Error("En az bir test türü seçilmeli.");

  // SIRA ONEMLI: once yapisal engel (paket), sonra yapilandirma (kimlik).
  if (!client && !(await hasSdk())) { const e = new Error(SDK_HINT); e.code = "NO_SDK"; throw e; }
  if (!client && !hasCredentials()) { const e = new Error(AUTH_HINT); e.code = "NO_CREDENTIALS"; throw e; }

  let anthropic = client;
  if (!anthropic) {
    const Ctor = await loadSdkFor();
    anthropic = new Ctor();
  }

  const ctx = buildContext(tree, node);
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 12);
  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: renderUser(ctx, secilen, lim) }],
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

  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`Model yapılandırılmış çıktı döndürmedi: ${text.slice(0, 200)}`); }

  const out = applyCases(tree, node, (parsed.cases ?? []).slice(0, lim));
  if (out.written) writeTree(tree);
  return { node: node.name, ...out, usage: res.usage ?? null, context: ctx };
}
