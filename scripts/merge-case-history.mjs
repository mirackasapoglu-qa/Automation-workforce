#!/usr/bin/env node
/**
 * CLI'dan koşulan testlerin sonucunu case defterine işler.
 *
 * NEDEN VAR: `mergeHistory()` eskiden yalnızca panelden tetiklenen koşumların
 * sonunda çağrılıyordu. `npx playwright test ...` ile koşulan her şey ölçülmüş
 * olmasına rağmen deftere girmiyordu → panelin "Case'ler" sekmesi o case'leri
 * "hiç koşulmamış" gösteriyordu (2026-08-22'de 7 yeni checkout/sepet case'inde
 * tam bu oldu).
 *
 * Kullanım: koşumdan HEMEN SONRA (results.json bir sonraki koşumda eziliyor)
 *   npm run history:merge
 */
import { lastResults, mergeHistory, readHistory, lastOf } from "../panel/case-history.mjs";

const res = lastResults();
if (!res?.rows?.length) {
  console.error("✗ test-results/results.json okunamadı ya da boş — işlenecek koşum yok.");
  process.exit(1);
}

const merged = mergeHistory() ?? { added: 0, already: 0 };

const h = readHistory();
/*
 * `res.counts.failed` bilinen hatayı da düşen sayıyor: `test.fail()` işaretli test
 * Playwright'ta status="failed" + expectedStatus="failed" olarak geliyor. Defterde
 * bunlar "known" — özet satırında da ayrı sayılmalı, yoksa yeşil bir koşum
 * "1 düşen" gibi okunuyor.
 */
const tally = { passed: 0, failed: 0, known: 0, skipped: 0, other: 0 };
for (const r of res.rows) {
  const st = lastOf(h[`${r.file}||${r.title}`])?.status ?? "other";
  tally[st in tally ? st : "other"]++;
}
if (!merged.added) {
  console.log(
    `• Bu koşum (${res.startedAt}) zaten deftere işlenmiş — ${merged.already} case atlandı, ` +
      "yeni kayıt yazılmadı.",
  );
}
console.log(
  `✓ ${merged.added} case deftere işlendi (geçen ${tally.passed}, ` +
    `bilinen hata ${tally.known}, düşen ${tally.failed}, atlanan ${tally.skipped})` +
    ` — koşum: ${res.startedAt ?? "?"}`,
);
for (const r of res.rows) {
  const last = lastOf(h[`${r.file}||${r.title}`]);
  console.log(`  ${String(last?.status ?? "?").padEnd(11)} ${r.file} › ${r.title}`);
}
console.log(`Defterdeki toplam case: ${Object.keys(h).length}`);
