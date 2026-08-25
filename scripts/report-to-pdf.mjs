#!/usr/bin/env node
/**
 * Bir HTML raporunu (Artifact icin yazilmis parca dosyalar dahil) PDF'e basar.
 *
 *   node scripts/report-to-pdf.mjs <girdi.html> <cikti.pdf>
 *
 * Artifact icin yazilan dosyalar PARCA'dir (doctype/head/body yok) — burada
 * kendi iskeletiyle sariliyor.
 * Yazdirmada tema light'a sabitleniyor (viewer temasina gore degisen PDF olmaz)
 * ve tablo basliklari thead'e tasiniyor ki sayfa basina tekrar bassin.
 *
 * Not: headless chromium shell kurulu degil; `channel: "chrome"` kullaniliyor —
 * playwright.config.ts de ayni kanali kullaniyor.
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";

const SRC = process.argv[2];
const OUT = process.argv[3];
const body = fs.readFileSync(SRC, "utf8");

const PRINT_CSS = `
  <style>
    @page { size: A4; margin: 14mm 13mm 16mm; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #fff !important; font-size: 10.5pt; }
    .wrap { max-width: none; padding: 0 !important; }
    header.top { padding-top: 0 !important; }
    h1 { font-size: 30pt !important; }
    h2 { font-size: 15pt !important; }
    .lede { font-size: 11.5pt !important; }
    /* Bolumler ve tablolar sayfa ortasindan bolunmesin */
    section { break-inside: auto; padding-top: 26px !important; }
    h2, h3 { break-after: avoid; }
    .tbl-scroll { overflow: visible !important; }
    thead { display: table-header-group; }   /* sayfa basina basligi tekrar bas */
    table { min-width: 0 !important; font-size: 9pt; }
    tr { break-inside: avoid; }
    .tiles { break-inside: avoid; }
    .built > div { break-inside: avoid; }
    .note { break-inside: avoid; }
    ul.tight li { break-inside: avoid; font-size: 10.5pt; }
    a { border-bottom: none !important; }
    footer { break-inside: avoid; }
  </style>`;

const html = `<!doctype html><html lang="tr" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${body.match(/<link[^>]*fonts\.[^>]*>/g)?.join("\n") ?? ""}
</head><body>${body}${PRINT_CSS}</body></html>`;

const tmp = ".pdf-gen-rapor.tmp.html";
fs.writeFileSync(tmp, html);

const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
await p.goto("file://" + process.cwd() + "/" + tmp, { waitUntil: "networkidle" });
// Google Fonts yuklensin — yoksa PDF fallback font ile basiliyor
await p.evaluate(() => document.fonts.ready);
// Sayfa degistiren tablonun basligi tekrarlasin: ilk satiri thead'e tasi.
// (Artifact HTML'i degismiyor — bu yalnizca yazdirma icin.)
await p.evaluate(() => {
  for (const t of document.querySelectorAll("table")) {
    const first = t.rows[0];
    if (!first || !first.querySelector("th") || t.tHead) continue;
    const head = t.createTHead();
    head.appendChild(first);
  }
});
await p.waitForTimeout(700);
await p.emulateMedia({ media: "print", colorScheme: "light" });
await p.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font:8pt ui-monospace,'Courier New',monospace;color:#8A939C;width:100%;padding:0 13mm;">
    Homee Bulgu Defteri — Tepe Home Redesign QA</div>`,
  footerTemplate: `<div style="font:8pt ui-monospace,'Courier New',monospace;color:#8A939C;width:100%;padding:0 13mm;display:flex;justify-content:space-between;">
    <span>21 Agustos 2026</span><span class="pageNumber"></span></div>`,
  margin: { top: "16mm", bottom: "16mm", left: "13mm", right: "13mm" },
});
await b.close();
fs.unlinkSync(tmp);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`PDF yazildi: ${OUT} (${kb} KB)`);
