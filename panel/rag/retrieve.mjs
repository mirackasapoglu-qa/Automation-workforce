/**
 * RAG v1 — arama (BM25) + graf komşuluğu + istem bağlamı.
 *
 * `search()` saf: indeks + sorgu → sıralı parçalar. `contextFor()` bunun
 * istem-dostu hâli: kaynak başlıklı bloklar, toplam karakter bütçesi.
 *
 * Graf genişletme (varsa): ilk isabetlerin dosyalarının graphify komşusu olan
 * dosyalardan, sorguyla EN AZ bir terimi paylaşan parçalar eklenir (en çok
 * `expand`). Amaç: "sepet" sorgusunda CartPage'in yanında onu çağıran spec ve
 * onun dayandığı BasePage kuralının da gelmesi — sözcük eşleşmesi tek başına
 * bunu her zaman yakalamıyor.
 */
import { tokenize } from "./text.mjs";
import { ensureIndex } from "./index.mjs";

const K1 = 1.2;
const B = 0.75;

/**
 * @param {object} index  buildIndex() çıktısı
 * @param {string} query
 * @param {{k?:number, files?:RegExp|null, expand?:number}} [opt]
 * @returns {{i:number, score:number, file:string, line:number, title:string, text:string, nodeId?:string, via?:string}[]}
 */
export function search(index, query, { k = 8, files = null, expand = 2 } = {}) {
  if (!index || !index.chunks?.length) return [];
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return [];
  const N = index.chunks.length;
  const scores = new Float64Array(N);
  for (const t of qTerms) {
    const post = index.postings[t];
    if (!post) continue;
    const df = post.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [i, tf] of post) {
      const len = index.lens[i] || 0;
      const denom = tf + K1 * (1 - B + (B * len) / (index.avgLen || 1));
      scores[i] += idf * ((tf * (K1 + 1)) / denom);
    }
  }
  const ranked = [];
  for (let i = 0; i < N; i++) {
    if (scores[i] <= 0) continue;
    if (files && !files.test(index.chunks[i].file)) continue;
    ranked.push(i);
  }
  ranked.sort((a, b) => scores[b] - scores[a]);
  const top = ranked.slice(0, k).map((i) => ({ i, score: round(scores[i]), ...index.chunks[i] }));

  if (expand > 0 && index.graph && top.length) {
    const seen = new Set(top.map((h) => h.i));
    const hitFiles = new Set(top.map((h) => h.file));
    const nbFiles = new Set();
    for (const f of hitFiles) for (const g of index.graph[f] ?? []) if (!hitFiles.has(g)) nbFiles.add(g);
    if (nbFiles.size) {
      const extra = [];
      for (const i of ranked) {
        if (seen.has(i)) continue;
        if (!nbFiles.has(index.chunks[i].file)) continue;
        extra.push({ i, score: round(scores[i]), via: "graf", ...index.chunks[i] });
        if (extra.length >= expand) break;
      }
      top.push(...extra);
    }
  }
  return top;
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * İsteme gömülecek bağlam. İndeks yoksa/kurulamazsa null — çağıran sessizce
 * bağlamsız devam eder (özellik kapanmaz, sadece daha az bilir).
 *
 * @param {{query:string, k?:number, maxChars?:number, files?:RegExp|null, root?:string}} p
 * @returns {{text:string, chunks:object[], builtAt:string}|null}
 */
export function contextFor({ query, k = 6, maxChars = 6000, files = null, root = process.cwd() } = {}) {
  const index = ensureIndex({ root });
  if (!index) return null;
  const hits = search(index, query, { k, files });
  if (!hits.length) return { text: "", chunks: [], builtAt: index.builtAt };
  const blocks = [];
  const used = [];
  let total = 0;
  for (const h of hits) {
    const head = `--- ${h.file}:${h.line} · ${h.title}${h.via ? ` (${h.via})` : ""}`;
    const body = h.text.length > 1400 ? `${h.text.slice(0, 1400)}…` : h.text;
    const block = `${head}\n${body}`;
    if (total + block.length > maxChars) { if (used.length) break; }
    blocks.push(block);
    used.push({ file: h.file, line: h.line, title: h.title, score: h.score, via: h.via ?? null, nodeId: h.nodeId ?? null });
    total += block.length + 2;
    if (total >= maxChars) break;
  }
  return { text: blocks.join("\n\n"), chunks: used, builtAt: index.builtAt };
}

/** Bağlam bloğunu istem metnine dönüştürür (başlık + kural). */
export function renderContextBlock(ctx) {
  if (!ctx || !ctx.text) return "";
  return [
    "### İlgili repo bağlamı (ölçülmüş kurallar, mevcut spec/POM parçaları — kaynak: dosya:satır)",
    "Bu parçalar gerçek koddan ve ölçülmüş notlardan alındı. Seçici/rota/metin yazarken BUNLARA dayan;",
    "burada olmayan bir seçici ya da davranış uydurma.",
    "",
    ctx.text,
  ].join("\n");
}
