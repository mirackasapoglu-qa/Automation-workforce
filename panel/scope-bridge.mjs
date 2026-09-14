/**
 * Kapsam ağacı ↔ panel köprüsü — SAF katman (fs yok, HTTP yok, PROJECT yok).
 *
 * NEDEN VAR: panelin altı bölümü (Genel bakış · Koşumlar · Sonuçlar · Jira ·
 * Performans · Site canlı) bugüne kadar profildeki ELLE YAZILMIŞ listelerden
 * besleniyordu: `quickRoutes`, `routes.rules`, `cardSpecs`. Flowscope ise aynı
 * ürünün canlı, taranmış, durum taşıyan ağacını tutuyordu — ikisi birbirini
 * hiç görmüyordu. Ağaca yeni bir sayfa eklemek paneli değiştirmiyordu; profile
 * bir rota eklemek de ağaçta görünmüyordu.
 *
 * Bu dosya o boşluğu kapatan TEK yön dönüştürücü: ağaç → panelin anladığı
 * görünümler. Ters yön (panel sonucu → ağaç) `scope.mjs` içinde, çünkü orası
 * mutasyonun ve kalıcılığın sahibi.
 *
 * ⚠️ Profil SİLİNMEDİ, yedek oldu: ağaçta hiç site linki yoksa panel eski
 * `quickRoutes`'a düşer (bkz. `routesWithFallback`). Boş ağaçla açılan bir
 * panelin rota butonlarının tamamen kaybolması gerileme olurdu.
 *
 * ⚠️ Bu dosyadaki hiçbir fonksiyon ağacı DEĞİŞTİRMEZ. Türetme okuma yolunda
 * (her istekte, önbelleksiz de güvenli); mutasyon ayrı ve kasıtlı.
 */

const HTTP_RE = /^https?:\/\//i;

/** Kaynak linkinin tipi — `scope/js/resources.js::detectResourceType` ile AYNI kural. */
export function resourceKind(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes("figma.com")) return "figma";
    // Confluence, Jira ile aynı *.atlassian.net alanını "/wiki/" altında paylaşır.
    if (host.includes("confluence") || path.startsWith("/wiki/")) return "confluence";
    if (host.includes("atlassian.net") || host.includes("jira")) return "jira";
  } catch { /* geçersiz URL: genel link say */ }
  return "link";
}

/** URL'in host'u (yoksa null). */
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/**
 * Düğümün temsil ettiği CANLI SİTE adresi.
 *
 * Kaynak sırası: crawler düğümü kurarken adresi `resourceLinks[0]`'a
 * `type:"link"` olarak koyuyor (bkz. crawler.mjs). Elle eklenen linkler de aynı
 * listeye düşüyor. Figma/Confluence/Jira linkleri ELENİR — onlar drift
 * radarının girdisi, rota değil.
 *
 * @param {object} node
 * @param {string|null} baseHost  verilirse yalnız bu host'taki adres kabul edilir
 */
export function nodeSiteUrl(node, baseHost = null) {
  const adaylar = [];
  if (typeof node?.url === "string" && HTTP_RE.test(node.url)) adaylar.push(node.url);
  for (const rl of node?.resourceLinks ?? []) {
    const u = String(rl?.url ?? "").trim();
    if (!HTTP_RE.test(u)) continue;
    const tip = rl?.type && rl.type !== "link" ? rl.type : resourceKind(u);
    if (tip !== "link") continue;
    adaylar.push(u);
  }
  for (const u of adaylar) {
    if (!baseHost || hostOf(u) === baseHost) return u;
  }
  return null;
}

/** Mutlak URL → panelin kullandığı yol (`/sepet?x=1`). Çözülemezse null. */
export function toRoutePath(url) {
  try {
    const u = new URL(url);
    const yol = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return yol + (u.search || "");
  } catch { return null; }
}

/** Ağacı sırayla gezer (görünüm sırası = ağaç sırası). */
export function walk(tree, fn, depth = 0, parent = null) {
  for (const n of tree ?? []) {
    fn(n, depth, parent);
    walk(n.children, fn, depth + 1, n);
  }
}

/** Yaprak mı — durum hesabında ebeveynler alt öğelerinden türediği için ayrılır. */
const isLeaf = (n) => !(n.children ?? []).length;

/**
 * Ağaçtaki her düğümün bağlı olduğu Jira/tracker anahtarları.
 * Büyük/küçük harf normalize edilir (ağaçta küçük harfle de yazılmış olabiliyor).
 */
export function nodeJiraKeys(node) {
  return (node?.jiraTasks ?? [])
    .map((t) => String(t?.taskId ?? "").trim().toUpperCase())
    .filter(Boolean);
}

/**
 * AĞAÇ → ROTA LİSTESİ. Panelin "Site (canlı)" hızlı butonları ve perf süpürme
 * hedefleri bundan üretilir.
 *
 * Aynı yol birden çok düğümde geçebilir (ör. iki modül altında aynı sayfa);
 * İLK geçen kazanır ve diğer düğümler `alsoNodes`'a yazılır — panelin tek bir
 * butonu olsun ama sonuç yazılırken ikisi de bulunabilsin.
 *
 * @param {object[]} tree
 * @param {{baseUrl?: string|null, limit?: number}} [opts]
 * @returns {{nodeId,name,type,status,path,url,depth,runId,specs,jiraKeys,alsoNodes}[]}
 */
export function deriveRoutes(tree, { baseUrl = null, limit = 0 } = {}) {
  const baseHost = baseUrl ? hostOf(baseUrl) : null;
  const kok = baseUrl ? String(baseUrl).replace(/\/+$/, "") : null;
  const byPath = new Map();

  walk(tree, (n, depth) => {
    /*
     * İki kaynak, bu sırayla:
     *  1. `node.route` — GÖRELİ yol ("/sepet"). Tohum ağaç ve elle kurulan
     *     düğümler bunu kullanır: ortamdan bağımsızdır, aktif ortam test'ten
     *     staging'e geçince aynı ağaç doğru adresi gösterir.
     *  2. `resourceLinks` içindeki MUTLAK site adresi — tarayıcı (crawler)
     *     düğümü böyle kuruyor; o adres tarandığı ortamın adresidir.
     */
    let path = null, url = null;
    if (typeof n.route === "string" && n.route.startsWith("/")) {
      path = (n.route.replace(/\/+$/, "") || "/");
      url = kok ? kok + path : null;
    } else {
      url = nodeSiteUrl(n, baseHost);
      path = url ? toRoutePath(url) : null;
    }
    if (!path) return;
    const varOlan = byPath.get(path);
    if (varOlan) { varOlan.alsoNodes.push(n.id); return; }
    byPath.set(path, {
      nodeId: n.id,
      name: n.name ?? path,
      type: n.type ?? "page",
      status: n.status ?? "⬜",
      path,
      url,
      depth,
      runId: n.runRef?.runId ?? null,
      specs: n.runRef?.specs ?? [],
      jiraKeys: nodeJiraKeys(n),
      alsoNodes: [],
    });
  });

  const out = [...byPath.values()];
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Ağaçta site linki yoksa profilin eski `quickRoutes`'una düş.
 * Dönen kayıtların şekli aynı — çağıran iki kaynağı ayırt etmek zorunda kalmasın.
 *
 * @param {object[]} tree
 * @param {{baseUrl?: string|null, quickRoutes?: [string,string][], limit?: number}} opts
 */
export function routesWithFallback(tree, { baseUrl = null, quickRoutes = [], limit = 0 } = {}) {
  const agactan = deriveRoutes(tree, { baseUrl, limit });
  if (agactan.length) return { source: "scope", routes: agactan };
  const profilden = (quickRoutes ?? []).map(([name, path]) => ({
    nodeId: null, name, type: "page", status: "⬜", path,
    url: baseUrl ? String(baseUrl).replace(/\/$/, "") + path : null,
    depth: 1, runId: null, specs: [], jiraKeys: [], alsoNodes: [],
  }));
  return { source: "profile", routes: profilden };
}

/**
 * AĞAÇ → JİRA DİZİNİ. Hangi kart hangi düğümlere bağlı.
 * Panelin Jira sekmesi kartın yanında "bu kart kapsamda nereye düşüyor"
 * sorusunu buradan cevaplar — sabit `cardSpecs` eşlemesine gerek kalmadan.
 *
 * @returns {Record<string, {nodeId,name,status,type,path,specs}[]>}
 */
export function deriveJiraIndex(tree, { baseUrl = null } = {}) {
  const baseHost = baseUrl ? hostOf(baseUrl) : null;
  const idx = {};
  walk(tree, (n) => {
    const keys = nodeJiraKeys(n);
    if (!keys.length) return;
    const url = nodeSiteUrl(n, baseHost);
    const kayit = {
      nodeId: n.id,
      name: n.name ?? "",
      status: n.status ?? "⬜",
      type: n.type ?? "page",
      path: (typeof n.route === "string" && n.route.startsWith("/")) ? n.route : (url ? toRoutePath(url) : null),
      specs: n.runRef?.specs ?? [],
    };
    for (const k of keys) (idx[k] ??= []).push(kayit);
  });
  return idx;
}

/**
 * Bir spec dosyasına bağlı düğümler. Bağ SADECE açık `runRef.specs` üzerinden
 * kurulur — URL benzerliğinden TAHMİN EDİLMEZ.
 *
 * Gerekçe: koşum sonucu ağaca YAZILIYOR (çift yön). Tahmine dayalı bir eşleme,
 * yanlış düğüme "otomatik test case" yazıp kullanıcının verisini kirletirdi;
 * yanlış yazılan bir case sessizce durur ve kapsam raporunu bozar.
 */
export function nodesForSpec(tree, spec) {
  const hedef = String(spec ?? "").trim();
  if (!hedef) return [];
  const out = [];
  walk(tree, (n) => {
    if ((n.runRef?.specs ?? []).some((s) => String(s).trim() === hedef)) out.push(n);
  });
  return out;
}

/** Ağaçtaki tüm test case'leri düz listeye indirger (son koşumuyla birlikte). */
export function deriveCases(tree) {
  const out = [];
  walk(tree, (n) => {
    for (const tc of n.testCases ?? []) {
      const son = (tc.runs ?? []).at(-1) ?? null;
      out.push({
        nodeId: n.id,
        nodeName: n.name ?? "",
        caseId: tc.id,
        title: tc.title ?? "",
        spec: tc.spec ?? null,
        automated: !!tc.automated,
        draft: !!tc.draft,
        status: tc.status ?? "⬜",
        runCount: (tc.runs ?? []).length,
        lastRun: son ? { at: son.at, status: son.status, note: son.note ?? "" } : null,
        updatedAt: tc.updatedAt ?? tc.createdAt ?? null,
      });
    }
  });
  return out;
}

/**
 * AĞAÇ → GENEL BAKIŞ ÖZETİ. Panelin KPI'ları ve sekme sayaçları bundan gelir.
 *
 * ⚠️ "kapsanan" tanımı: yaprak düğümün en az bir test case'i VAR. Koşulmuş
 * olması ayrı bir sayaç (`casesRun`) — ikisini tek sayıya karıştırmak
 * "kapsam var" ile "doğrulandı" arasındaki farkı siler, panelin bütün değeri
 * o farkta.
 */
export function deriveSummary(tree, { baseUrl = null } = {}) {
  const byStatus = {};
  const byType = {};
  let total = 0, leaves = 0, leavesWithCase = 0, leavesWithJira = 0;

  walk(tree, (n) => {
    total++;
    byType[n.type ?? "page"] = (byType[n.type ?? "page"] ?? 0) + 1;
    if (!isLeaf(n)) return;
    leaves++;
    byStatus[n.status ?? "⬜"] = (byStatus[n.status ?? "⬜"] ?? 0) + 1;
    if ((n.testCases ?? []).length) leavesWithCase++;
    if (nodeJiraKeys(n).length) leavesWithJira++;
  });

  const cases = deriveCases(tree);
  const koşulan = cases.filter((c) => c.runCount > 0);
  const caseStatus = { "✅": 0, "❌": 0, "⚠️": 0, "⬜": 0 };
  for (const c of koşulan) {
    const s = c.lastRun?.status ?? "⬜";
    caseStatus[s] = (caseStatus[s] ?? 0) + 1;
  }

  const routes = deriveRoutes(tree, { baseUrl });
  const jira = deriveJiraIndex(tree, { baseUrl });

  return {
    nodes: { total, leaves, byStatus, byType },
    coverage: {
      leaves,
      withCase: leavesWithCase,
      withJira: leavesWithJira,
      pct: leaves ? Math.round((leavesWithCase / leaves) * 100) : 0,
    },
    cases: {
      total: cases.length,
      automated: cases.filter((c) => c.automated).length,
      draft: cases.filter((c) => c.draft).length,
      run: koşulan.length,
      byLastStatus: caseStatus,
    },
    routes: { total: routes.length, withRun: routes.filter((r) => r.runId || r.specs.length).length },
    jira: { keys: Object.keys(jira).length, links: Object.values(jira).reduce((a, v) => a + v.length, 0) },
  };
}

/**
 * AĞAÇ → KOŞUM ÖNERİLERİ. Panelin "Koşumlar" sekmesine "Kapsam" grubu olarak
 * düşen liste: ağaçta gerçekten bağlı olan koşumlar, hangi düğümden geldiği
 * belli şekilde.
 *
 * ⚠️ Whitelist güvenliği DELİNMEZ: burada üretilen `runId` yalnızca bir öneri;
 * çalıştırma yolu yine `panel/runs.json` whitelist'inden geçiyor. Whitelist'te
 * olmayan bir runId `known:false` ile işaretlenir ve panel onu tıklanamaz gösterir.
 *
 * @param {object[]} tree
 * @param {Set<string>|string[]} knownRunIds  whitelist'teki koşum id'leri
 */
export function deriveRuns(tree, knownRunIds = []) {
  const bilinen = knownRunIds instanceof Set ? knownRunIds : new Set(knownRunIds);
  const byRun = new Map();
  walk(tree, (n) => {
    const runId = n.runRef?.runId;
    const specs = n.runRef?.specs ?? [];
    if (!runId && !specs.length) return;
    const key = runId ?? `spec:${specs.join(",")}`;
    const kayit = byRun.get(key) ?? {
      runId: runId ?? null,
      known: runId ? bilinen.has(runId) : false,
      specs: [],
      nodes: [],
    };
    for (const s of specs) if (!kayit.specs.includes(s)) kayit.specs.push(s);
    kayit.nodes.push({ nodeId: n.id, name: n.name ?? "", status: n.status ?? "⬜" });
    byRun.set(key, kayit);
  });
  return [...byRun.values()];
}

/**
 * Perf ölçümünü ağaçtaki düğümlerle eşler (YAZMADAN — okuma yolu).
 * Rota yolu normalize edilerek karşılaştırılır; sorgu dizesi yok sayılır,
 * çünkü perf süpürmesi `/arama?q=koltuk` yerine `/arama` ölçebiliyor.
 *
 * @returns {{route: string, nodeId: string|null, name: string|null, status: string|null}[]}
 */
export function matchPerfRoutes(tree, perfRoutes = [], { baseUrl = null } = {}) {
  const rotalar = deriveRoutes(tree, { baseUrl });
  const idx = new Map();
  for (const r of rotalar) {
    idx.set(r.path, r);
    const sorgusuz = r.path.split("?")[0] || "/";
    if (!idx.has(sorgusuz)) idx.set(sorgusuz, r);
  }
  return (perfRoutes ?? []).map((p) => {
    const yol = String(p?.route ?? p ?? "").trim() || "/";
    const m = idx.get(yol) ?? idx.get(yol.split("?")[0] || "/") ?? null;
    return {
      route: yol,
      nodeId: m?.nodeId ?? null,
      name: m?.name ?? null,
      status: m?.status ?? null,
    };
  });
}
