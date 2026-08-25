#!/usr/bin/env node
/**
 * "Panel ayağa kaldır" = QA paneli + landing/onboarding sitesi, birlikte.
 *
 * Panel  : node panel/server.mjs        → 4646 (arayüz) + 4647 (site proxy'si)
 * Landing: vite preview (statik build)  → 4321  (kaynak: ../homee-panel-site)
 *
 * Landing için dev sunucusu değil BUILD kullanılıyor: HMR'a ihtiyaç yok,
 * gösterime giden şey production çıktısı olsun. `dist/` yoksa önce build alır.
 *
 * Ctrl-C ikisini birden kapatır.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const SITE = process.env.LANDING_DIR || path.resolve(process.cwd(), "..", "homee-panel-site");
const PANEL_PORT = Number(process.env.PANEL_PORT || 4646);
const PROXY_PORT = PANEL_PORT + 1;
const SITE_PORT = Number(process.env.LANDING_PORT || 4321);

const children = [];
const C = { dim: "\x1b[2m", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", off: "\x1b[0m", b: "\x1b[1m" };

function run(name, cmd, args, cwd, color) {
  const ch = spawn(cmd, args, { cwd, env: process.env });
  children.push(ch);
  const pipe = (stream, isErr) =>
    stream.on("data", (d) => {
      for (const line of String(d).split("\n")) {
        if (line.trim()) process.stdout.write(`${color}[${name}]${C.off} ${isErr ? C.err : ""}${line}${C.off}\n`);
      }
    });
  pipe(ch.stdout, false);
  pipe(ch.stderr, true);
  ch.on("exit", (code) => {
    if (code) process.stdout.write(`${C.err}[${name}] cikti, kod ${code}${C.off}\n`);
  });
  return ch;
}

/**
 * Port kontrolu IPv4 ve IPv6'yi BIRLIKTE dener: `vite preview` localhost'a
 * baglaninca yalnizca ::1'de dinleyebiliyor, sadece 127.0.0.1 denemek
 * "acilmadi" diye yanlis uyari basiyordu.
 */
const tryHost = (port, host) =>
  new Promise((res) => {
    const s = net.connect({ port, host }, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
    s.setTimeout(700, () => { s.destroy(); res(false); });
  });

const portOpen = async (port) =>
  (await Promise.all([tryHost(port, "127.0.0.1"), tryHost(port, "::1")])).some(Boolean);

async function waitPort(port, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`${C.warn}[up] ${label} (${port}) acilmadi${C.off}\n`);
  return false;
}

// ---- panel
if (await portOpen(PANEL_PORT)) {
  console.log(`${C.warn}[up] ${PANEL_PORT} zaten dolu — panel baslatilmadi (calisan surec var).${C.off}`);
} else {
  run("panel", process.execPath, ["panel/server.mjs"], process.cwd(), C.ok);
}

// ---- landing
let siteUp = false;
if (!fs.existsSync(SITE)) {
  console.log(`${C.warn}[up] landing projesi yok: ${SITE} — yalnizca panel kaldirildi.${C.off}`);
} else if (await portOpen(SITE_PORT)) {
  console.log(`${C.warn}[up] ${SITE_PORT} zaten dolu — landing baslatilmadi.${C.off}`);
  siteUp = true;
} else {
  const dist = path.join(SITE, "dist", "index.html");
  if (!fs.existsSync(dist)) {
    console.log(`${C.dim}[up] landing dist/ yok, build aliniyor...${C.off}`);
    await new Promise((res, rej) => {
      const b = spawn("npm", ["run", "build"], { cwd: SITE, stdio: "inherit" });
      b.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build cikti kod ${c}`))));
    });
  }
  run("landing", "npx", ["vite", "preview", "--port", String(SITE_PORT), "--strictPort"], SITE, C.dim);
  siteUp = true;
}

await waitPort(PANEL_PORT, "panel");
if (siteUp) await waitPort(SITE_PORT, "landing");

console.log(`
${C.b}Hazir.${C.off}
  QA Paneli        → http://localhost:${PANEL_PORT}
  site proxy       → http://localhost:${PROXY_PORT}
${siteUp ? `  Landing          → http://localhost:${SITE_PORT}/
  Onboarding       → http://localhost:${SITE_PORT}/onboarding` : "  Landing          → kaldirilmadi"}

${C.dim}Ctrl-C ikisini birden kapatir.${C.off}`);

const bye = () => {
  for (const ch of children) ch.kill("SIGTERM");
  setTimeout(() => process.exit(0), 400);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
