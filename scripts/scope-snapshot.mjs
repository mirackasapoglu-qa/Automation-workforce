#!/usr/bin/env node
/**
 * Kapsam ağacının belge dostu anlık görüntüsü → `docs/scope-tree.json`.
 *
 * NEDEN: terminaldeki agent'lar (özellikle `homee-pm-analyst`) ağacı okumak
 * zorunda ama panelin ayakta olduğuna güvenemez. Ağaç zaten diskte
 * (`panel-data/scope/tree.json`) — bu script onu OKUYUP özetle birlikte
 * sabit bir yola yazar. Yani panel açık olmasa da belge üretilebiliyor.
 *
 * ⚠️ Çıktı `docs/scope-tree.json` ve **gitignore'da**: müşteri ürününün ham
 * ekran envanteri (147 düğüm, sayfa/bölüm adları) ve `origin` remote'u PUBLIC.
 * Agent'lar bu dosyayı yerelde okur, üretilen BELGELER (feature-inventory,
 * product-brief) commit edilir — hangi ağaçtan üretildiği `exportedAt` ile
 * belgede yazılı kalır.
 *
 * Koşum: node scripts/scope-snapshot.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const KAYNAK = path.join(ROOT, "panel-data", "scope", "tree.json");
const HEDEF = path.join(ROOT, "docs", "scope-tree.json");

if (!fs.existsSync(KAYNAK)) {
  console.error(`Kapsam ağacı yok: ${path.relative(ROOT, KAYNAK)}`);
  console.error("Paneli açıp (npm run up) ağacı doldurduktan sonra tekrar dene.");
  process.exit(1);
}

const ham = JSON.parse(fs.readFileSync(KAYNAK, "utf8"));
const tree = Array.isArray(ham) ? ham : (ham.tree ?? []);

/** Tip ve durum dağılımı + test case sayıları. Belgenin "genel bakış"ı. */
function ozet(agac) {
  const tip = {};
  const durum = {};
  let dugum = 0;
  let caseSayisi = 0;
  let kosulmus = 0;
  let uretilmis = 0;
  const kartlar = new Set();

  (function walk(a) {
    for (const n of a ?? []) {
      dugum++;
      tip[n.type ?? "?"] = (tip[n.type ?? "?"] ?? 0) + 1;
      durum[n.status ?? "?"] = (durum[n.status ?? "?"] ?? 0) + 1;
      for (const t of n.jiraTasks ?? []) if (t.taskId) kartlar.add(t.taskId);
      for (const tc of n.testCases ?? []) {
        caseSayisi++;
        if ((tc.runs ?? []).length) kosulmus++;
        if (tc.generated) uretilmis++;
        if (tc.jiraKey) kartlar.add(tc.jiraKey);
      }
      walk(n.children);
    }
  })(agac);

  return {
    dugum,
    tip,
    durum,
    testCase: { toplam: caseSayisi, kosulmus, uretilmis, kosulmamis: caseSayisi - kosulmus },
    jiraKart: [...kartlar].sort(),
  };
}

/** Ağacı düz yol listesine çevirir — belgede tablo kurmak için en kullanışlısı. */
function duzYol(agac) {
  const satirlar = [];
  (function walk(a, yol) {
    for (const n of a ?? []) {
      const p = yol ? `${yol} › ${n.name}` : n.name;
      satirlar.push({
        id: n.id,
        yol: p,
        tip: n.type ?? null,
        durum: n.status ?? null,
        testCase: (n.testCases ?? []).length,
        jira: (n.jiraTasks ?? []).map((t) => t.taskId).filter(Boolean),
      });
      walk(n.children, p);
    }
  })(agac, "");
  return satirlar;
}

const cikti = {
  /* Zaman damgası: belgenin "kaynak veri" satırı buradan yazılıyor. */
  exportedAt: new Date().toISOString(),
  source: path.relative(ROOT, KAYNAK),
  summary: ozet(tree),
  nodes: duzYol(tree),
  tree,
};

fs.mkdirSync(path.dirname(HEDEF), { recursive: true });
fs.writeFileSync(HEDEF, JSON.stringify(cikti, null, 1));

const s = cikti.summary;
console.log(`✓ ${path.relative(ROOT, HEDEF)}`);
console.log(`  düğüm: ${s.dugum} · tip: ${JSON.stringify(s.tip)}`);
console.log(`  durum: ${JSON.stringify(s.durum)}`);
console.log(
  `  test case: ${s.testCase.toplam} (koşulmuş ${s.testCase.kosulmus} · üretilmiş ${s.testCase.uretilmis})`,
);
console.log(`  bağlı Jira kartı: ${s.jiraKart.length}`);
