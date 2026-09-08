#!/usr/bin/env node
/**
 * RAG indeksini kurar / sorgular — terminalden.
 *
 *   node scripts/rag-index.mjs                 # kur, panel-data/rag/index.json'a yaz, özet bas
 *   node scripts/rag-index.mjs --query "sepet adet artır 406"   # en iyi 8 parçayı göster
 *   node scripts/rag-index.mjs --query "..." --k 5 --json        # makine okur
 *   node scripts/rag-index.mjs --context "..."                   # isteme girecek bloğu bas
 *
 * Panel bunu kendisi de yapar (`ensureIndex` bayatlıkta yeniden kurar); script
 * tanı ve "bu sorguya ne geliyor" sorusu için. Sunucuda `panel-data` volume
 * olduğu için imaj build'inde kurmanın anlamı yok — ilk istekte ~100 ms'de kurulur.
 */
import { loadEnv } from "../env.mjs";
import { buildIndex, saveIndex, loadIndex, stats } from "../panel/rag/index.mjs";
import { search, contextFor } from "../panel/rag/retrieve.mjs";

// .env'deki gizli DEGERLER maskelemenin en kesin katmani (rag/redact.mjs);
// script'ten kurulan indeks de sunucuyla ayni ortami gormeli.
loadEnv();

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
const has = (k) => argv.includes(k);

const query = arg("--query");
const ctxQuery = arg("--context");
const k = Number(arg("--k", 8)) || 8;

if (ctxQuery) {
  const ctx = contextFor({ query: ctxQuery, k });
  if (!ctx) { console.error("indeks kurulamadı"); process.exit(1); }
  console.log(has("--json") ? JSON.stringify(ctx, null, 1) : ctx.text || "(eşleşme yok)");
  process.exit(0);
}

if (query) {
  const index = loadIndex() ?? buildIndex();
  const hits = search(index, query, { k });
  if (has("--json")) { console.log(JSON.stringify(hits.map(({ text, ...h }) => h), null, 1)); process.exit(0); }
  if (!hits.length) { console.log("(eşleşme yok)"); process.exit(0); }
  for (const h of hits) {
    console.log(`${String(h.score).padStart(7)}  ${h.file}:${h.line}  ${h.title}${h.via ? `  [${h.via}]` : ""}`);
  }
  process.exit(0);
}

const t0 = Date.now();
const index = buildIndex();
const file = saveIndex(index);
const s = stats(index);
console.log(`indeks yazıldı: ${file} (${Date.now() - t0} ms)`);
console.log(`  parça: ${s.chunks} · terim: ${s.terms} · kaynak dosya: ${s.sources} · graf dosya komşuluğu: ${s.graph} · maskelenen gizli değer: ${s.redactions}`);
console.log(`  türe göre: ${Object.entries(s.byKind).map(([k2, v]) => `${k2}=${v}`).join(" · ")}`);
