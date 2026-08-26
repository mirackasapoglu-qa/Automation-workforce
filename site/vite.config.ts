import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `/onboarding` → `/onboarding/`
 *
 * NEDEN: SPA klasor girisine tasindi (`onboarding/index.html`), bu yuzden
 * statik sunucu yalnizca SONDAKI EGIK CIZGIYLE dogru dokumani buluyor.
 * Egik cizgisiz istek "bilinmeyen yol" sayilip SPA fallback'i ile KOK
 * index.html'e — yani yeni landing'e — dusuyordu. `npm run up` tam olarak
 * `http://localhost:4321/onboarding` adresini bastigi icin bu sessiz bir
 * yanlis sayfa demekti (olculdu: /onboarding basligi "Vesper.ai ..." donuyordu).
 */
function dirEntrySlash(): PluginOption {
  const rewrite = (req: IncomingMessage, _res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    for (const dir of ["/onboarding", "/landing"]) {
      if (url === dir) { req.url = `${dir}/`; return next(); }
      if (url.startsWith(`${dir}?`)) { req.url = `${dir}/${url.slice(dir.length)}`; return next(); }
    }
    next();
  };
  return {
    name: "dir-entry-slash",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

/**
 * IKI GIRIS:
 *   index.html            → tek dosyalik statik landing (Vesper.ai tasarimi).
 *                           React'e hic dokunmaz: inline CSS + tek IIFE.
 *   onboarding/index.html → React SPA, Onboarding sayfasi.
 *   landing/index.html    → React SPA, ESKI cok bolumlu landing (pages/Index),
 *                           karsilastirma icin `/landing` adresinde acik.
 *
 * Klasor girisi sayesinde cikti `dist/<ad>/index.html` oluyor, yani
 * `/onboarding` (up.mjs'in bastigi adres) ve `/landing` bozulmuyor.
 */
export default defineConfig({
  plugins: [react(), dirEntrySlash()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        onboarding: fileURLToPath(new URL("./onboarding/index.html", import.meta.url)),
        landing: fileURLToPath(new URL("./landing/index.html", import.meta.url)),
      },
    },
  },
});
