/**
 * Kapsam (Flowscope) → panel uçları.
 *
 *   GET /api/scope/summary  — panelin ALTI bölümünün ortak veri kaynağı:
 *                             özet sayaçlar, rotalar, koşum bağları, Jira dizini,
 *                             test case listesi. Açık (okuma, yan etkisiz).
 *   GET /api/scope/routes   — yalnız rota listesi (Site canlı + perf hedefleri).
 *   GET /api/scope/jira     — kart → düğüm dizini (Jira sekmesi).
 *
 * NEDEN TEK UÇ + iki dar uç: panelin Genel bakış sekmesi hepsini birden ister
 * (tek istek), Site/Performans sekmeleri yalnız rotayı ister (küçük yanıt).
 * İkisini tek uca sıkıştırmak her sekme geçişinde tüm ağacın türetilmesi
 * demekti; üç ayrı uç yazmak da aynı türetmenin üç kopyası olurdu — türetme
 * `scope-bridge.mjs`'te tek, uçlar ince.
 *
 * ⚠️ Bu uçlar ağacı DEĞİŞTİRMEZ. Yazma yolları (koşum sonucu, perf, Jira
 * bağlama, sweep'ler) kendi uçlarında ve hepsi token ister.
 */
import { readTree, backfillRoutes, applyManualRuns, addRecordedCase } from "../scope.mjs";
import { recordPackageRun, listPackageRuns, getPackageRun } from "../package-runs.mjs";
import * as recSpec from "../recorded-spec.mjs";
import { slugify, pickFilename, storeSpec, specExists } from "../spec-gen.mjs";
import {
  deriveSummary, deriveRoutes, routesWithFallback, deriveJiraIndex, deriveRuns, deriveCases, deriveFindings,
} from "../scope-bridge.mjs";
import { PROJECT } from "../project.mjs";
import { resolveActive, activeSubtree, writeActiveId, productSlug } from "../active-product.mjs";
import * as cred from "../product-credentials.mjs";
import { listPackages, savePackage, deletePackage } from "../type-packages.mjs";
import { readPackages, resolvePackageItems, resolvePackageCases } from "../packages.mjs";
import { findNode } from "../scope.mjs";
import { FIGMA_ROUTES } from "../figma-map.mjs";

export function registerScopeRoutes(router, ctx) {
  const { send, BASE_URL, RUNS } = ctx;

  /** Ağacı okurken hata ÇIKARSA panel tamamen körleşmesin — boş ağaçla devam. */
  const tamAgac = () => {
    try { return readTree().tree; } catch { return []; }
  };

  /**
   * ⚠️ PANELİN SİTEYE BAKAN HER TÜRETMESİ AKTİF ÜRÜNÜN ALT AĞACINDAN.
   *
   * Ağaçta birden fazla kök (= ürün) olabiliyor; tamamını birlikte türetmek
   * "başka sitenin rotaları bu panelde" gibi bir çorba üretiyordu
   * (ölçüldü: tek ağaçta iki ürün, 151 düğüm). Adres de profilin `.env`
   * değerinden değil, aktif ürünün taranmış adresinden geliyor.
   */
  const aktif = () => {
    const t = tamAgac();
    const { active, products } = resolveActive(t, { profileBaseUrl: BASE_URL });
    return { tree: activeSubtree(t, active), active, products, baseUrl: active?.baseUrl ?? BASE_URL };
  };

  const rotalar = (t, baseUrl) => routesWithFallback(t, {
    baseUrl,
    // Profil yedeği YALNIZCA repo'nun kendi ürünü aktifken anlamlı — başka bir
    // ürün seçiliyken profilin rotalarını göstermek çorbanın ta kendisiydi.
    quickRoutes: (baseUrl === BASE_URL) ? PROJECT.quickRoutes : [],
  });

  /** Ürün listesi + aktif seçim. */
  router.get("/api/scope/products", ({ res }) => {
    const { active, products } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    return send(res, 200, { ok: true, active, products, profileBaseUrl: BASE_URL ?? null });
  });

  router.post("/api/scope/products/active", ({ res, body, audit }) => {
    const id = String(body?.nodeId ?? "").trim();
    if (!id) return send(res, 400, { ok: false, error: "nodeId zorunlu" });
    const { products } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    if (!products.some((x) => x.nodeId === id)) return send(res, 404, { ok: false, error: `Ürün bulunamadı: ${id}` });
    writeActiveId(id);
    audit({ event: "scope-active-product", nodeId: id });
    const { active } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    return send(res, 200, { ok: true, active, products });
  }, { auth: true, body: true });

  /**
   * Aktif ürün için Figma eşlemesi var mı? Profil ürününde profilin sabit
   * haritası; yabancı üründe ağaçtaki node-id'li Figma linkleri sayılır
   * (server.mjs → figmaOverrideForPath ile aynı kural). Panel "Tasarım diff"
   * sekmesini ve Site'deki diff düğmesini buna göre gösterir/gizler.
   */
  const tasarimDurumu = (t, active) => {
    const profil = active?.isProfile !== false;
    if (profil) return { figma: FIGMA_ROUTES.length > 0, source: FIGMA_ROUTES.length ? "profile" : null, links: 0 };
    let links = 0;
    (function walk(a) {
      for (const n of a ?? []) {
        for (const rl of n.resourceLinks ?? []) {
          const u = String(rl?.url ?? "");
          if (/figma\.com/i.test(u) && /[?&]node-id=/.test(u)) links++;
        }
        walk(n.children);
      }
    })(t);
    return { figma: links > 0, source: links ? "scope" : null, links };
  };

  router.get("/api/scope/summary", ({ res }) => {
    const { tree: t, active, products, baseUrl } = aktif();
    const r = rotalar(t, baseUrl);
    return send(res, 200, {
      ok: true,
      baseUrl: baseUrl ?? null,
      active,
      products,
      profileBaseUrl: BASE_URL ?? null,
      design: tasarimDurumu(t, active),
      summary: deriveSummary(t, { baseUrl }),
      routeSource: r.source,
      routes: r.routes,
      runs: deriveRuns(t, Object.keys(RUNS ?? {})),
      jira: deriveJiraIndex(t, { baseUrl }),
      cases: deriveCases(t),
      findings: deriveFindings(t),
    });
  });

  router.get("/api/scope/routes", ({ res }) => {
    const { tree: t, baseUrl, active } = aktif();
    const r = rotalar(t, baseUrl);
    return send(res, 200, { ok: true, source: r.source, baseUrl: baseUrl ?? null, active, routes: r.routes });
  });

  router.get("/api/scope/jira", ({ res }) => {
    const { tree: t, baseUrl } = aktif();
    const idx = deriveJiraIndex(t, { baseUrl });
    return send(res, 200, {
      ok: true,
      keys: Object.keys(idx),
      index: idx,
      /** Ağaçta hiç düğüme bağlanmamış olmak da bir sinyal — panel bunu gösteriyor. */
      unlinkedHint: "Bu dizinde olmayan kart hiçbir kapsam düğümüne bağlı değildir.",
    });
  });

  /**
   * Bir paketin case'leri — ADIMLARIYLA birlikte (elle koşum ekranı için).
   *
   * `/api/scope/packages/runnable` yalnız "kaç case, hangi spec" özetini
   * veriyor; elle koşum ekranı adımları da göstermek zorunda, yoksa insan neyi
   * yürüteceğini bilemez. Ayrı uç, çünkü adımlar liste ekranında gereksiz
   * yükten başka bir şey değil.
   */
  router.get("/api/scope/package-cases", ({ res, url }) => {
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return send(res, 400, { ok: false, error: "id zorunlu" });
    const { tree } = (() => { try { return readTree(); } catch { return { tree: [] }; } })();
    const paketler = readPackages();
    const pkg = paketler.find((x) => x.id === id);
    if (!pkg) return send(res, 404, { ok: false, error: `Paket bulunamadı: ${id}` });
    // Kaynağı silinmiş referans SESSİZCE atlanmaz: ekranda "kayıp" olarak görünür.
    return send(res, 200, { ok: true, id: pkg.id, name: pkg.name, cases: resolvePackageCases(tree, paketler, id, findNode) });
  });

  /**
   * PAKET KOŞUM DEFTERİ (bkz. package-runs.mjs). Sonuçlar sekmesinin kaynağı:
   * her paket koşumu kendi case satırlarıyla KALICI — `results.json` ezilse de
   * eski koşumlar burada durur. `?packageId=` süzer, `?cases=0` satırları atar.
   */
  router.get("/api/scope/package-runs", ({ res, url }) => {
    const packageId = url.searchParams.get("packageId") || null;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const withCases = url.searchParams.get("cases") !== "0";
    return send(res, 200, { ok: true, runs: listPackageRuns({ packageId, limit, withCases }) });
  });

  router.get("/api/scope/package-run", ({ res, url }) => {
    const id = String(url.searchParams.get("id") ?? "").trim();
    const run = id ? getPackageRun(id) : null;
    return run ? send(res, 200, { ok: true, run }) : send(res, 404, { ok: false, error: "Koşum kaydı bulunamadı" });
  });

  /**
   * KAYITTAN TEST CASE — Site (canlı) kaydedicisinin "Bitir" çıkışı.
   *
   * Gövde: `{ title, steps: [kaydedici adımları], path, nodeId? }`.
   * Düğüm: verilmişse o; yoksa aktif ürünün ağacında rotası `path` olan
   * düğüm; o da yoksa ürünün kökü (case kaybolmasın, kullanıcı Flowscope'ta
   * taşıyabilir). Adımlar insan-okunur case adımlarına çevrilir, ayrıca
   * deterministik bir Playwright spec'i `tests/gen-rec-<slug>.spec.ts` olarak
   * yazılıp case'e bağlanır — paket koşumunda otomatik çalışır, elle koşumda
   * adımlar ekranda görünür. Model çağrısı YOK.
   */
  router.post("/api/scope/testcases/record", ({ res, body, audit }) => {
    const title = String(body?.title ?? "").trim();
    const steps = Array.isArray(body?.steps) ? body.steps : [];
    if (!title) return send(res, 400, { ok: false, error: "Case adı zorunlu" });
    if (!steps.length) return send(res, 400, { ok: false, error: "Kaydedilmiş adım yok" });
    const rota = String(body?.path || steps.find((s) => s?.action === "goto")?.value || "/");

    const { tree: t, active, baseUrl } = aktif();
    let nodeId = String(body?.nodeId ?? "").trim() || null;
    if (!nodeId) {
      const temiz = (rota.split("#")[0] || "/").replace(/\/+$/, "") || "/";
      const r = deriveRoutes(t, { baseUrl }).find((x) => x.path === rota || x.path === temiz || String(x.path).split("?")[0] === temiz);
      nodeId = r?.nodeId ?? t[0]?.id ?? null;
    }
    if (!nodeId) return send(res, 400, { ok: false, error: "Kapsam ağacı boş — önce Home'dan bir adres tara." });
    const node = findNode(t, nodeId);
    if (!node) return send(res, 404, { ok: false, error: `Düğüm bulunamadı: ${nodeId}` });

    let dosya = null;
    try {
      dosya = pickFilename(`rec-${slugify(title)}`);
      const kod = recSpec.renderSpec({ title, steps, product: active?.name ?? "", node: { name: node.name, nodeId: node.id }, path: rota });
      // renderSpec kendi basligini tasiyor; spec-gen.writeSpec'in basligi ikinci
      // kez eklenmesin — ama yazma yolu ORTAK olmali: dogrudan `tests/`e yazmak
      // dosyayi ilk deploy'da ucuruyordu (olculdu 2026-09-15: "Bilinmeyen spec:
      // gen-rec-login-akisi.spec.ts", agac istiyor, imajda dosya yok).
      storeSpec(dosya, kod);
    } catch (e) {
      // Spec yazılamazsa case YİNE açılır (elle koşulabilir); sebep yanıtta.
      dosya = null;
      audit({ event: "scope-record-spec-error", message: String(e.message).slice(0, 160) });
    }

    try {
      const out = addRecordedCase({ nodeId, title, steps: recSpec.toCaseSteps(steps), recorded: steps, spec: dosya, path: rota });
      audit({ event: "scope-record-case", nodeId, testCaseId: out.testCaseId, steps: steps.length, asserts: recSpec.assertCount(steps), spec: dosya });
      return send(res, 200, { ok: true, ...out, spec: dosya, asserts: recSpec.assertCount(steps), steps: steps.length, path: rota });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  /**
   * ELLE KOŞUM KAYDI. Panelin "elle koş" akışı (paketteki case'leri sırayla
   * önüne getirip Geçti/Kaldı işaretletir) sonucu buraya yazar.
   *
   * Gövde: `{ entries: [{nodeId, testCaseId, status, note}], label }`
   * Durum yalnız ✅ / ❌ / ⚠️ olabilir; geçersiz satır ATLANIR ve sebebiyle
   * birlikte döner — tek bozuk satır yüzünden koşumun tamamını reddetmek,
   * insanın 20 dakikalık işini çöpe atardı.
   */
  router.post("/api/scope/testcases/run", ({ res, body, audit }) => {
    try {
      const out = applyManualRuns({ entries: body?.entries, label: body?.label });
      audit({ event: "scope-manual-run", written: out.written, label: String(body?.label ?? "").slice(0, 60) });
      /*
       * Paketten geldiyse (packageId) DEFTERE de düşer — Sonuçlar sekmesi elle
       * koşumu da otomatik koşumla aynı listede, kalıcı görsün. Deftere yazma
       * hatası kayıt yazımını (ağaç) DÜŞÜRMEZ; sebep yanıtta.
       */
      let packageRun = null;
      if (body?.packageId) {
        try {
          const durumMap = { "✅": "✅", "❌": "❌", "⚠️": "⚠️" };
          packageRun = recordPackageRun({
            packageId: String(body.packageId),
            packageName: String(body.label ?? body.packageId),
            mode: "manual",
            product: aktif().active?.name ?? null,
            startedAt: body.startedAt ?? undefined,
            durationMs: Number(body.durationMs) || null,
            code: 0,
            cases: (out.results ?? []).map((r) => ({
              nodeId: r.nodeId, testCaseId: r.testCaseId, title: r.title ?? "",
              nodeName: (() => { try { return findNode(readTree().tree, r.nodeId)?.name ?? ""; } catch { return ""; } })(),
              status: r.error ? "⚠️" : (durumMap[r.status] ?? "⚠️"),
              error: r.error ?? "",
              note: (body.entries ?? []).find((e) => e.testCaseId === r.testCaseId)?.note ?? "",
            })),
          }).id;
        } catch (e) { out.packageRunError = e.message; }
      }
      return send(res, 200, { ok: true, ...out, packageRun });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  /**
   * ÜRÜN GİRİŞ BİLGİLERİ — login akışı testleri için.
   *
   * ⚠️ Parola HİÇBİR yanıtta dönmez (`publicView`): okuma ucu yalnız kullanıcı
   * adını ve "parola var mı" bilgisini verir. Parola sadece koşum sürecine
   * ortam değişkeni olarak geçer (bkz. run-engine → productEnv).
   */
  router.get("/api/scope/credentials", ({ res }) => {
    const { active } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    if (!active) return send(res, 200, { ok: true, product: null, credentials: null });
    return send(res, 200, {
      ok: true,
      product: { nodeId: active.nodeId, name: active.name, baseUrl: active.baseUrl },
      credentials: cred.get(productSlug(active)),
    });
  });

  router.post("/api/scope/credentials", ({ res, body, audit }) => {
    const { active } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    if (!active) return send(res, 400, { ok: false, error: "Aktif ürün yok" });
    try {
      const out = cred.save(productSlug(active), body ?? {});
      // ⚠️ Denetim kaydına yalnız ALAN ADLARI düşer, değerler değil.
      audit({ event: "product-credentials-save", product: productSlug(active), username: Boolean(out.username) });
      return send(res, 200, { ok: true, credentials: out });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/scope/credentials/remove", ({ res, audit }) => {
    const { active } = resolveActive(tamAgac(), { profileBaseUrl: BASE_URL });
    if (!active) return send(res, 400, { ok: false, error: "Aktif ürün yok" });
    const out = cred.remove(productSlug(active));
    audit({ event: "product-credentials-remove", product: productSlug(active), removed: out.removed });
    return send(res, 200, { ok: true, ...out });
  }, { auth: true, body: true });

  /**
   * Rota taşımayan eski düğümlere göreli rotayı yazar (bkz. scope.mjs →
   * backfillRoutes). Panelin "kapsam profil listesine düşüyor" uyarısındaki
   * tek tıklık çözüm. Tekrar çağırmak güvenli: zaten rotası olan düğüme
   * dokunulmaz, yazacak bir şey yoksa ağaç hiç yazılmaz.
   */
  router.post("/api/scope/backfill-routes", ({ res, audit }) => {
    const out = backfillRoutes();
    audit({ event: "scope-backfill-routes", written: out.written });
    return send(res, 200, { ok: true, ...out });
  }, { auth: true });

  /**
   * TÜR PAKETLERİ — isimlendirilmiş test türü kombinasyonları.
   * (Case koleksiyonu olan "Paketler" AYRI bir şey: panel/routes/packages.mjs.)
   * Okuma açık (liste bir tercih kaydı, sır değil), yazma token ister.
   * Depo ve doğrulama `panel/type-packages.mjs` içinde.
   */
  router.get("/api/type-packages", ({ res }) => send(res, 200, { ok: true, packages: listPackages() }));

  router.post("/api/type-packages", ({ res, body, audit }) => {
    try {
      const kayit = savePackage(body ?? {});
      audit({ event: "type-package-save", id: kayit.id, label: kayit.label, types: kayit.types.length });
      return send(res, 200, { ok: true, package: kayit, packages: listPackages() });
    } catch (e) {
      // Doğrulama hatası kullanıcıya AYNEN gösterilir ("En az bir test türü
      // seçilmeli" gibi); 400, çünkü isteğin kendisi eksik.
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  router.post("/api/type-packages/delete", ({ res, body, audit }) => {
    try {
      const out = deletePackage(body?.id);
      audit({ event: "type-package-delete", id: out.deleted });
      return send(res, 200, { ok: true, ...out, packages: listPackages() });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }, { auth: true, body: true });

  /**
   * PAKET → KOŞULABİLİR SPEC LİSTESİ.
   *
   * Panelin "Koşumlar" sekmesi paketi TEK bir parametreli koşumla çalıştırıyor:
   * paketin case'lerinin bağlı olduğu düğümlerin `runRef.specs`i toplanıyor.
   * Flowscope'taki sıralı koşumdan (`packages-run.js`, düğüm düğüm) farkı bu —
   * tek Playwright süreci, tek `results.json`, sonuç yine ağaca yazılıyor.
   *
   * ⚠️ Whitelist güvenliği yerinde: dönen spec'ler `/api/run`'ın parametreli
   * yolundan geçiyor ve orada `tests/` altındaki dosyalarla DOĞRULANIYOR.
   * Bu uç yalnızca "hangi spec'ler" sorusunu cevaplıyor, komut üretmiyor.
   *
   * Otomatik karşılığı olmayan (elle) case'ler ayrıca raporlanır: paketin 10
   * case'i varken 3'ünün koşulması sessiz kalmamalı.
   */
  router.get("/api/scope/packages/runnable", ({ res }) => {
    const { tree } = (() => { try { return readTree(); } catch { return { tree: [] }; } })();
    const paketler = readPackages();
    /*
     * GİRİŞ BİLGİSİ GEREKİYOR MU? Kullanıcı canlıda "login akışı" case'i olan
     * bir paketi koşamadı ve kimliği nereye gireceğini bulamadı (2026-09-15).
     * Kimliği istemek için doğru an, paketin yanında: arayüz bu bayrağı görünce
     * satıra "giriş bilgisi ekle" uyarısı koyuyor. Sezgisel — case/spec adına
     * bakar, yanlış pozitifi zararsız (yalnız bir uyarı), yanlış negatifi de
     * (kimlik zaten üst bardaki düğmeden girilebiliyor).
     */
    const aktifUrun = aktif();
    const kimlik = cred.get(productSlug(aktifUrun.active));
    const loginMi = (metin) => /login|giri[sş]|oturum|sign[- ]?in|log[- ]?in|üye ol|kay[ıi]t ol/i.test(String(metin ?? ""));
    const out = paketler.map((pkg) => {
      const items = resolvePackageItems(paketler, pkg.id);
      const specs = new Set();
      const nodes = new Set();
      let elle = 0, eksik = 0, login = false;
      const kayipSpec = new Set();
      const aiSpec = new Set();
      for (const it of items) {
        const node = findNode(tree, it.nodeId);
        if (!node) { eksik++; continue; }
        const tc = (node.testCases ?? []).find((t) => t.id === it.testCaseId);
        if (!tc) { eksik++; continue; }
        const nodeSpecs = node.runRef?.specs ?? [];
        // Case'in kendi spec'i varsa o; yoksa düğümün spec'leri.
        if (loginMi(tc.title) || loginMi(tc.spec)) login = true;
        /*
         * DOSYASI KAYBOLMUS SPEC = "elle" muamelesi. Case'in `spec` alani dolu
         * diye onu otomatik saymak, paketi hem kosulamaz hem de "otomatige
         * cevir" dugmesi gizli birakiyordu — kullanicinin elinde hicbir yol
         * kalmiyordu (olculdu 2026-09-15 canlida: gen-salon.spec.ts).
         */
        if (tc.spec && !specExists(tc.spec)) { kayipSpec.add(tc.spec); elle++; continue; }
        const aday = (tc.spec ? [tc.spec] : nodeSpecs).filter((sp) => specExists(sp));
        if (!aday.length) {
          for (const sp of tc.spec ? [tc.spec] : nodeSpecs) kayipSpec.add(sp);
          elle++;
          continue;
        }
        nodes.add(node.id);
        // Kayittan uretilenler (gen-rec-*) ucretsiz ve otomatik tazeleniyor;
        // AI uretimi olanlar ancak model cagrisiyla yenilenir — arayuz ayirt etsin.
        for (const sp of aday) { specs.add(sp); if (/^gen-(?!rec-)/.test(sp)) aiSpec.add(sp); }
      }
      return {
        id: pkg.id,
        name: pkg.name,
        cases: items.length,
        specs: [...specs],
        nodes: [...nodes],
        manualCases: elle,
        missingRefs: eksik,
        needsLogin: login,
        missingSpecs: [...kayipSpec],
        aiSpecs: [...aiSpec],
      };
    });
    return send(res, 200, {
      ok: true,
      packages: out,
      // Parola DÖNMEZ; arayüzün tek ihtiyacı "kayıt var mı" (bkz. product-credentials.mjs).
      credentials: { saved: Boolean(kimlik?.hasPassword), username: kimlik?.username ?? "" },
    });
  });

  /**
   * Perf süpürmesinin ölçeceği rotalar — `scripts/perf-sweep.mjs --routes` için
   * hazır, virgüllü tek satır. Ağaçta rota yoksa boş döner ve süpürme kendi
   * `tests/routes.ts` taban listesine düşer (davranış değişmez).
   */
  router.get("/api/scope/perf-targets", ({ res, url }) => {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    const { tree: t, baseUrl } = aktif();
    const r = deriveRoutes(t, { baseUrl });
    // Sorgu dizeli rotalar ölçümde tekrara düşüyor (aynı sayfa, farklı parametre);
    // ölçüm hedefi olarak yol yeterli.
    const yollar = [...new Set(r.map((x) => String(x.path).split("?")[0] || "/"))].slice(0, limit);
    return send(res, 200, { ok: true, count: yollar.length, routes: yollar, arg: yollar.join(",") });
  });
}
