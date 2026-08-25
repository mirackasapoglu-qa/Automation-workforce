/**
 * URL'den kapsam ağacı çıkarma (crawler).
 *
 * Flowscope'un `crawler.py`sinin Node portu. NEDEN PORT: kaynak sürüm Python +
 * `playwright` paketi istiyor; bu makinede kurulu değil ve kurmak sisteme bir
 * Python araç zinciri + ~300MB tarayıcı eklemek demekti. Repo zaten Node ve
 * Playwright burada çalışıyor. DOM script'leri saf tarayıcı JS'i olduğu için
 * birebir taşındı — asıl zekâ (başlık gruplama, tekrar eden blok tespiti)
 * kaynaktakiyle aynı.
 *
 * KORUNAN KURALLAR (kaynak dokümanda R27-R32):
 *  - derinlik/sayfa üst sınırı (profilden ayarlanabilir, ama sınır HER ZAMAN var)
 *  - kapsam kısıtı: alt yoldan başlatılırsa o yolun dışına çıkılmaz
 *  - robots.txt'e uyulur (okunamazsa engelsiz devam)
 *  - aynı rota şablonundan (`/kayit/:id`) tek örnek taranır
 *  - yıkıcı görünen hiçbir öğeye TIKLANMAZ, hiçbir form doldurulmaz/gönderilmez
 *  - giriş gerekiyorsa görünür pencere açılır; şifre bu araca hiç girilmez
 *
 * Playwright `import` edilmez, yalnızca tarama başlarken DİNAMİK yüklenir:
 * panelin `npm i --omit=dev` ile açılabilirliği bozulmasın diye.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT, activeEnv } from "./project.mjs";

const USER_AGENT = "QAPanelBot/1.0 (+yerel kapsam haritasi tarayicisi)";
const NAV_TIMEOUT_MS = 20_000;
const DELAY_BETWEEN_PAGES_MS = 600;
const LOGIN_WAIT_TIMEOUT_MS = 600_000;
const ROUTE_TEMPLATE_CAP = 1;
const MAX_INTERACTIONS_PER_PAGE = 8;
const INTERACTION_WAIT_MS = 600;

/**
 * Üst sınırlar profilden ayarlanabilir. Kaynakta 4/60 KODA GÖMÜLÜYDÜ; tek ürün
 * için makul ama şirket geneli için değil (60 sayfa orta boy bir CRM'i kapsamaz).
 * Sınırın kendisi kalkmıyor — sadece projeye göre ayarlanıyor.
 */
const HARD_MAX_DEPTH = PROJECT.crawl?.maxDepth ?? 4;
const HARD_MAX_PAGES = PROJECT.crawl?.maxPages ?? 60;

/** Durum değiştirebilecek / veri kaybettirebilecek öğelere ASLA tıklanmaz. */
const DESTRUCTIVE_KEYWORDS = [
  "sil", "kaldır", "delete", "remove", "kaydet", "save", "gönder", "submit",
  "onayla", "confirm", "ödeme", "pay", "purchase", "satın al", "oluştur", "create",
  "ekle", "add", "çıkış", "logout", "sign out", "yükle", "upload",
  "değiştir", "update", "düzenle", "edit", "yayınla", "publish", "ata", "assign",
  "reddet", "reject", "iptal et", "cancel",
];

const jobs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- URL yardımcıları ----------------
function normalizeUrl(u) {
  const x = new URL(u);
  let p = x.pathname || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${x.protocol}//${x.host}${p}${x.search}`;
}

const ID_ONLY_RE = /^[0-9a-fA-F-]{8,}$/;
const isIdSegment = (seg) =>
  /^\d+$/.test(seg) || (ID_ONLY_RE.test(seg) && /\d/.test(seg));

/** `/kayit/482` ve `/kayit/931-ab` → `/kayit/:id`. Binlerce benzer kayıt sayfası yerine bir örnek. */
const routeTemplate = (p) =>
  p.split("/").map((seg) => (seg && isIdSegment(seg) ? ":id" : seg)).join("/");

// ---------------- robots.txt ----------------
/**
 * Küçük robots.txt çözümleyici (Node'da yerleşiği yok).
 * En uzun eşleşen kural kazanır; eşitlikte Allow öncelikli — standart davranış.
 */
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  const ua = USER_AGENT.toLowerCase();
  const match =
    groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  const rules = match?.rules ?? [];
  return {
    isAllowed(pathname) {
      let best = null;
      for (const r of rules) {
        if (!r.path) continue;                       // bos Disallow = her sey serbest
        if (!pathname.startsWith(r.path)) continue;
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

async function loadRobots(origin) {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;                        // okunamazsa engellemeden devam
    return parseRobots(await res.text());
  } catch {
    return null;
  }
}

// ---------------- DOM script'leri (kaynaktan birebir) ----------------
/**
 * Görünür h1/h2/h3'leri toplar; aynı kapsayıcı altında aynı etiket+class ile 3+
 * tekrar eden başlıkları TEK temsilci örneğe indirger. Böylece N satırlık tablo
 * ağaçta N düğüm değil, bir bileşen düğümü olur.
 */
const HEADINGS_SCRIPT = () => {
  const heads = Array.from(document.querySelectorAll("h1, h2, h3")).filter((el) => el.getClientRects().length > 0);
  function findRepeatAncestor(el) {
    let node = el;
    for (let depth = 0; depth < 5 && node && node.parentElement; depth++) {
      const parent = node.parentElement;
      const className = node.className || "";
      if (className) {
        const sameSiblings = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName && (c.className || "") === className,
        );
        if (sameSiblings.length >= 3) return { container: parent, tag: node.tagName, className };
      }
      node = parent;
    }
    return null;
  }
  const groupMap = new Map();
  const info = heads.map((el, i) => ({ i, rep: findRepeatAncestor(el) }));
  info.forEach(({ i, rep }) => {
    if (!rep) return;
    if (!groupMap.has(rep.container)) groupMap.set(rep.container, new Map());
    const byTag = groupMap.get(rep.container);
    const key = rep.tag + "|" + rep.className;
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key).push(i);
  });
  const repeatedIndex = new Set();
  const firstOfGroupSize = new Map();
  groupMap.forEach((byTag) => {
    byTag.forEach((indexes) => {
      if (indexes.length >= 3) {
        firstOfGroupSize.set(indexes[0], indexes.length);
        for (let j = 1; j < indexes.length; j++) repeatedIndex.add(indexes[j]);
      }
    });
  });
  return heads.map((el, i) => ({
    tag: el.tagName.toLowerCase(),
    text: el.textContent.trim(),
    skip: repeatedIndex.has(i),
    repeatCount: firstOfGroupSize.get(i) || null,
  }));
};

/** Hiç başlık bulunamayan sayfalar için yedek: aynı ebeveyn altında 3+ tekrar eden bloklar. */
const REPEATED_BLOCKS_SCRIPT = () => {
  const groups = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (el.getClientRects().length === 0) continue;
    const cls = typeof el.className === "string" ? el.className.trim() : "";
    if (!cls) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, new Map());
    const key = el.tagName + "|" + cls;
    const byKey = groups.get(parent);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(el);
  }
  const seenTexts = new Set();
  const results = [];
  groups.forEach((byKey) => {
    byKey.forEach((elements) => {
      if (elements.length < 3 || elements.length > 500) return;
      const raw = (elements[0].innerText || elements[0].textContent || "").trim();
      if (!raw) return;
      const text = raw.split("\n")[0].trim().slice(0, 120);
      if (text.length < 2 || seenTexts.has(text)) return;
      seenTexts.add(text);
      results.push({ text, count: elements.length });
    });
  });
  results.sort((a, b) => b.count - a.count);
  return results.slice(0, 15);
};

// ---------------- ağaç düğümü üretimi ----------------
const mkNode = (name, type, children = []) => ({
  name, type, status: "⬜",
  notes: [], jiraTasks: [], resourceLinks: [], statusHistory: [],
  lastVerifiedAt: null, staleReviewDays: 30, linkTos: [], open: true,
  children, testCases: [],
});

const repeatedBlocksToChildren = (blocks) =>
  blocks.map((b) => mkNode(`${b.text} (×${b.count} benzer öğe, örnek olarak 1 tanesi eklendi)`, "function"));

function headingsToChildren(headings) {
  const children = [];
  let currentSection = null;
  for (const h of headings) {
    if (h.skip) continue;
    let text = (h.text ?? "").trim();
    if (!text) continue;
    if (h.repeatCount) text = `${text} (×${h.repeatCount} benzer öğe, örnek olarak 1 tanesi eklendi)`;
    if (h.tag === "h1") continue;                    // sayfa adiyla ayni sey
    if (h.tag === "h2") {
      currentSection = mkNode(text, "section");
      children.push(currentSection);
    } else {
      const fn = mkNode(text, "function");
      if (currentSection) currentSection.children.push(fn);
      else children.push(fn);
    }
  }
  return children;
}

// ---------------- etkileşim denemesi ----------------
/**
 * Güvenli görünen öğelere (buton/sekme/detay) tıklayıp açığa çıkan yeni
 * başlıkları toplar. Yıkıcı kelime içeren hiçbir öğeye dokunulmaz; form
 * doldurulmaz, gönderilmez.
 */
async function tryInteractions(page, existingHeadings) {
  const originalUrl = page.url();
  const before = new Set(existingHeadings.map((h) => `${h.tag ?? ""}|${(h.text ?? "").trim()}`));
  const out = [];
  let candidates = [];
  try { candidates = await page.$$('button, [role="button"], summary'); } catch { return out; }

  let tried = 0;
  for (const el of candidates) {
    if (tried >= MAX_INTERACTIONS_PER_PAGE) break;
    let text = "";
    try { text = ((await el.innerText()) ?? "").trim(); } catch { continue; }
    if (!text) continue;
    const lower = text.toLowerCase();
    if (DESTRUCTIVE_KEYWORDS.some((kw) => lower.includes(kw))) continue;
    try { if (!(await el.isVisible())) continue; } catch { continue; }

    tried++;
    try { await el.click({ timeout: 3000 }); } catch { continue; }
    try { await page.waitForLoadState("networkidle", { timeout: 1500 }); } catch { /* devam */ }
    await page.waitForTimeout(INTERACTION_WAIT_MS);

    const navigated = page.url() !== originalUrl;
    let after = [];
    try { after = await page.evaluate(HEADINGS_SCRIPT); } catch { after = []; }
    const newly = after.filter((h) => !before.has(`${h.tag ?? ""}|${(h.text ?? "").trim()}`));
    const kids = headingsToChildren(newly);
    if (kids.length) out.push(mkNode(text, "function", kids));

    if (navigated) {
      try { await page.goBack({ timeout: NAV_TIMEOUT_MS }); }
      catch {
        try { await page.goto(originalUrl, { timeout: NAV_TIMEOUT_MS }); } catch { break; }
      }
    } else {
      try { await page.keyboard.press("Escape"); } catch { /* modal yoksa gec */ }
      await page.waitForTimeout(200);
    }
  }
  return out;
}

// ---------------- tarayıcı açma ----------------
/**
 * Playwright'ın indirdiği tarayıcı sürümü paketle uyuşmayabiliyor
 * (`npx playwright install` çalıştırılmamışsa). Bu durumda sistemdeki
 * Chrome'a düşülür — sessizce başarısız olmak yerine.
 */
async function launchBrowser(headless) {
  const { chromium } = await import("@playwright/test");
  try {
    return await chromium.launch({ headless });
  } catch (e) {
    try {
      return await chromium.launch({ headless, channel: "chrome" });
    } catch {
      throw new Error(
        `Tarayıcı açılamadı. 'npx playwright install chromium' gerekebilir. Ayrıntı: ${e.message.slice(0, 120)}`,
      );
    }
  }
}

/**
 * Kapı/oturum durumu — SADECE projenin kendi host'una.
 *
 * Bazı test ortamları bir erişim kapısının arkasında durur; oturumsuz tarama
 * her sayfada kapı ekranını görür ve ağaç çöp olur. Panelde zaten geçerli bir
 * `playwright/.auth/<ortam>-gate.json` duruyor, onu kullanıyoruz.
 *
 * ⚠️ GÜVENLİK: oturum yalnızca hedef host projenin base URL'iyle AYNI ise
 * eklenir. Aksi halde rastgele bir siteyi tararken müşteri ortamının
 * cookie'leri o siteye gönderilmiş olurdu.
 */
function isOwnHost(targetUrl, projectBaseUrl) {
  if (!projectBaseUrl) return false;
  try { return new URL(targetUrl).host === new URL(projectBaseUrl).host; } catch { return false; }
}

function sessionStateFor(targetUrl, projectBaseUrl) {
  if (!isOwnHost(targetUrl, projectBaseUrl)) return null;
  const file = path.join(process.cwd(), "playwright", ".auth", `${activeEnv()}-gate.json`);
  return fs.existsSync(file) ? file : null;
}

// ---------------- iş yönetimi ----------------
export function startCrawlJob({ url, maxDepth = 2, maxPages = 15, requireLogin = false, interactWithUI = false, ignoreRobots = false, projectBaseUrl = "" }) {
  const depth = Math.max(0, Math.min(Number(maxDepth) || 0, HARD_MAX_DEPTH));
  const pages = Math.max(1, Math.min(Number(maxPages) || 1, HARD_MAX_PAGES));
  const jobId = `crawl-${Date.now().toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`;
  const job = {
    status: "running",            // running | waiting_login | done | error | cancelled
    startUrl: url,
    visited: 0,
    total: pages,
    currentUrl: url,
    error: null,
    tree: null,
    cancelled: false,
    needsLogin: Boolean(requireLogin),
    loginConfirmed: false,
    startedAt: new Date().toISOString(),
    /** Kapı oturumu kullanıldı mı — arayüzde ve log'da görünsün. */
    usingSession: Boolean(sessionStateFor(url, projectBaseUrl)),
    /**
     * robots.txt atlandı mı. YALNIZCA projenin kendi host'unda mümkün:
     * staging siteleri arama motorlarını dışarıda tutmak için `Disallow: /`
     * yazar, bu ekibin kendi QA aracını yasaklamak anlamına gelmez. Yabancı
     * bir siteye "robots'u yoksay" DENEMEZ — orada kural mutlaktır.
     */
    ignoringRobots: Boolean(ignoreRobots) && isOwnHost(url, projectBaseUrl),
  };
  jobs.set(jobId, job);
  crawl(job, {
    depth, pages,
    requireLogin: Boolean(requireLogin),
    interactWithUI: Boolean(interactWithUI),
    storageState: sessionStateFor(url, projectBaseUrl),
    ignoreRobots: Boolean(ignoreRobots) && isOwnHost(url, projectBaseUrl),
  })
    .catch((e) => { job.status = "error"; job.error = `Beklenmeyen hata: ${e.message}`; });
  return jobId;
}

export const getJob = (id) => { const j = jobs.get(id); return j ? { ...j } : null; };
export const cancelJob = (id) => { const j = jobs.get(id); if (j) j.cancelled = true; };
export const confirmLogin = (id) => { const j = jobs.get(id); if (j) j.loginConfirmed = true; };
export const limits = () => ({ maxDepth: HARD_MAX_DEPTH, maxPages: HARD_MAX_PAGES });

// ---------------- asıl tarama ----------------
async function crawl(job, { depth: maxDepth, pages: maxPages, requireLogin, interactWithUI, storageState, ignoreRobots }) {
  let start;
  try { start = new URL(job.startUrl); } catch { start = null; }
  if (!start || !["http:", "https:"].includes(start.protocol)) {
    job.status = "error";
    job.error = "Geçersiz URL (http:// veya https:// ile başlamalı).";
    return;
  }
  const originHost = start.host;

  // Alt yoldan başlatıldıysa o yolun dışına çıkma (kaynak kural R28).
  let startPath = start.pathname || "/";
  if (startPath.length > 1 && startPath.endsWith("/")) startPath = startPath.slice(0, -1);
  const scopePrefix = startPath !== "/" ? startPath : "";
  const inScope = (p) => !scopePrefix || p === scopePrefix || (p ?? "/").startsWith(scopePrefix + "/");

  const robots = ignoreRobots ? null : await loadRobots(start.origin);
  const allowed = (u) => {
    if (!robots) return true;
    try { return robots.isAllowed(new URL(u).pathname); } catch { return true; }
  };
  // Baslangic sayfasi robots tarafindan engelliyse SEBEBI SOYLE. Kaynak surum
  // burada "engel veya yukleme hatasi olabilir" diyordu; iki bambaska sorun
  // ayni belirsiz mesaja dusuyordu.
  if (!allowed(job.startUrl)) {
    job.status = "error";
    job.error =
      "robots.txt bu adresin taranmasini yasakliyor. Kendi projenizin ortamiysa " +
      "'robots.txt kurallarini yoksay' secenegini isaretleyin (yalnizca proje host'unda gecerli).";
    return;
  }

  const visited = new Map();        // norm -> node
  const visitedUrls = new Map();    // norm -> gercek url
  const order = [];                 // [norm, parentNorm]
  const rootNorm = normalizeUrl(job.startUrl);
  const queue = [{ norm: rootNorm, url: job.startUrl, depth: 0, parent: null }];
  const seen = new Set([rootNorm]);
  const templateCounts = new Map([[routeTemplate(start.pathname), 1]]);
  const titleCounts = new Map();

  const browser = await launchBrowser(!requireLogin);
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      ...(storageState ? { storageState } : {}),
    });
    const page = await context.newPage();

    if (requireLogin) {
      job.status = "waiting_login";
      try { await page.goto(job.startUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }); } catch { /* elle gezinebilir */ }
      let waited = 0;
      while (!job.loginConfirmed) {
        if (job.cancelled) { job.status = "cancelled"; return; }
        await sleep(500);
        waited += 500;
        if (waited > LOGIN_WAIT_TIMEOUT_MS) {
          job.status = "error";
          job.error = "Giriş için ayrılan süre (10 dakika) doldu. Tekrar deneyin.";
          return;
        }
      }
      job.status = "running";
    }

    while (queue.length && visited.size < maxPages) {
      if (job.cancelled) { job.status = "cancelled"; return; }
      const { norm, url, depth, parent } = queue.shift();
      if (visited.has(norm)) continue;
      job.currentUrl = url;
      if (!allowed(url)) continue;

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      } catch {
        try { await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS }); }
        catch { continue; }
      }
      // SPA'lar icerigi yuklemeden sonra render edebilir.
      await page.waitForTimeout(1200);

      const rawTitle = ((await page.title()) ?? "").trim();
      let headings = [];
      try { headings = await page.evaluate(HEADINGS_SCRIPT); } catch { headings = []; }
      if (!headings.length) {
        await page.waitForTimeout(2000);
        try { headings = await page.evaluate(HEADINGS_SCRIPT); } catch { headings = []; }
      }

      // SPA'da <title> route degisince guncellenmeyebilir: ayni title ikinci kez
      // goruluyorsa sayfanin kendi ilk basligi daha ayirt edici.
      titleCounts.set(rawTitle, (titleCounts.get(rawTitle) ?? 0) + 1);
      const titleIsGeneric = Boolean(rawTitle) && titleCounts.get(rawTitle) > 1;
      const pageHeading = headings.length ? (headings[0].text ?? "").trim() : "";
      let name, childHeadings;
      if (titleIsGeneric && pageHeading) { name = pageHeading; childHeadings = headings.slice(1); }
      else { name = rawTitle || pageHeading || url; childHeadings = headings; }

      let children = headingsToChildren(childHeadings);
      if (!children.length) {
        let blocks = [];
        try { blocks = await page.evaluate(REPEATED_BLOCKS_SCRIPT); } catch { blocks = []; }
        children = children.concat(repeatedBlocksToChildren(blocks));
      }
      if (interactWithUI) {
        try { children = children.concat(await tryInteractions(page, headings)); } catch { /* statik icerik korunur */ }
      }

      visited.set(norm, mkNode(name, "page", children));
      visitedUrls.set(norm, page.url());
      order.push([norm, parent]);
      job.visited = visited.size;

      if (depth < maxDepth) {
        let hrefs = [];
        try { hrefs = await page.$$eval("a[href]", (els) => els.map((e) => e.href)); } catch { hrefs = []; }
        for (const href of hrefs) {
          let hp;
          try { hp = new URL(href); } catch { continue; }
          if (!["http:", "https:"].includes(hp.protocol) || hp.host !== originHost) continue;
          if (!inScope(hp.pathname)) continue;
          const n2 = normalizeUrl(href);
          if (seen.has(n2)) continue;
          const tpl = routeTemplate(hp.pathname);
          const count = templateCounts.get(tpl) ?? 0;
          if (count >= ROUTE_TEMPLATE_CAP) continue;   // bu sablondan zaten ornek alindi
          templateCounts.set(tpl, count + 1);
          seen.add(n2);
          queue.push({ norm: n2, url: href, depth: depth + 1, parent: norm });
        }
      }
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (job.cancelled) { job.status = "cancelled"; return; }

  const root = visited.get(rootNorm);
  if (!root) {
    job.status = "error";
    job.error = "Başlangıç sayfası açılamadı (robots.txt engeli veya yükleme hatası olabilir).";
    return;
  }
  root.type = "module";
  for (const [norm, parentNorm] of order) {
    if (norm === rootNorm) continue;
    const n = visited.get(norm);
    const parent = parentNorm ? visited.get(parentNorm) : null;
    (parent ?? root).children.push(n);
  }
  job.tree = root;
  job.status = "done";
}
