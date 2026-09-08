/**
 * Kapsam ağacındaki düğümler için test case ÜRETİMİ — anahtarsız yol.
 *
 * NEDEN: panelin kendi model çağrısı ANTHROPIC_API_KEY ya da `ant` profili
 * istiyordu. Kullanıcı modeli zaten Claude Code'da çalıştırıyor; panele ikinci
 * bir kimlik koymanın anlamı yok. Bu yüzden panel model ÇAĞIRMAZ, iki ucu
 * üstlenir:
 *   1) buildPrompt() — seçili düğümlerin bağlamından hazır prompt üretir,
 *   2) applyFromModel() — Claude Code'un döndürdüğü JSON'u ağaca yazar.
 *
 * ÜRETİLEN CASE'LER TASLAKTIR:
 *  - `generated: true` ile işaretlenir, elle yazılanlardan ayırt edilir.
 *  - Koşum kaydı YOKTUR; yani "geçti" seçilemez (kaynak kural R13/R14).
 *    Üretilmiş bir case, koşulana kadar kanıt değildir.
 */
import { readTree, writeTree, findNode } from "./scope.mjs";
import { contextFor, renderContextBlock } from "./rag/retrieve.mjs";

/**
 * Yapılandırılmış çıktı şeması — API yolunda sunucu tarafında zorlanır
 * (`output_config.format`), CLI/elle yolda yalnızca talimat. Her nesnede
 * `additionalProperties:false` ŞART (API aksini 400 ile reddeder).
 */
export const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          cases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: { type: "string" },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { action: { type: "string" }, expected: { type: "string" } },
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
        required: ["nodeId", "cases"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Repo bağlamı (RAG v1). İndeks yoksa ya da kurulamazsa boş döner — üretim
 * kapanmaz, yalnızca daha az bilir. Hata yutulur ama `meta.error` ile görünür.
 */
function retrievalFor(query, opt = {}) {
  try {
    const ctx = contextFor({ query, k: opt.k ?? 6, maxChars: opt.maxChars ?? 6000 });
    if (!ctx) return { block: "", meta: { chunks: 0, builtAt: null, error: "indeks yok" } };
    return { block: renderContextBlock(ctx), meta: { chunks: ctx.chunks.length, builtAt: ctx.builtAt, sources: ctx.chunks.map((c) => `${c.file}:${c.line}`) } };
  } catch (e) {
    return { block: "", meta: { chunks: 0, builtAt: null, error: String(e.message).slice(0, 120) } };
  }
}

const FORMAT_RULE = [
  "Çıktıyı SADECE şu JSON biçiminde ver, başka hiçbir metin ekleme.",
  // Olculdu: model metin icinde \" kacisli tirnak kullandiginda yanit bazen
  // bozuk JSON cikiyor. Tirnagi yasaklamak bu hatanin kaynagini kurutuyor.
  "Metin alanlarının İÇİNDE çift tırnak KULLANMA (gerekiyorsa tek tırnak ya da tırnaksız yaz).",
].join("\n");

/**
 * Arayüzdeki test türü anahtarları → modele verilecek talimat.
 * Metinler eskiden istemcideki TEST_TYPE_META'da duruyordu; prompt sunucuda
 * kurulduğu için tek kaynak burası.
 */
export const TYPES = {
  happy: "Happy path — temel, hatasız, başarıyla tamamlanan senaryo(lar) için case yaz (genelde 1-2 case yeterli).",
  negative: "Negatif / validasyon — zorunlu alan eksikliği, format hatası, izin verilmeyen değer, hata mesajı gibi "
    + "tespit ettiğin HER validasyon kuralı için ayrı bir case yaz; sayıyı yapay şekilde sınırlama.",
  boundary: "Sınır değerler — minimum/maksimum uzunluk, 0, negatif değer, aşırı büyük değer (uygulanabilirse).",
  empty: "Boş/dolu veri — hiç veri yokken (boş durum mesajı) ve çok fazla veri varken (sayfalama, kaydırma) davranış.",
  regression: "Regresyon — bu düğüme bağlı Jira kartlarına ve durum geçmişine bak; daha önce hataya düşmüş bir "
    + "davranış varsa tekrar etmediğini doğrulayan case yaz. Geçmişte hata yoksa bu türü ATLA.",
  recovery: "Hata kurtarma — ağ hatası/timeout/API hatası durumunda kullanıcının ne gördüğü ve toparlanabildiği.",
  ui: "UI / görsel tutarlılık — responsive davranış, hover/focus/disabled durumları, layout bozulmaları.",
  a11y: "Erişilebilirlik — klavye ile gezinme, görünür focus, temel okunabilirlik/kontrast.",
  perf: "Performans — büyük veri setinde yüklenme/kaydırma/render süresi.",
  security: "Güvenlik — yetkisiz erişim, girdi enjeksiyonu gibi TEMEL kontroller; kapsamlı pentest değil.",
};

/**
 * Arayüz bazı türleri başka anahtarla tutuyor (pill'lerin adı değişmesin diye
 * ikisi de kabul edilir). Eşlenmeyen anahtar sessizce düşerse kullanıcı seçtiği
 * türün üretilmediğini fark etmiyor — bu yüzden alias var, filtre değil.
 */
const ALIAS = { emptyFull: "empty", performance: "perf", accessibility: "a11y" };

/** Seçilen tür anahtarlarını kanonik hale getirir; tanınmayanı atar. */
export function normalizeTypes(types) {
  const out = [];
  for (const t of types ?? []) {
    const k = ALIAS[t] ?? t;
    if (TYPES[k] && !out.includes(k)) out.push(k);
  }
  return out;
}

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
  const kaynaklar = node.resourceLinks ?? [];
  return {
    yol: yol.join(" › "),
    ad: node.name,
    tur: node.type,
    altBaslıklar,
    // Prompt'un en degerli kismi: tahmin yerine okunacak birincil kaynak.
    canliUrl: kaynaklar.filter((r) => r.type === "link").map((r) => r.url).find(Boolean) ?? null,
    figma: kaynaklar.filter((r) => r.type === "figma").map((r) => r.url).filter(Boolean),
    confluence: kaynaklar.filter((r) => r.type === "confluence").map((r) => r.url).filter(Boolean),
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

export function renderUser(ctx, types, limit) {
  const istenen = types.map((t) => `- ${t}: ${TYPES[t] ?? t}`).join("\n");
  return [
    `Ağaçtaki yol: ${ctx.yol}`,
    `Düğüm: "${ctx.ad}" (tür: ${ctx.tur})`,
    ctx.canliUrl ? `İlgili canlı sayfa: ${ctx.canliUrl} — gerekirse aç ve gördüğünü doğrula.` : "",
    ctx.figma?.length
      ? `Bağlı Figma tasarımı: ${ctx.figma.join(", ")} — Figma MCP araçlarıyla (get_design_context / `
        + `get_screenshot) incele; durumları (boş/dolu/hata), varyantları ve etkileşimleri case'lere yansıt. `
        + `Figma burada BİRİNCİL kaynak, canlı sayfadan önce buna bak.`
      : "",
    ctx.confluence?.length
      ? `Bağlı Confluence dokümanı: ${ctx.confluence.join(", ")} — WebFetch ile oku; gereksinimlere ve kabul `
        + `kriterlerine sadık kal, sayfayı gezerek tahmin etme.`
      : "",
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
export function applyCases(tree, node, cases, { jiraKey = null } = {}) {
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
      /**
       * Hangi Jira kartından üretildi. Kart bazlı üretimde dolu; kapsam
       * ağacından üretilenlerde null. İzlenebilirlik için: case'in neden var
       * olduğunu sonradan sormak zorunda kalmamak.
       */
      jiraKey,
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
 * Seçili düğümler için Claude Code'a verilecek prompt'u kurar.
 * Model çağrısı YOK — panel yalnızca bağlamı toplar.
 */
export function buildPrompt({ nodeIds, types = ["happy", "negative"], limit = 4 }) {
  const { tree } = readTree();
  const secilen = normalizeTypes(types);
  if (!secilen.length) throw new Error("En az bir test türü seçilmeli.");

  const bloklar = [];
  const dugumler = [];
  const sorgu = [];
  for (const id of nodeIds ?? []) {
    const node = findNode(tree, id);
    if (!node) continue;
    const ctx = buildContext(tree, node);
    dugumler.push({ id, name: node.name, yol: ctx.yol });
    sorgu.push(node.name, ctx.yol, urlPathWords(ctx.canliUrl), ...ctx.altBaslıklar.slice(0, 6));
    bloklar.push(`### ${id}\n${renderUser(ctx, secilen, limit)}`);
  }
  if (!bloklar.length) throw new Error("Geçerli düğüm yok.");

  const retrieval = retrievalFor(sorgu.filter(Boolean).join(" "), { k: 6, maxChars: 6000 });
  const user = [
    "Aşağıda bir veya daha fazla düğüm var. HER BİRİ için ayrı test case'ler yaz.",
    "",
    FORMAT_RULE,
    '{"items":[{"nodeId":"<düğüm id>","cases":[{"title":"...","type":"happy|negative|...","steps":[{"action":"...","expected":"..."}]}]}]}',
    "",
    "---",
    bloklar.join("\n\n---\n\n"),
    retrieval.block ? `\n---\n${retrieval.block}` : "",
  ].filter((x) => x !== "").join("\n");

  return {
    prompt: `${SYSTEM}\n\n${user}`,
    system: SYSTEM,
    user,
    nodes: dugumler,
    types: secilen,
    limit,
    retrieval: retrieval.meta,
  };
}

/** URL yolundaki kelimeler (slug → arama terimi). */
function urlPathWords(u) {
  if (!u) return "";
  try { return new URL(u).pathname.replace(/[-_/]+/g, " ").trim(); } catch { return ""; }
}

/**
 * BİR JIRA KARTI için istem kurar.
 *
 * Neden ayrı bir fonksiyon: kart bazlı üretimde bağlamın merkezi düğüm değil
 * KART — özeti, açıklaması ve yorumlarında kabul kriterleri geçiyor. Düğüm
 * bağlamı yine ekleniyor (sayfadaki bölümler, mevcut case'ler, tekrar
 * üretmemesi için), ama kartın metni önce geliyor: model neyi doğrulaması
 * gerektiğini oradan öğreniyor.
 *
 * Düğüm ZORUNLU: üretilen case bir yere yazılacak; hedefsiz üretim, "case'ler
 * nereye gitti" sorusuyla sonuçlanır.
 *
 * @param {{card: object, nodeId: string, types?: string[], limit?: number}} arg
 */
export function buildCardPrompt({ card, nodeId, types = ["happy", "negative"], limit = 4 }) {
  if (!card?.key) throw new Error("Kart bilgisi yok.");
  if (!nodeId) throw new Error("Hedef düğüm seçilmeli — case'ler oraya yazılacak.");
  const { tree } = readTree();
  const node = findNode(tree, nodeId);
  if (!node) throw new Error("Hedef düğüm bulunamadı.");
  const secilen = normalizeTypes(types);
  if (!secilen.length) throw new Error("En az bir test türü seçilmeli.");

  const ctx = buildContext(tree, node);
  const yorumlar = (card.comments ?? []).slice(-5);

  const kart = [
    `### Jira kartı: ${card.key} — ${card.summary ?? ""}`,
    `Statü: ${card.status ?? "—"} · Tip: ${card.type ?? "—"}`
      + (card.assignee ? ` · Atanan: ${card.assignee}` : ""),
    card.url ? `Bağlantı: ${card.url}` : "",
    card.description
      ? `\nKart açıklaması (KABUL KRİTERİ BURADA OLABİLİR, birebir oku):\n${String(card.description).slice(0, 4000)}`
      : "\nKart açıklaması boş — yalnızca başlığa ve düğüm bağlamına dayan, kabul kriteri UYDURMA.",
    yorumlar.length
      ? `\nSon yorumlar (${yorumlar.length}):\n`
        + yorumlar.map((m) => `- ${m.author ?? "?"}: ${String(m.text ?? "").slice(0, 400)}`).join("\n")
      : "",
  ].filter(Boolean).join("\n");

  const retrieval = retrievalFor(
    [card.summary, node.name, ctx.yol, urlPathWords(ctx.canliUrl), String(card.description ?? "").slice(0, 300)].filter(Boolean).join(" "),
    { k: 6, maxChars: 5000 },
  );
  const user = [
    "Aşağıdaki Jira kartını doğrulayan test case'leri yaz. Kartın kapsamı dışına ÇIKMA:",
    "kartla ilgisi olmayan genel sayfa testleri üretme.",
    "",
    FORMAT_RULE,
    `{"items":[{"nodeId":"${nodeId}","cases":[{"title":"...","type":"happy|negative|...",`
      + `"steps":[{"action":"...","expected":"..."}]}]}]}`,
    "",
    "---",
    kart,
    "",
    "---",
    `### Yazılacağı düğüm (${nodeId})`,
    renderUser(ctx, secilen, limit),
    retrieval.block ? `\n---\n${retrieval.block}` : "",
  ].filter((x) => x !== "").join("\n");

  return {
    prompt: `${SYSTEM}\n\n${user}`,
    system: SYSTEM,
    user,
    card: { key: card.key, summary: card.summary ?? "" },
    node: { id: nodeId, name: node.name, yol: ctx.yol },
    types: secilen,
    limit,
    retrieval: retrieval.meta,
  };
}

/**
 * KAPI — model yalnızca AÇIKÇA İSTENEN düğümlere yazabilir.
 *
 * `scenario-suggest.mjs`/`perf-analyze.mjs`'nin aksine bu üretim yolunun ana
 * riski uydurma İÇERİK değil (steps/expected zaten "bağlamda yoksa uydurma"
 * talimatıyla sınırlı, ölçülemez) — uydurma HEDEF: `applyFromModel` eskiden
 * `findNode(tree, it.nodeId)` başarılı olan HER nodeId'yi kabul ediyordu, yani
 * model prompt'ta hiç istenmeyen ama ağaçta gerçekten var olan başka bir
 * düğümü "icat edip" oraya case yazdırabilirdi ve hiçbir katman bunu
 * yakalamıyordu. `allowedNodeIds` verilmişse (tüm çağıranlar veriyor — bkz.
 * server.mjs) bunun dışındaki her nodeId reddedilir.
 *
 * `allowedNodeIds` bilerek OPSİYONEL bırakıldı (null/undefined = kontrol
 * yok) — geriye dönük uyumluluk için, tüm mevcut çağıranlar zaten veriyor.
 */
export function gate(items, { allowedNodeIds = null } = {}) {
  const allowed = allowedNodeIds && allowedNodeIds.length ? new Set(allowedNodeIds) : null;
  const kept = [];
  const rejected = [];
  for (const it of items ?? []) {
    if (allowed && !allowed.has(it?.nodeId)) {
      rejected.push({ nodeId: it?.nodeId ?? "(yok)", reason: "istenen düğüm listesinde değil" });
      continue;
    }
    kept.push(it);
  }
  return { kept, rejected };
}

/**
 * Claude Code'un dondurdugu JSON'u agaca yazar.
 * @param {{items: {nodeId: string, cases: object[]}[], allowedNodeIds?: string[]}} girdi
 */
export function applyFromModel({ items, card = null, allowedNodeIds = null }) {
  if (!Array.isArray(items) || !items.length) throw new Error("items boş.");
  const { kept, rejected } = gate(items, { allowedNodeIds });
  const { tree } = readTree();
  const sonuc = rejected.map((r) => ({ nodeId: r.nodeId, error: r.reason }));
  let toplam = 0;
  for (const it of kept) {
    const node = findNode(tree, it.nodeId);
    if (!node) { sonuc.push({ nodeId: it.nodeId, error: "düğüm bulunamadı" }); continue; }
    // Kart anahtarı istekle gelebilir (kart bazlı üretim) ya da item'da olabilir.
    const out = applyCases(tree, node, it.cases ?? [], { jiraKey: it.card ?? card ?? null });
    toplam += out.written;
    sonuc.push({ nodeId: it.nodeId, node: node.name, written: out.written, skipped: out.skipped.length });
  }
  if (toplam) writeTree(tree);
  return { written: toplam, sonuc };
}
