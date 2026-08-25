#!/usr/bin/env node
/**
 * Panel taşınabilirlik denetimi.
 *
 * Değişmez: **panel çekirdeği hangi projede koştuğunu bilmez.** Proje adı, Jira
 * anahtarı, Figma dosyası, host ve rota/kart eşlemeleri yalnızca şu iki yerde
 * durabilir:
 *   - panel/projects/<proje>.mjs   → proje profili (kod)
 *   - panel/runs.json              → koşum whitelist'i (.env gibi proje başına değişir)
 *
 * Çekirdek dosyalarda (panel/*.mjs, panel/public/*.html) proje referansı
 * bulunursa bu script çıkış kodu 1 ile kırar. Bağımlılık yok.
 *
 * Kullanım: npm run panel:check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = path.join(ROOT, "panel");

/** Profilden okunan, çekirdekte GEÇMEMESİ gereken proje işaretleri. */
function projectTokens() {
  const dir = path.join(PANEL, "projects");
  const tokens = new Set();
  if (!fs.existsSync(dir)) return [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    tokens.add(f.replace(/\.mjs$/, "")); // profil adı (örn. "homee")
    // Jira proje anahtarı → kart öneki (MAC-1234)
    for (const m of src.matchAll(/project:\s*"([A-Z][A-Z0-9]+)"/g)) tokens.add(m[1] + "-");
    // Jira host'unun alan adı (örn. "machinarium")
    for (const m of src.matchAll(/host:\s*"https:\/\/([a-z0-9-]+)\./g)) tokens.add(m[1]);
    // API host eşleşmesi (örn. "tepehome")
    for (const m of src.matchAll(/apiHostMatch\s*=\s*"([^"]+)"/g)) tokens.add(m[1]);
    // Dayanak önekleri (HOMEE-, MAC-)
    for (const m of src.matchAll(/issuePrefixes\s*=\s*\[([^\]]+)\]/g)) {
      for (const q of m[1].matchAll(/"([^"]+)"/g)) tokens.add(q[1] + "-");
    }
  }
  return [...tokens].filter((t) => t.length >= 3);
}

function coreFiles() {
  const out = [];
  for (const f of fs.readdirSync(PANEL)) {
    if (f.endsWith(".mjs") && !f.endsWith(".test.mjs")) out.push(path.join(PANEL, f));
  }
  const pub = path.join(PANEL, "public");
  if (fs.existsSync(pub)) {
    for (const f of fs.readdirSync(pub)) {
      if (f.endsWith(".html") || f.endsWith(".js")) out.push(path.join(pub, f));
    }
  }
  return out;
}

const tokens = projectTokens();
if (!tokens.length) {
  console.error("panel/projects/ içinde profil yok — denetlenecek işaret bulunamadı.");
  process.exit(1);
}

const hits = [];
for (const file of coreFiles()) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const t of tokens) {
      if (line.toLowerCase().includes(t.toLowerCase())) {
        hits.push({ file: path.relative(ROOT, file), line: i + 1, token: t, text: line.trim() });
      }
    }
  });
}

console.log(`denetlenen isaret: ${tokens.join(", ")}`);
console.log(`denetlenen dosya:  ${coreFiles().length}`);

if (hits.length) {
  console.error(`\n✗ cekirdekte ${hits.length} proje referansi var — profile tasi:\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.token}]  ${h.text.slice(0, 100)}`);
  }
  console.error("\nProje bilgisi yalnizca panel/projects/<proje>.mjs ve panel/runs.json icinde durabilir.");
  process.exit(1);
}

console.log("\n✓ cekirdek temiz: proje bilgisi yalnizca profilde.");
