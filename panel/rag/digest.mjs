/**
 * Sabit repo özeti — istemin ÖNBELLEĞE ALINAN kısmı.
 *
 * NEDEN: Anthropic prompt cache'i yalnızca 1024+ token'lık (Haiku'da 2048+)
 * sabit bir önek için devreye girer. Sistem talimatlarımız ~200 token; tek
 * başına `cache_control` bayrağı taşımak boşa gidiyordu (ölçüldü 2026-09-08).
 * Bu özet her istemde AYNI BAYTLARLA gönderilir: ilk çağrı önbelleğe yazar
 * (1.25×), sonraki bir saat boyunca 0.1× fiyatla okunur.
 *
 * İÇERİK (deterministik sıra, kesme paragraf sınırında):
 *   1) CLAUDE.md'nin ölçülmüş kural bölümleri (başlığında tuzak/hijyen/kural/
 *      guard/kimlik/ortam geçenler) — seçici tuzakları, test hijyeni, guard'lar
 *   2) docs/*.md — ürün özeti ve özellik envanteri
 * Hepsi `redactText`ten geçer: kapı şifresi gibi değerler modele gitmez.
 *
 * Sorgudan bağımsız olduğu için bağlam (RAG parçaları) değil, ZEMİN: model her
 * üretimde aynı kuralları görür; sorguya özel parçalar `contextFor` ile ayrıca
 * ve önbelleksiz kısımda gider.
 */
import fs from "node:fs";
import path from "node:path";
import { redactText } from "./redact.mjs";

const SECTION_RE = /tuzak|hijyen|kural|guard|kimlik|ortam/i;
let cache = { key: null, value: null };

/** `## ` başlıklarına göre böler (seviye 2). */
function splitSections(md) {
  const out = [];
  let cur = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+)/.exec(line);
    if (h && !line.startsWith("###")) {
      if (cur) out.push(cur);
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ title: s.title, body: s.body.join("\n") }));
}

/**
 * @param {{root?: string, maxChars?: number}} [opt]
 * @returns {{text: string, chars: number, tokensEst: number, sources: string[], redactions: number}}
 */
export function stableDigest({ root = process.cwd(), maxChars = 16000 } = {}) {
  const files = [];
  const claude = path.join(root, "CLAUDE.md");
  if (fs.existsSync(claude)) files.push(claude);
  const docs = path.join(root, "docs");
  try {
    for (const f of fs.readdirSync(docs).filter((x) => x.endsWith(".md")).sort()) files.push(path.join(docs, f));
  } catch { /* docs yok */ }

  const key = files.map((f) => { try { return `${f}:${fs.statSync(f).mtimeMs}`; } catch { return f; } }).join("|") + `|${maxChars}`;
  if (cache.key === key) return cache.value;

  const parts = [];
  const sources = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (path.basename(f) === "CLAUDE.md") {
      for (const s of splitSections(text).filter((x) => SECTION_RE.test(x.title))) {
        parts.push(`## ${s.title}\n${s.body.trim()}`);
        sources.push(`${rel} › ${s.title}`);
      }
    } else {
      parts.push(`## ${rel}\n${text.trim()}`);
      sources.push(rel);
    }
  }

  let text = parts.join("\n\n");
  if (text.length > maxChars) {
    const cut = text.lastIndexOf("\n\n", maxChars);
    text = `${text.slice(0, cut > maxChars * 0.6 ? cut : maxChars)}\n\n[… özet ${maxChars} karakterde kesildi]`;
  }
  const red = redactText(text);
  const value = {
    text: red.text,
    chars: red.text.length,
    tokensEst: Math.round(red.text.length / 4),
    sources,
    redactions: red.redactions,
  };
  cache = { key, value };
  return value;
}
