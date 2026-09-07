import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

/**
 * ORTAK UST BAR — panel/Flowscope ile AYNI dosyadan.
 *
 * Kaynak repo kokunde: `shared/nav/nav.{js,css}`. Panel sunucusu onu `/nav.js`
 * ve `/nav.css` adreslerinden servis ediyor; landing AYRI bir surecte (vite,
 * 4321) kostugu icin ayni dosyayi burada bir kez daha servis ediyoruz.
 * Kopyalamiyoruz — iki sunucu tek dosyayi OKUYOR. Bar'i degistirmek icin
 * yalnizca shared/nav/ degisir, uc yuzey birden guncellenir.
 *
 * ⚠️ `publicDir`e (site/public) kopyalamak cazip ama YANLIS: kopya, iki
 * kaynagin sessizce ayrilmasi demek. Tam da bu barin cozdugu sorun.
 *
 * Yuzey secimi giris dosyasindan: `onboarding/index.html` → onboarding,
 * digerleri → landing.
 */
function sharedNav(): PluginOption {
  const dir = fileURLToPath(new URL("../shared/nav/", import.meta.url));
  const read = (f: string) => fs.readFileSync(dir + f, "utf8");

  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== "/nav.js" && url !== "/nav.css") return next();
    res.setHeader("content-type", url.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(read(url.slice(1)));
  };

  return {
    name: "shared-nav",
    configureServer(server) { server.middlewares.use(serve); },
    configurePreviewServer(server) { server.middlewares.use(serve); },

    transformIndexHtml(_html, ctx) {
      const surface = ctx.path.includes("onboarding") ? "onboarding" : "landing";
      return [
        { tag: "link", attrs: { rel: "stylesheet", href: "/nav.css" }, injectTo: "head" as const },
        // Klasik script + hemen ardindan mount: bar, React girisinden (modul,
        // ertelenir) ONCE yerine oturur, sayfa acilisinda zipzip etmez.
        { tag: "script", attrs: { src: "/nav.js" }, injectTo: "body-prepend" as const },
        {
          tag: "script",
          // Kirilim kokU BURADAN geliyor: shared/nav cok projeli panelin
          // cekirdegi, icinde proje adi gecemez (bkz. npm run panel:check).
          children: `HqNav.mount({ surface: ${JSON.stringify(surface)}, root: "Homee QA" });`,
          injectTo: "body-prepend" as const,
        },
      ];
    },

    // `vite build` ciktisinda da ayni iki dosya dursun; dist tek basina servis
    // edilebilir olmali.
    generateBundle() {
      for (const f of ["nav.js", "nav.css"]) {
        this.emitFile({ type: "asset", fileName: f, source: read(f) });
      }
    },
  };
}

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
  plugins: [react(), dirEntrySlash(), sharedNav()],
  /* "@/..." → src/. 21st.dev / shadcn bilesenlerinin bekledigi takma ad.
     tsconfig.app.json'daki `paths` ile AYNI kalmali: biri digerinden saparsa
     tsc gecer ama build "cozulemeyen import" ile patlar. */
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
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
