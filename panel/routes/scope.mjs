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
import { readTree, backfillRoutes, applyManualRuns } from "../scope.mjs";
import {
  deriveSummary, deriveRoutes, routesWithFallback, deriveJiraIndex, deriveRuns, deriveCases,
} from "../scope-bridge.mjs";
import { PROJECT } from "../project.mjs";
import { listPackages, savePackage, deletePackage } from "../type-packages.mjs";
import { readPackages, resolvePackageItems } from "../packages.mjs";
import { findNode } from "../scope.mjs";

export function registerScopeRoutes(router, ctx) {
  const { send, BASE_URL, RUNS } = ctx;

  /** Ağacı okurken hata ÇIKARSA panel tamamen körleşmesin — boş ağaçla devam. */
  const tree = () => {
    try { return readTree().tree; } catch { return []; }
  };

  const rotalar = (t) => routesWithFallback(t, {
    baseUrl: BASE_URL,
    quickRoutes: PROJECT.quickRoutes,
  });

  router.get("/api/scope/summary", ({ res }) => {
    const t = tree();
    const r = rotalar(t);
    return send(res, 200, {
      ok: true,
      baseUrl: BASE_URL ?? null,
      summary: deriveSummary(t, { baseUrl: BASE_URL }),
      routeSource: r.source,
      routes: r.routes,
      runs: deriveRuns(t, Object.keys(RUNS ?? {})),
      jira: deriveJiraIndex(t, { baseUrl: BASE_URL }),
      cases: deriveCases(t),
    });
  });

  router.get("/api/scope/routes", ({ res }) => {
    const r = rotalar(tree());
    return send(res, 200, { ok: true, source: r.source, baseUrl: BASE_URL ?? null, routes: r.routes });
  });

  router.get("/api/scope/jira", ({ res }) => {
    const t = tree();
    const idx = deriveJiraIndex(t, { baseUrl: BASE_URL });
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

    const cases = [];
    for (const it of resolvePackageItems(paketler, id)) {
      const node = findNode(tree, it.nodeId);
      const tc = node ? (node.testCases ?? []).find((t) => t.id === it.testCaseId) : null;
      // Kaynağı silinmiş referans SESSİZCE atlanmaz: ekranda "kayıp" olarak görünür.
      if (!node || !tc) { cases.push({ nodeId: it.nodeId, testCaseId: it.testCaseId, missing: true }); continue; }
      cases.push({
        nodeId: node.id,
        nodeName: node.name ?? "",
        testCaseId: tc.id,
        title: tc.title ?? "",
        automated: !!tc.automated,
        spec: tc.spec ?? null,
        steps: (tc.steps ?? []).map((st) => ({ action: st.action ?? "", expected: st.expected ?? "" })),
        lastRun: (tc.runs ?? []).at(-1) ?? null,
      });
    }
    return send(res, 200, { ok: true, id: pkg.id, name: pkg.name, cases });
  });

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
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
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
    const out = paketler.map((pkg) => {
      const items = resolvePackageItems(paketler, pkg.id);
      const specs = new Set();
      const nodes = new Set();
      let elle = 0, eksik = 0;
      for (const it of items) {
        const node = findNode(tree, it.nodeId);
        if (!node) { eksik++; continue; }
        const tc = (node.testCases ?? []).find((t) => t.id === it.testCaseId);
        if (!tc) { eksik++; continue; }
        const nodeSpecs = node.runRef?.specs ?? [];
        // Case'in kendi spec'i varsa o; yoksa düğümün spec'leri.
        const aday = tc.spec ? [tc.spec] : nodeSpecs;
        if (!aday.length) { elle++; continue; }
        nodes.add(node.id);
        for (const sp of aday) specs.add(sp);
      }
      return {
        id: pkg.id,
        name: pkg.name,
        cases: items.length,
        specs: [...specs],
        nodes: [...nodes],
        manualCases: elle,
        missingRefs: eksik,
      };
    });
    return send(res, 200, { ok: true, packages: out });
  });

  /**
   * Perf süpürmesinin ölçeceği rotalar — `scripts/perf-sweep.mjs --routes` için
   * hazır, virgüllü tek satır. Ağaçta rota yoksa boş döner ve süpürme kendi
   * `tests/routes.ts` taban listesine düşer (davranış değişmez).
   */
  router.get("/api/scope/perf-targets", ({ res, url }) => {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    const r = deriveRoutes(tree(), { baseUrl: BASE_URL });
    // Sorgu dizeli rotalar ölçümde tekrara düşüyor (aynı sayfa, farklı parametre);
    // ölçüm hedefi olarak yol yeterli.
    const yollar = [...new Set(r.map((x) => String(x.path).split("?")[0] || "/"))].slice(0, limit);
    return send(res, 200, { ok: true, count: yollar.length, routes: yollar, arg: yollar.join(",") });
  });
}
