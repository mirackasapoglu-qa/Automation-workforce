/**
 * Kapsam ağacı deposu (Flowscope'un veri katmanının sunucu tarafı karşılığı).
 *
 * NEDEN SUNUCUDA: Flowscope'un tek kalıcılığı tarayıcı localStorage'ıydı. Yani
 * veri, onu girenin tarayıcı profilinde duruyordu; repoyu klonlayan boş ekran
 * görüyordu ve `persist()` hatayı sessizce yutuyordu (dokümante edilmiş
 * "yüksek veri kaybı riski"). Ağaç artık diskte, panelin yanında.
 *
 * ⚠️ Sessiz yutma TAŞINMADI: yazma başarısız olursa hata çağırana döner,
 * arayüz de bunu görünür şekilde gösterir.
 *
 * Dosya: panel-data/scope/tree.json  (+ her yazmada tree.bak.json)
 * Tek profil = tek proje; panel zaten profil başına bir örnek olarak çalışıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project.mjs";

const DIR = path.join(process.cwd(), "panel-data", "scope");
const FILE = path.join(DIR, "tree.json");
const BAK = path.join(DIR, "tree.bak.json");

const nowIso = () => new Date().toISOString();

/**
 * Boş ağaç yerine profildeki rota haritasından tohum üretir.
 *
 * Rota kuralları zaten "hangi sayfa hangi koşumla test edilir + hangi kartlara
 * bağlı" bilgisini taşıyor. Kapsam ağacını sıfırdan elle kurmak yerine bu
 * bilgiyi kullanıyoruz: kullanıcı ilk açılışta dolu ve bağlantılı bir ağaç görür.
 *
 * `runRef` alanı Flowscope şemasında yok; koşum köprüsü için taşınıyor ve
 * JSON turunda korunuyor (arayüz bilmediği alanları silmez).
 */
export function seedFromProfile() {
  let n = 0;
  const id = () => `n${++n}`;
  const mkJira = (key) => ({ id: `jira-${key}`, taskId: key, createdAt: nowIso(), analyses: [] });

  const node = (name, type, extra = {}) => ({
    id: id(),
    name,
    type,
    status: "⬜",
    notes: [],
    jiraTasks: [],
    resourceLinks: [],
    statusHistory: [],
    lastVerifiedAt: null,
    staleReviewDays: 30,
    linkTos: [],
    open: false,
    children: [],
    testCases: [],
    ...extra,
  });

  const rules = PROJECT.routes?.rules ?? [];

  /*
   * Tohum düğümlere GÖRELİ rota da yazılır (`route: "/sepet"`).
   *
   * Neden: panelin "Site (canlı)" ve Performans bölümleri artık ağaçtan
   * besleniyor (bkz. scope-bridge.mjs). Rota taşımayan bir tohum ağaçla taze
   * kurulan sunucu, kapsam ağacı dolu görünmesine rağmen panelde eski profil
   * listesine düşerdi — "Flowscope paneli besler" cümlesi ilk açılışta yalan
   * olurdu. Eşleme profilin KENDİ kuralıyla yapılır (`rule.test(path)`), yani
   * ikinci bir elle liste doğmaz.
   *
   * ⚠️ MUTLAK adres yazılmaz: ağaç ortamdan bağımsız kalsın (test → staging
   * geçişinde aynı düğüm doğru adresi gösterir). Crawler'ın eklediği mutlak
   * adresler ayrı bir kaynak ve ikisi birlikte çalışıyor.
   */
  const rotaFor = (rule) => {
    for (const [, yol] of PROJECT.quickRoutes ?? []) {
      const temiz = String(yol).split("?")[0] || "/";
      try { if (rule.test?.(temiz)) return yol; } catch { /* kural patlarsa rota yok */ }
    }
    return null;
  };

  const pages = rules.map((r) => {
    const rota = rotaFor(r);
    return node(r.label ?? r.runId ?? "(isimsiz)", "page", {
      jiraTasks: (r.cards ?? []).map(mkJira),
      runRef: { runId: r.runId ?? null, specs: r.specs ?? [] },
      ...(rota ? { route: rota } : {}),
    });
  });

  const root = node(PROJECT.product ?? PROJECT.title ?? PROJECT.id, "module", { open: true });
  root.children = pages.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return [root];
}

/**
 * Rota taşımayan ESKİ düğümlere göreli rotayı sonradan yazar (tek seferlik,
 * tekrar çalıştırmak güvenli).
 *
 * Neden ayrı bir eylem: `seedFromProfile` artık rota yazıyor, ama ağacı ondan
 * ÖNCE tohumlanmış kurulumlarda (sunucudaki mevcut ağaç dahil) düğümler rotasız
 * duruyor ve panel profil listesine düşüyor. Bunu `readTree` içinde sessizce
 * yapmak, her açılışta kullanıcının verisini habersiz değiştirmek olurdu —
 * eylem açık, sonucu raporlu ve token'lı bir uçtan geliyor.
 *
 * Eşleme yine profilin kendi kuralıyla: düğümün `runRef.runId`'si hangi kurala
 * aitse, o kuralın eşleştiği ilk hızlı rota. Rotası olan düğüme DOKUNULMAZ.
 */
export function backfillRoutes() {
  const rules = PROJECT.routes?.rules ?? [];
  const quick = PROJECT.quickRoutes ?? [];
  const rotaFor = (runId) => {
    const rule = rules.find((r) => r.runId === runId);
    if (!rule) return null;
    for (const [, yol] of quick) {
      const temiz = String(yol).split("?")[0] || "/";
      try { if (rule.test?.(temiz)) return yol; } catch { /* kural patlarsa rota yok */ }
    }
    return null;
  };

  const { tree } = readTree();
  const yazilan = [];
  (function walk(list) {
    for (const n of list ?? []) {
      if (!n.route && n.runRef?.runId) {
        const rota = rotaFor(n.runRef.runId);
        if (rota) { n.route = rota; yazilan.push({ nodeId: n.id, name: n.name ?? "", route: rota }); }
      }
      walk(n.children);
    }
  })(tree);

  if (yazilan.length) writeTree(tree, { reason: "backfill-routes" });
  return { written: yazilan.length, nodes: yazilan };
}

/** Ağacı okur. Dosya yoksa profilden tohumlar ve YAZAR (ilk açılış). */
export function readTree() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { tree: parsed, seeded: false };
    if (Array.isArray(parsed?.tree)) return { tree: parsed.tree, seeded: false };
    throw new Error("beklenmeyen bicim");
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Bozuk dosyayı EZME — yedeğe al, sonra tohumla. (Flowscope burada
      // sessizce boş ağaçla devam ediyordu; veri o noktada kayboluyordu.)
      try { fs.mkdirSync(DIR, { recursive: true }); fs.copyFileSync(FILE, `${FILE}.bozuk-${Date.now()}`); } catch { /* yoksa gec */ }
    }
    const tree = seedFromProfile();
    writeTree(tree, { reason: "seed" });
    return { tree, seeded: true };
  }
}

/**
 * Ağaç her yazıldığında haber verilecek dinleyiciler.
 *
 * NEDEN BURADA: ağaç sekiz ayrı yoldan değişiyor (PUT /api/scope/tree, Jira
 * bağlama, üç sweep, koşum yazımı, perf yazımı, test case üretimi). Panelin
 * "Flowscope değişti, tazele" olayını bu yolların her birine ayrı ayrı eklemek
 * kaçınılmaz olarak birini unutmak demekti — tek kapı `writeTree`.
 *
 * Dinleyici hatası yazmayı DÜŞÜRMEZ: kalıcılık, bildirimden önce gelir.
 */
const treeListeners = new Set();
export function onTreeChange(fn) { treeListeners.add(fn); return () => treeListeners.delete(fn); }

/** Atomik yazma + tek kademe yedek. Hata YUTULMAZ, çağırana fırlar. */
export function writeTree(tree, meta = {}) {
  if (!Array.isArray(tree)) throw new Error("ağaç bir dizi olmalı");
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tree, null, 1));
  fs.renameSync(tmp, FILE);
  const out = { savedAt: nowIso(), nodes: countNodes(tree) };
  for (const fn of treeListeners) {
    try { fn({ ...out, ...meta }); } catch { /* bildirim hatasi yazmayi dusurmez */ }
  }
  return out;
}

export function countNodes(tree) {
  let n = 0;
  (function walk(a) { for (const x of a ?? []) { n++; walk(x.children); } })(tree);
  return n;
}

// ---------------- koşum köprüsü ----------------
/** Ağaçta id'ye göre düğüm bulur. */
export function findNode(tree, id) {
  for (const n of tree ?? []) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

/**
 * Sonraki serbest `<prefix>N` numarası — arayüzün kendi sayaçlarıyla (state.js)
 * çakışmasın diye AĞACIN TAMAMINI tarar: düğüm id'leri, jiraTasks + analyses,
 * notes, resourceLinks, statusHistory, testCases + runs + steps. Başlangıçta
 * yalnızca tc/tcr için vardı (applyRunResults); jira/sh gibi başka önekler için
 * de güvenli olsun diye kapsamı genişletildi (bkz. attachJiraTask).
 */
function nextId(tree, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)`);
  const bump = (id) => { const m = re.exec(id ?? ""); if (m) max = Math.max(max, Number(m[1])); };
  (function walk(a) {
    for (const n of a ?? []) {
      bump(n.id);
      for (const t of n.jiraTasks ?? []) { bump(t.id); for (const an of t.analyses ?? []) bump(an.id); }
      for (const nt of n.notes ?? []) bump(nt.id);
      for (const rl of n.resourceLinks ?? []) bump(rl.id);
      for (const sh of n.statusHistory ?? []) bump(sh.id);
      for (const tc of n.testCases ?? []) {
        bump(tc.id);
        for (const r of tc.runs ?? []) bump(r.id);
        for (const s of tc.steps ?? []) bump(s.id);
      }
      walk(n.children);
    }
  })(tree);
  return `${prefix}${max + 1}`;
}

/**
 * Gerçek Playwright koşumunun sonucunu ağaca yazar.
 *
 * TASARIM: her spec dosyası, düğümün altında bir "otomatik test case"ine
 * karşılık gelir; her koşum o case'in `runs[]` kaydına eklenir. Böylece
 * Flowscope'un en değerli kuralı (R13/R14 — koşum kaydı yoksa "geçti"
 * seçilemez) otomatik testler için de doğal olarak geçerli olur.
 *
 * ⚠️ Düğümün KENDİ durumu DEĞİŞTİRİLMEZ. Kaynak sistemde de otomatik senkron
 * yok (R19): düğüm ✅ ama bir case ❌ ise arayüz uyarı gösterir, kararı insan
 * verir. Otomatik koşumun insanın verdiği durumu sessizce ezmesi, o uyarının
 * varlık sebebini ortadan kaldırırdı.
 *
 * @returns {{written: number, perSpec: object[]}} yazılan koşum sayısı
 */
export function applyRunResults({ nodeId, specs, results, durationMs, code = 0 }) {
  const { tree } = readTree();
  const node = findNode(tree, nodeId);
  if (!node) throw new Error(`Düğüm bulunamadı: ${nodeId}`);

  const out = writeRunIntoNode(tree, node, { specs, results, durationMs, code });
  if (out.written) writeTree(tree, { reason: "run" });
  return out;
}

/**
 * Tek düğüme koşum sonucu yazar — KALICI DEĞİL, yalnız ağacı değiştirir.
 *
 * `applyRunResults` (tek düğüm, panelin "bu düğümü koştur" akışı) ve
 * `applyRunResultsBySpecs` (çift yön: panelden tetiklenen HER koşum, spec'e
 * bağlı bütün düğümler) aynı gövdeyi paylaşsın diye ayrıldı. İki ayrı kopya
 * kaçınılmaz olarak birbirinden sapardı; bu gövde Flowscope'un R13/R14
 * kuralını (koşum kaydı olmadan "geçti" yok) taşıyan yer.
 */
function writeRunIntoNode(tree, node, { specs, results, durationMs, code = 0 }) {
  const at = nowIso();
  const perSpec = [];
  let written = 0;

  for (const spec of specs ?? []) {
    const rows = (results?.rows ?? []).filter((r) => r.file === spec);

    /**
     * Hiç satır yok. İki bambaşka durum:
     *  - koşum düştü (global-setup hatası, config sorunu) → UYARI kaydı yaz,
     *    sebebi de yaz. Sessizce hiçbir şey yazmamak, kullanıcının düğmeye
     *    basıp bir dakika bekleyip hiçbir şey görmemesi anlamına geliyordu.
     *  - koşum başarılı ama bu spec hiç koşmamış → kayıt yazmaya değmez.
     */
    if (!rows.length) {
      if (code !== 0) {
        const sebep = (results?.errors ?? [])[0] ?? `koşum ${code} koduyla düştü`;
        const kayit = {
          id: nextId(tree, "tcr"),
          at,
          status: "⚠️",
          note: `Test koşmadı — koşum düştü.\n${String(sebep).slice(0, 240)}`,
        };
        const baslik = `Otomatik: ${spec}`;
        let tcx = (node.testCases ?? []).find((x) => x.spec === spec || x.title === baslik);
        if (!tcx) {
          tcx = {
            id: nextId(tree, "tc"), title: baslik, spec, automated: true,
            steps: [], runs: [], status: "⬜", createdAt: at, updatedAt: at,
          };
          node.testCases = node.testCases ?? [];
          node.testCases.push(tcx);
        }
        tcx.runs.push(kayit);
        tcx.updatedAt = at;
        written++;
        perSpec.push({ spec, status: "⚠️", note: kayit.note });
      } else {
        perSpec.push({ spec, status: null, note: "bu spec için sonuç satırı yok" });
      }
      continue;
    }
    const failed = rows.filter((r) => r.status === "failed" || r.status === "timedOut");
    const passed = rows.filter((r) => r.status === "passed");
    const skipped = rows.filter((r) => r.status === "skipped");
    const status = failed.length ? "❌" : passed.length ? "✅" : "⚠️";

    const sure = `${((durationMs ?? rows.reduce((a, r) => a + (r.duration ?? 0), 0)) / 1000).toFixed(1)}s`;
    let note = `${passed.length}/${rows.length} geçti · ${sure}`;
    if (skipped.length) note += ` · ${skipped.length} atlandı`;
    if (failed.length) {
      note += `\nDÜŞEN: ${failed.map((r) => r.title).join(", ")}`;
      const firstErr = failed.find((r) => r.error)?.error;
      if (firstErr) note += `\n${firstErr.split("\n")[0].slice(0, 160)}`;
    }

    // Bu spec'in otomatik case'i var mı — yoksa oluştur.
    const baslik = `Otomatik: ${spec}`;
    let tc = (node.testCases ?? []).find((t) => t.spec === spec || t.title === baslik);
    if (!tc) {
      tc = {
        id: nextId(tree, "tc"),
        title: baslik,
        /** Otomatik case işareti: elle yazılmış case'lerden ayırt edilsin. */
        spec,
        automated: true,
        steps: [],
        runs: [],
        status: "⬜",
        createdAt: at,
        updatedAt: at,
      };
      node.testCases = node.testCases ?? [];
      node.testCases.push(tc);
    }
    tc.runs.push({ id: nextId(tree, "tcr"), at, status, note });
    tc.updatedAt = at;
    written++;
    perSpec.push({ spec, status, note });
  }

  return { written, perSpec };
}

/**
 * ÇİFT YÖN: panelden tetiklenen HERHANGİ bir koşumun sonucunu, o spec'lere
 * `runRef.specs` ile bağlı BÜTÜN düğümlere yazar.
 *
 * Bugüne kadar koşum sonucu ağaca yalnızca koşum Flowscope'tan ("bu düğümü
 * koştur") başlatılmışsa düşüyordu; panelin kendi "Koşumlar" sekmesinden
 * başlatılan koşum ağaçta hiç iz bırakmıyordu. Kullanıcının gördüğü sonuç:
 * ağaç her zaman "hiç koşulmamış" görünüyordu.
 *
 * ⚠️ Bağ TAHMİN EDİLMEZ: yalnız açık `runRef.specs` eşleşmesi. URL benzerliğine
 * dayalı bir eşleme yanlış düğüme otomatik case yazar ve bunu fark etmek
 * neredeyse imkânsız olurdu.
 *
 * ⚠️ Düğümün KENDİ durumu yine değiştirilmez (R19) — burada da insan kararı.
 *
 * @param {{results: object, durationMs?: number, code?: number, skipNodeId?: string|null}} p
 *   `skipNodeId`: Flowscope'tan başlatılan koşum zaten `applyRunResults` ile
 *   yazıldıysa aynı düğüme İKİNCİ kez yazmamak için.
 * @returns {{written: number, nodes: {nodeId,name,written,perSpec}[]}}
 */
export function applyRunResultsBySpecs({ results, durationMs, code = 0, skipNodeId = null }) {
  const specs = [...new Set((results?.rows ?? []).map((r) => r.file).filter(Boolean))];
  if (!specs.length) return { written: 0, nodes: [] };

  const { tree } = readTree();
  const hedefler = new Map(); // nodeId -> {node, specs:Set}

  (function walk(list) {
    for (const n of list ?? []) {
      if (n.id !== skipNodeId) {
        const kesisim = (n.runRef?.specs ?? []).filter((s) => specs.includes(String(s).trim()));
        if (kesisim.length) hedefler.set(n.id, { node: n, specs: kesisim });
      }
      walk(n.children);
    }
  })(tree);

  const nodes = [];
  let written = 0;
  for (const { node, specs: nodeSpecs } of hedefler.values()) {
    const out = writeRunIntoNode(tree, node, { specs: nodeSpecs, results, durationMs, code });
    if (!out.written) continue;
    written += out.written;
    nodes.push({ nodeId: node.id, name: node.name ?? "", written: out.written, perSpec: out.perSpec });
  }

  if (written) writeTree(tree, { reason: "run" });
  return { written, nodes };
}

/**
 * ÇİFT YÖN: perf ölçümünü rota→düğüm eşleyip düğümün üzerine yazar.
 *
 * Not olarak DEĞİL, `node.perf` alanına ÜZERİNE YAZARAK: ölçüm her süpürmede
 * tekrarlanıyor, not olarak yazılsaydı düğümün not listesi her koşumda birer
 * satır büyürdü ve insanın yazdığı notların arasında kaybolurdu. Flowscope
 * bilmediği alanları JSON turunda koruyor (`runRef` de böyle taşınıyor).
 *
 * @param {{measuredAt: string|null, routes: object[]}} perf  readPerfData çıktısı
 * @param {(tree: object[]) => {path: string, nodeId: string}[]} routeIndex
 *   ağaçtan rota listesi üreten fonksiyon (scope-bridge.deriveRoutes sarmalayıcısı)
 * @returns {{written: number, nodes: string[]}}
 */
export function applyPerfToTree(perf, routeIndex) {
  const rows = perf?.routes ?? [];
  if (!rows.length) return { written: 0, nodes: [] };

  const { tree } = readTree();
  const rotalar = routeIndex(tree) ?? [];
  const idx = new Map();
  for (const r of rotalar) {
    idx.set(r.path, r.nodeId);
    const sorgusuz = String(r.path).split("?")[0] || "/";
    if (!idx.has(sorgusuz)) idx.set(sorgusuz, r.nodeId);
  }

  const at = perf.measuredAt ?? nowIso();
  const nodes = [];
  for (const row of rows) {
    const yol = String(row.route ?? "").trim() || "/";
    const nodeId = idx.get(yol) ?? idx.get(yol.split("?")[0] || "/");
    if (!nodeId) continue;
    const node = findNode(tree, nodeId);
    if (!node) continue;
    const yeni = {
      at,
      route: yol,
      lcp: row.lcp ?? null,
      load: row.load ?? null,
      ttfb: row.ttfb ?? null,
      requests: row.requests ?? null,
      api: row.api ?? null,
      notFound: !!row.notFound,
      siteErrors: row.siteErrors ?? 0,
      consoleErrors: row.consoleErrors ?? 0,
    };
    // Aynı ölçüm ikinci kez yazılmasın (aynı `at` + aynı rota) — /api/perf her
    // okunduğunda çağrılıyor, her açılışta ağacı kirletmemeli.
    if (node.perf && node.perf.at === yeni.at && node.perf.route === yeni.route) continue;
    node.perf = yeni;
    nodes.push(nodeId);
  }

  if (nodes.length) writeTree(tree, { reason: "perf" });
  return { written: nodes.length, nodes };
}

// ---------------- agent köprüsü: kart → düğüm bağlama ----------------
/**
 * Bir Jira/tracker Task ID'sini bir ya da daha fazla düğüme bağlar. İnsanın
 * drawer'daki "Jira Task ID ekle" akışının (panel/public/scope/js/jira.js →
 * `renderDrawerJiraSection`'daki submit()) sunucu tarafı karşılığı — agent'lar
 * (product-owner agent'ı) bir kart açtıklarında bunu çağırıp o kartı, boşluğu
 * bulduğu düğüm(ler)e geri bağlar.
 *
 * Aynı düğümde zaten var olan bir taskId (büyük/küçük harf duyarsız) SESSİZCE
 * atlanır — client'taki aynı kural (isDuplicate), agent adımı iki kez
 * çalışırsa hata almasın diye.
 *
 * `statusInfo` verilirse (tracker().statusByKeys([taskId])'nin döndürdüğü
 * `{found, statusCategory, ...}` biçiminde) VE bilinen bir "done" DEĞİL
 * durumsa, bağlanan her YAPRAK düğüm ❌'ya çekilir — bu, `jira.js →
 * autoFlagFromJiraStatus()` ile TAMAMEN AYNI kural (bilinen + done değil →
 * Hatalı, tek yönlü, insan geri almadıkça kalıcı); burada sadece tetikleyici
 * "drawer'da 60 sn'lik poll" değil "agent'ın az önce açtığı kart" oluyor.
 * Ebeveyn (children.length>0) düğümlerin durumu zaten alt öğelerden otomatik
 * hesaplanıyor (bkz. data.js → effectiveStatus), o yüzden onlara dokunulmaz.
 *
 * @param {{nodeIds: string[], taskId: string, statusInfo?: {found:boolean, statusCategory:string}|null}} args
 * @returns {{attached: string[], skipped: string[], flagged: string[], notFound: string[]}}
 */
export function attachJiraTask({ nodeIds, taskId, statusInfo = null }) {
  const id = String(taskId ?? "").trim();
  if (!id) throw new Error("taskId zorunlu");
  const ids = (Array.isArray(nodeIds) ? nodeIds : [nodeIds]).filter(Boolean);
  if (!ids.length) throw new Error("nodeIds zorunlu (en az bir düğüm id'si)");

  const { tree } = readTree();
  const at = nowIso();
  const attached = [];
  const skipped = [];
  const flagged = [];
  const notFound = [];

  const isKnownNotDone =
    !!statusInfo && statusInfo.found !== false && !!statusInfo.statusCategory && statusInfo.statusCategory !== "done";

  for (const nodeId of ids) {
    const node = findNode(tree, nodeId);
    if (!node) { notFound.push(nodeId); continue; }

    const dup = (node.jiraTasks ?? []).some((t) => t.taskId.trim().toLowerCase() === id.toLowerCase());
    if (dup) {
      skipped.push(nodeId);
    } else {
      node.jiraTasks = node.jiraTasks ?? [];
      node.jiraTasks.push({ id: nextId(tree, "jira"), taskId: id, createdAt: at, analyses: [] });
      attached.push(nodeId);
    }

    if (isKnownNotDone && !node.children.length && node.status !== "❌") {
      node.statusHistory = node.statusHistory ?? [];
      node.statusHistory.push({ id: nextId(tree, "sh"), from: node.status, to: "❌", at });
      node.status = "❌";
      flagged.push(nodeId);
    }
  }

  if (attached.length || flagged.length) writeTree(tree, { reason: "jira" });
  return { attached, skipped, flagged, notFound };
}

/** Ağaçtaki her yaprak düğümün jiraTasks'ından benzersiz Task ID listesini çıkarır. */
export function collectJiraTaskIds(tree) {
  const ids = new Set();
  (function walk(a) {
    for (const n of a ?? []) {
      for (const t of n.jiraTasks ?? []) if (t.taskId) ids.add(t.taskId);
      walk(n.children);
    }
  })(tree);
  return [...ids];
}

/**
 * Ağaç genelinde Jira durumunu tarar — `attachJiraTask` ile AYNI kuralla
 * (bilinen + done değil → ❌) her yaprak düğümü değerlendirir. `attachJiraTask`
 * yalnızca YENİ eklenen bir Task ID'yi kontrol ederken, bu fonksiyon ağaçtaki
 * TÜM mevcut jiraTasks'ları yeniden değerlendirir — kimse o düğümün drawer'ını
 * açmasa bile Jira'da statü değişikliği fark edilsin diye (bkz. CLAUDE.md →
 * "Flowscope: Jira durumu → otomatik 'Hatalı'").
 *
 * TERSİNİ de raporlar (ama UYGULAMAZ): zaten ❌ olan ama artık bağlı TÜM Task
 * ID'leri "done" olan düğümler `reviewSuggested`'e düşer — ❌'dan otomatik
 * ÇIKARILMAZ, bu bilinçli olarak insan kararı (bkz. delivery-lead agent'ı).
 *
 * @param {Record<string, {found:boolean, statusCategory:string}>} statusMap tracker().statusByKeys() çıktısı
 * @returns {{scannedNodes: number, flagged: string[], reviewSuggested: {nodeId:string, doneTaskIds:string[]}[]}}
 */
export function sweepJiraStatuses(statusMap) {
  const { tree } = readTree();
  const at = nowIso();
  const flagged = [];
  const reviewSuggested = [];
  let scannedNodes = 0;

  (function walk(a) {
    for (const n of a ?? []) {
      if (!n.children.length && (n.jiraTasks ?? []).length) {
        scannedNodes++;
        const known = n.jiraTasks
          .map((t) => statusMap[t.taskId])
          .filter((info) => info && info.found !== false && info.statusCategory);
        if (known.length) {
          const anyNotDone = known.some((info) => info.statusCategory !== "done");
          if (anyNotDone && n.status !== "❌") {
            n.statusHistory = n.statusHistory ?? [];
            n.statusHistory.push({ id: nextId(tree, "sh"), from: n.status, to: "❌", at });
            n.status = "❌";
            flagged.push(n.id);
          } else if (!anyNotDone && n.status === "❌") {
            reviewSuggested.push({
              nodeId: n.id,
              doneTaskIds: n.jiraTasks
                .filter((t) => statusMap[t.taskId]?.statusCategory === "done")
                .map((t) => t.taskId),
            });
          }
        }
      }
      walk(n.children);
    }
  })(tree);

  if (flagged.length) writeTree(tree, { reason: "jira-sweep" });
  return { scannedNodes, flagged, reviewSuggested };
}

/**
 * ✅ (Tamamlandı) VE Kaynaklar'da verilen `type`ta bir link olan yaprak
 * düğümleri toplar — "Doküman Drift Radarı"nın ilk adımı (Figma VE Confluence
 * bunu PAYLAŞIR, bkz. `sweepResourceDrift`). Bu fonksiyon HTTP çağrısı yapmaz,
 * hangi kaynakların kontrol edilmesi gerektiğini söyler; asıl çağrı
 * (rate-limit'e duyarlı, önbellekli) `panel/design-drift.mjs` (Figma) /
 * `panel/confluence.mjs`'te (Confluence).
 *
 * `extractKey` dışarıdan verilir (kaynağa özgü URL ayrıştırıcı) — bu dosya
 * Figma/Confluence URL biçimini bilmek zorunda kalmasın diye.
 * @param {"figma"|"confluence"} type resourceLinks'teki kaynak tipi
 * @returns {{nodeId:string, key:string, url:string, lastVerifiedAt:string}[]}
 */
export function collectVerifiedResourceLinks(tree, type, extractKey) {
  const out = [];
  (function walk(a) {
    for (const n of a ?? []) {
      if (!n.children.length && n.status === "✅" && n.lastVerifiedAt) {
        const link = (n.resourceLinks ?? []).find((r) => r.type === type);
        const key = link ? extractKey(link.url) : null;
        if (key) out.push({ nodeId: n.id, key, url: link.url, lastVerifiedAt: n.lastVerifiedAt });
      }
      walk(n.children);
    }
  })(tree);
  return out;
}

/**
 * Jira sweep'iyle AYNI ilke, farklı sinyal: "done değil" yerine "bağlı kaynak
 * (Figma dosyası / Confluence sayfası) senin doğrulamandan (`lastVerifiedAt`)
 * SONRA değişti mi". Bulursa düğümü ⚠️'ye çeker — TEK YÖNLÜ, otomatik ✅'ya
 * geri almaz (o karar insanın, bkz. CLAUDE.md → "Doküman Drift Radarı").
 * `node.status` bu arada elle değiştirilmiş olabilir diye (drawer açıkken
 * sweep tetiklenmesi gibi) hâlâ ✅ olduğu ANDA tekrar kontrol edilir.
 *
 * Figma VE Confluence AYNI fonksiyonu çağırır — mutasyon mantığı kaynağa göre
 * değişmiyor, yalnızca hangi dosyanın/sayfanın kontrol edildiğini söyleyen
 * `sourceLabel` notun metnine giriyor.
 *
 * @param {Record<string, string|null>} lastModifiedByKey key -> ISO tarih (bilinmiyorsa null)
 * @param {ReturnType<typeof collectVerifiedResourceLinks>} links `collectVerifiedResourceLinks` çıktısı
 * @param {string} sourceLabel not metninde görünecek kaynak adı ("Figma dosyası", "Confluence sayfası")
 * @returns {{flagged: {nodeId:string, url:string, lastModified:string}[]}}
 */
export function sweepResourceDrift(lastModifiedByKey, links, sourceLabel) {
  const { tree } = readTree();
  const at = nowIso();
  const flagged = [];

  for (const link of links) {
    const node = findNode(tree, link.nodeId);
    if (!node || node.status !== "✅") continue;
    const lastModified = lastModifiedByKey[link.key];
    if (!lastModified) continue; // bilinmiyor (kimlik yok/429/ağ hatası) — karar verme
    if (new Date(lastModified).getTime() <= new Date(link.lastVerifiedAt).getTime()) continue;

    node.statusHistory = node.statusHistory ?? [];
    node.statusHistory.push({ id: nextId(tree, "sh"), from: node.status, to: "⚠️", at });
    node.status = "⚠️";
    node.notes = node.notes ?? [];
    node.notes.push({
      id: nextId(tree, "note"),
      text: `${sourceLabel} güncellendi: son doğrulamandan (${link.lastVerifiedAt.slice(0, 10)}) sonra, ${lastModified.slice(0, 10)}'de değişmiş. Tekrar gözden geçir.`,
      createdAt: at,
    });
    flagged.push({ nodeId: node.id, url: link.url, lastModified });
  }

  if (flagged.length) writeTree(tree, { reason: "drift" });
  return { flagged };
}

/**
 * Bir Jira Task ID'sinin bağlı olduğu TÜM yaprak düğümleri (yolu dahil) bulur
 * — Panel'in Jira kart detayında "bu kart Flowscope'ta X sayfasına bağlı"
 * çapraz-gezinme ipucu için (bkz. CLAUDE.md → "Panel ↔ Flowscope"). Bir kart
 * `attachJiraTask` ile birden çok düğüme bağlanabildiği için (bir kart birden
 * çok sayfayı etkiliyorsa) TEK bir eşleşmeyle durmaz, hepsini döner.
 */
export function findNodesByJiraTask(tree, taskId) {
  const target = String(taskId ?? "").toUpperCase();
  const out = [];
  (function walk(nodes, ancestors) {
    for (const n of nodes ?? []) {
      const path = ancestors.concat(n.name);
      if ((n.jiraTasks ?? []).some((t) => (t.taskId ?? "").toUpperCase() === target)) {
        out.push({ id: n.id, name: n.name, path: path.join(" › ") });
      }
      walk(n.children, path);
    }
  })(tree, []);
  return out;
}
