#!/usr/bin/env node
/**
 * Homee QA — kapsamlı proje raporu (HTML).
 *
 * Case envanterini tests/*.spec.ts dosyalarından PARSE eder (elle liste tutulmaz),
 * verilen results.json dosyalarından son koşum sonuçlarını birleştirir.
 *
 * Kullanım:
 *   node scripts/create-full-report.cjs
 *   node scripts/create-full-report.cjs --out rapor.html --results .results-guest.json,.results-member.json
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const OUT = arg("--out", "homee-qa-raporu.html");
const RESULT_FILES = arg("--results", path.join("test-results", "results.json"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// known-issues.ts icindeki anahtar -> HOMEE kodu haritasi
const ISSUE_IDS = (() => {
  const f = path.join(ROOT, "tests", "known-issues.ts");
  if (!fs.existsSync(f)) return {};
  const src = fs.readFileSync(f, "utf8");
  const map = {};
  const re = /(\w+):\s*\{\s*id:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) map[m[1]] = m[2];
  return map;
})();

// ---------------------------------------------------------------- case envanteri
function parseSpecs() {
  const dir = path.join(ROOT, "tests");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".spec.ts"))
    .sort();

  return files.map((file) => {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const isMember = /from "\.\/fixtures"/.test(src);

    const testRe = /\n\s*test\(\s*(?:"([^"]+)"|`([^`]+)`)/g;
    const positions = [];
    let m;
    while ((m = testRe.exec(src))) positions.push({ title: m[1] ?? m[2], start: m.index });

    const cases = positions.map((pos, i) => {
      let end = i + 1 < positions.length ? positions[i + 1].start : src.length;
      // Bir sonraki case'in ustundeki JSDoc yorumu bu case'in govdesine sizmasin
      // (yoksa yanlis HOMEE kodu etiketlenir).
      if (i + 1 < positions.length) {
        const tail = src.slice(Math.max(pos.start, end - 700), end);
        const cutAt = tail.lastIndexOf("/**");
        if (cutAt > -1) end = Math.max(pos.start, end - 700) + cutAt;
      }
      const body = src.slice(pos.start, end);
      const key = body.match(/test\.fail\([\s\S]{0,80}?KNOWN_ISSUES\.(\w+)/)?.[1];
      return {
        title: pos.title,
        parametric: /\$\{/.test(pos.title),
        knownIssue: /test\.fail\(/.test(body)
          ? (key && ISSUE_IDS[key]) || body.match(/HOMEE-\d+/)?.[0] || "bilinen hata"
          : null,
        mutates:
          /addToCart|removeLine|\.clear\(\)|fillForm|deleteAddress|favoriteButton|togglePermission|logout\(/.test(
            body,
          ),
        skippable: /test\.skip\(/.test(body),
      };
    });

    const describes = [...src.matchAll(/test\.describe\(\s*"([^"]+)"/g)].map((d) => d[1]);
    return { file, group: describes[0] ?? file, isMember, cases };
  });
}

// ---------------------------------------------------------------- koşum sonuçları
function parseResults(files) {
  // Aynı test birden fazla dosyada varsa SONRAKİ kazanır (düzeltme sonrası
  // tekrar koşulan spec'ler eski sonucu ezsin diye).
  const byKey = new Map();
  let startedAt = null;
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (raw.stats?.startTime && (!startedAt || raw.stats.startTime > startedAt)) {
      startedAt = raw.stats.startTime;
    }
    const walk = (suite, file) => {
      const fp = suite.file || file;
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const last = t.results?.[t.results.length - 1] ?? {};
          const row = {
            file: (fp || "").replace(/^tests\//, ""),
            title: spec.title,
            status: last.status ?? "unknown",
            expected: t.expectedStatus,
            duration: last.duration ?? 0,
            error: (last.error?.message ?? "").replace(/\[[0-9;]*m/g, "").split("\n")[0],
          };
          byKey.set(`${row.file}||${row.title}`, row);
        }
      }
      for (const c of suite.suites ?? []) walk(c, fp);
    };
    for (const s of raw.suites ?? []) walk(s, s.file);
  }
  const rows = [...byKey.values()];
  if (!rows.length) return null;

  const expectedFail = rows.filter((r) => r.expected === "failed" && r.status === "failed");
  const realFail = rows.filter(
    (r) => (r.status === "failed" || r.status === "timedOut") && r.expected !== "failed",
  );
  return {
    startedAt,
    rows,
    total: rows.length,
    passed: rows.filter((r) => r.status === "passed").length,
    knownIssue: expectedFail.length,
    realFail: realFail.length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    durationMs: rows.reduce((a, r) => a + r.duration, 0),
    realFailRows: realFail,
  };
}

// ---------------------------------------------------------------- yardımcılar
const countFiles = (dir, filter) => {
  const p = path.join(ROOT, dir);
  return fs.existsSync(p) ? fs.readdirSync(p).filter(filter).length : 0;
};

function readKnownIssues() {
  const f = path.join(ROOT, "tests", "known-issues.ts");
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, "utf8");
  const out = [];
  const re = /id:\s*"([^"]+)",\s*where:\s*"([^"]+)",\s*detail:\s*\n?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    out.push({
      id: m[1],
      where: m[2],
      detail: m[3],
      intermittent: /ARALIKLI/.test(before),
    });
  }
  return out;
}

function readRoutes() {
  const f = path.join(ROOT, "tests", "routes.ts");
  if (!fs.existsSync(f)) return {};
  const src = fs.readFileSync(f, "utf8");
  const arr = (name) => {
    const m = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  return {
    withProducts: arr("LISTING_WITH_PRODUCTS"),
    empty: arr("LISTING_EMPTY"),
    broken: arr("KNOWN_BROKEN_ROUTES"),
    content: arr("CONTENT_PAGES"),
  };
}

const specs = parseSpecs();
const results = parseResults(RESULT_FILES);
const issues = readKnownIssues();
const routes = readRoutes();

const guestSpecs = specs.filter((s) => !s.isMember);
const memberSpecs = specs.filter((s) => s.isMember);
const sum = (list) => list.reduce((a, s) => a + s.cases.length, 0);
const totalCases = sum(specs);
const mutatingCases = specs.reduce((a, s) => a + s.cases.filter((c) => c.mutates).length, 0);
const knownIssueCases = specs.reduce((a, s) => a + s.cases.filter((c) => c.knownIssue).length, 0);
const pomCount = countFiles("pages", (f) => f.endsWith("Page.ts"));
const agentCount = countFiles(".claude/agents", (f) => f.endsWith(".md"));
const env = process.env.HOMEE_ENV ?? "test";
const baseURL =
  process.env[`BASE_URL_${env.toUpperCase()}`] ?? "https://redesign-prod.test.tepehome.com.tr";
const today = new Date().toLocaleDateString("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const fmt = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(0)} sn` : `${(ms / 60000).toFixed(1)} dk`);

const statusFor = (spec, title) => {
  if (!results) return null;
  const exact = results.rows.find((r) => r.file === spec && r.title === title);
  if (exact) return exact;
  // Parametrik baslik: "${route.path} acilir ..." → sabit kismiyla esle
  if (title.includes("${")) {
    const suffix = title.split("}").pop().trim();
    const matches = results.rows.filter((r) => r.file === spec && r.title.includes(suffix));
    if (matches.length) {
      const bad = matches.find((r) => r.status !== "passed" && r.status !== "skipped");
      return bad ?? matches[0];
    }
  }
  return null;
};

const statusBadge = (r) => {
  if (!r) return '<span class="muted">—</span>';
  if (r.status === "passed") return '<span class="tag tp">geçti</span>';
  if (r.status === "skipped") return '<span class="tag ts">atlandı</span>';
  if (r.expected === "failed") return '<span class="tag ti">bilinen hata</span>';
  return '<span class="tag tf">başarısız</span>';
};

const prettyTitle = (c) =>
  c.parametric
    ? esc(c.title.replace(/\$\{[^}]+\}/g, "<rota>")) +
      ' <span class="cnt">(listedeki her rota icin ayri kosar)</span>'
    : esc(c.title);

const caseRow = (spec, c, i) => {
  const tags = [];
  if (c.knownIssue) tags.push(`<span class="tag ti">${esc(c.knownIssue)}</span>`);
  if (c.mutates) tags.push('<span class="tag tm">veri değiştirir</span>');
  if (c.skippable) tags.push('<span class="tag ts">koşullu</span>');
  return `<tr>
    <td class="num">${i}</td>
    <td>${prettyTitle(c)}</td>
    <td>${tags.join(" ") || '<span class="muted">—</span>'}</td>
    <td>${statusBadge(statusFor(spec, c.title))}</td>
  </tr>`;
};

const specBlock = (s) => `
<div class="spec">
  <h4><span class="mono">${esc(s.file)}</span> — ${esc(s.group)} <span class="cnt">${s.cases.length} case</span></h4>
  <table class="cases">
    <tr><th style="width:34px">#</th><th>Test case</th><th style="width:190px">İşaret</th><th style="width:92px">Son koşum</th></tr>
    ${s.cases.map((c, i) => caseRow(s.file, c, i + 1)).join("")}
  </table>
</div>`;

const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>Homee QA Otomasyon Raporu</title>
<style>
  @page { size: A4; margin: 15mm 13mm; }
  :root {
    --fg:#18181b; --mut:#6b7280; --line:#e4e4e7; --card:#f7f7f8;
    --ok:#0f766e; --no:#b91c1c; --warn:#a16207; --acc:#b91c1c;
  }
  * { box-sizing:border-box }
  body { margin:0; color:var(--fg); background:#fff;
         font:10.5pt/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  h1 { font-size:23pt; margin:0 0 6px; letter-spacing:-.02em }
  h2 { font-size:14pt; margin:24px 0 10px; padding-bottom:5px; border-bottom:2px solid var(--fg) }
  h3 { font-size:11.5pt; margin:16px 0 7px }
  h4 { font-size:10pt; margin:13px 0 5px }
  p { margin:0 0 8px }
  .lead { color:var(--mut); font-size:10pt }
  .cover { border-bottom:3px solid var(--acc); padding-bottom:13px; margin-bottom:16px }
  .kv { display:grid; grid-template-columns:120px 1fr; gap:2px 10px; font-size:9.5pt; margin-top:9px }
  .kv dt { color:var(--mut) } .kv dd { margin:0 }
  .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin:13px 0 }
  .c { border:1px solid var(--line); border-radius:7px; padding:8px 10px; background:var(--card) }
  .c .n { font-size:18pt; font-weight:680; line-height:1.05 }
  .c .l { font-size:8pt; color:var(--mut); margin-top:3px; text-transform:uppercase; letter-spacing:.05em }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:6px 0 11px }
  th,td { text-align:left; padding:4.5px 7px; border-bottom:1px solid var(--line); vertical-align:top }
  th { background:var(--card); font-size:8pt; text-transform:uppercase; letter-spacing:.05em; color:var(--mut) }
  td.num { color:var(--mut); font-variant-numeric:tabular-nums }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:8.5pt }
  .muted { color:var(--mut) }
  .cnt { font-size:8pt; color:var(--mut); font-weight:400 }
  .tag { font-size:7.5pt; font-weight:650; padding:1px 5px; border-radius:4px; white-space:nowrap; border:1px solid }
  .ti { color:var(--no); border-color:var(--no) }
  .tm { color:var(--warn); border-color:var(--warn) }
  .ts { color:var(--mut); border-color:var(--line) }
  .tp { color:var(--ok); border-color:var(--ok) }
  .tf { color:#fff; background:var(--no); border-color:var(--no) }
  .spec { break-inside:avoid; page-break-inside:avoid }
  .note { border-left:3px solid var(--acc); background:var(--card); padding:8px 11px; margin:9px 0; font-size:9.5pt }
  .ok { color:var(--ok) } .no { color:var(--no) }
  ul { margin:0 0 9px; padding-left:17px } li { margin-bottom:3px }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:0 20px }
  .brk { page-break-before:always }
  footer { margin-top:24px; padding-top:8px; border-top:1px solid var(--line); font-size:8pt; color:var(--mut) }
</style></head><body>

<div class="cover">
  <h1>Homee QA Otomasyon Raporu</h1>
  <p class="lead">Tepe Home redesign için Playwright E2E regresyon suite'i — kurulum, kapsam ve ilk tarama bulguları</p>
  <dl class="kv">
    <dt>Tarih</dt><dd>${today}</dd>
    <dt>Ortam</dt><dd class="mono">${esc(env)} — ${esc(baseURL)}</dd>
    <dt>Repo</dt><dd class="mono">~/Desktop/homee-tests</dd>
    <dt>Mimari kaynak</dt><dd>NadirGold QA suite (taşındı ve Homee'ye uyarlandı)</dd>
  </dl>
</div>

<div class="cards">
  <div class="c"><div class="n">${totalCases}${results ? `<span style="font-size:10pt;font-weight:400"> → ${results.total}</span>` : ""}</div><div class="l">case tanımı${results ? " → koşan test" : ""}</div></div>
  <div class="c"><div class="n">${specs.length}</div><div class="l">spec dosyası</div></div>
  <div class="c"><div class="n">${pomCount}</div><div class="l">page object</div></div>
  <div class="c"><div class="n">${agentCount}</div><div class="l">claude agent</div></div>
</div>

<h2>1. Ne yaptık</h2>

<p>NadirGold QA suite'inin mimarisi Homee'ye taşındı. Homee'nin farklı davrandığı yerlerde mimari
tahminle değil <b>ölçümle</b> değiştirildi. Sonuç: <b>${totalCases} test case</b>,
${guestSpecs.length} misafir + ${memberSpecs.length} üye spec dosyası, ${pomCount} page object,
yerel QA paneli, rapor üreticisi ve ${agentCount} Claude Code agent'ı.</p>

<h3>1.1 NadirGold'dan aynen taşınanlar</h3>
<ul>
  <li><b>Ortam çözümü:</b> <span class="mono">HOMEE_ENV</span> → <span class="mono">BASE_URL_&lt;ENV&gt;</span>; tanımsızsa koşum başlamadan hata verir.</li>
  <li><b>POM katmanı:</b> locator'lar <span class="mono">readonly</span>, method'lar <span class="mono">async</span>; ortak davranış <span class="mono">BasePage</span>'de toplanır.</li>
  <li><b>Numaralı spec konvansiyonu:</b> <span class="mono">tests/NN-shortname.spec.ts</span>; her grup için <span class="mono">npm run test:&lt;kısaad&gt;</span> script'i.</li>
  <li><b>Test hijyeni:</b> mutasyon yapan test başlangıç durumunu geri alır ve geri aldığını <b>ölçerek</b> doğrular; yıkıcı işlemde seçici konteynere kilitlenir.</li>
  <li><b>Yıkıcı işlem guard'ı:</b> NadirGold'da <span class="mono">ALLOW_PROD_ORDERS</span>, Homee'de <span class="mono">ALLOW_HOMEE_ORDERS</span>.</li>
  <li><b>QA Paneli:</b> whitelist'li koşum tetikleme + SSE canlı log + verdict/kanıt kaydı.</li>
  <li><b>Agent seti:</b> explorer / planner / pom-generator / env-switcher / flaky-analyzer / report-builder.</li>
</ul>

<h3>1.2 Homee için değiştirilenler</h3>
<table>
  <tr><th style="width:34%">Homee'nin farkı</th><th>Çözüm</th></tr>
  <tr><td><b>İki katmanlı kimlik:</b> tüm site Machinarium "Geçici Erişim" kapısının arkasında, onun arkasında ayrıca Tepe Home üye girişi var.</td>
      <td>İki ayrı oturum: kapı state'i <span class="mono">&lt;env&gt;-gate.json</span> (misafir testlerinin varsayılanı) + üye oturumu fixture üzerinden.</td></tr>
  <tr><td><b>Üye oturumu paylaşılamıyor:</b> refresh-token kullanımda rotate ediyor. Ölçüm: kaydedilmiş state'i 1. context kullanır, 2. ve 3. context <span class="mono">/giris</span>'e düşer.</td>
      <td>NadirGold'un "tek state'i tüm testler paylaşır" deseni bırakıldı. <span class="mono">memberPage</span> fixture'ı her üye testi için UI login yapar (~8 sn).</td></tr>
  <tr><td><b>Türkçe <span class="mono">İ</span> + regex <span class="mono">/i</span> eşleşmiyor</b> (U+0130 case-fold edilmiyor): <span class="mono">/KATEGORİLER/i</span>, aria-label <span class="mono">"Kategoriler"</span>'i bulamıyor.</td>
      <td>Türkçe metinlerde tam string, <span class="mono">exact: true</span> ve <span class="mono">:has-text()</span> kullanıldı.</td></tr>
  <tr><td><b>Header'ın görünmez ikizi:</b> her header öğesi DOM'da iki kez var, biri <span class="mono">display:none</span> — <span class="mono">.first()</span> görünmez olanı yakalıyor.</td>
      <td>Tüm header seçicilerinde <span class="mono">:visible</span>.</td></tr>
  <tr><td><b>404'te de HTTP 200</b> dönüyor — durum kodu yalan söylüyor.</td>
      <td><span class="mono">BasePage.isNotFound()</span> DOM'dan "Sayfa Bulunamadı" arar.</td></tr>
  <tr><td><b>Lazy içerik:</b> ürün karuselleri ve formlar scroll edilmeden DOM'a girmiyor.</td>
      <td><span class="mono">loadLazyContent()</span> — kart/alan sayan her test önce bunu çağırır.</td></tr>
  <tr><td><b>Sepete ekleme hydration yarışı:</b> ilk tıklama sessizce kaybolabiliyor.</td>
      <td><span class="mono">addToCart()</span> header badge'ini doğrular, değişmezse bir kez tekrar dener.</td></tr>
  <tr><td><b>Modal backdrop'ı da "Kapat" butonu</b> (<span class="mono">inset-0</span>) — overlay temizleyici açık adres formunu kapatıyordu.</td>
      <td>Overlay temizleyici <span class="mono">inset-0</span> taşıyan kapatıcıları hariç tutar.</td></tr>
  <tr><td><b>Arama ve öneri kartları prod domain'ine link veriyor.</b></td>
      <td>Ürün sayımları site içi linklerle yapılır; sızma ayrı bir regresyon kontrolü olarak kayda alındı (HOMEE-005).</td></tr>
  <tr><td><b>Şehir/İlçe/Mahalle native <span class="mono">select</span> değil</b> — açılan liste sayfa genelinde aranınca hesap menüsünü yakalıyor.</td>
      <td>Dropdown popup'ı butona göre konumlanır (<span class="mono">following::ul[1]</span>).</td></tr>
</table>

<div class="note"><b>Bilinen hata deseni:</b> tespit edilen ürün hataları
<span class="mono">tests/known-issues.ts</span>'e kaydedilir ve ilgili test <span class="mono">test.fail()</span>
ile işaretlenir. Hata sürdükçe suite yeşil kalır; <b>hata düzeldiğinde test "beklenmedik şekilde geçti"</b>
diye kırmızıya döner ve kaydın silinmesini zorunlu kılar. Böylece bilinen hatalar ne gürültü yapar ne unutulur.
Bu mekanizma ilk koşumda işe yaradı: iki hatanın (kırık görsel, arama alakası) <b>aralıklı</b> olduğu
bu şekilde ortaya çıktı ve ikisi de doğrudan assertion'a çevrildi.</div>

${
  results
    ? `<h2>2. Son koşum sonuçları</h2>
<div class="cards">
  <div class="c"><div class="n">${results.total}</div><div class="l">koşan test</div></div>
  <div class="c"><div class="n ok">${results.passed}</div><div class="l">geçti</div></div>
  <div class="c"><div class="n no">${results.realFail}</div><div class="l">gerçek başarısız</div></div>
  <div class="c"><div class="n">${results.knownIssue}</div><div class="l">bilinen hata</div></div>
</div>
<p class="lead">Toplam süre ${fmt(results.durationMs)} · atlandı ${results.skipped}${
  results.startedAt ? ` · koşum ${new Date(results.startedAt).toLocaleString("tr-TR")}` : ""
}</p>
${
  results.realFailRows.length
    ? `<table><tr><th style="width:24%">Spec</th><th>Test</th><th style="width:32%">Hata</th></tr>${results.realFailRows
        .map(
          (r) =>
            `<tr><td class="mono">${esc(r.file)}</td><td>${esc(r.title)}</td><td class="mono">${esc(r.error || "-")}</td></tr>`,
        )
        .join("")}</table>`
    : "<p><b>Gerçek başarısızlık yok.</b> Kalan başarısızlıklar kayıt altındaki ürün hatalarıdır.</p>"
}`
    : `<h2>2. Son koşum sonuçları</h2>
<p class="muted">Bu rapor üretildiğinde koşum sonucu dosyası hazır değildi. Koşum bittikten sonra
raporu yeniden üretin: <span class="mono">node scripts/create-full-report.cjs</span></p>`
}

<h2 class="brk">3. Test kapsamı — tüm case'ler</h2>
<p class="lead"><b>${totalCases} case tanımı</b>${
  results
    ? ` → koşumda <b>${results.total} test</b> (statik sayfa testi listedeki her rota için tekrar ediyor)`
    : ""
} · ${mutatingCases} tanesi veri değiştirir (hepsi kendini geri alır)
· ${knownIssueCases} tanesi bilinen ürün hatasını <span class="mono">test.fail()</span> ile takip eder</p>

<h3>3.1 Misafir seti — login gerektirmez (${sum(guestSpecs)} case)</h3>
${guestSpecs.map(specBlock).join("")}

<h3>3.2 Üye seti — her test kendi UI login'ini yapar (${sum(memberSpecs)} case)</h3>
${memberSpecs.map(specBlock).join("")}

<h2 class="brk">4. Bulgular</h2>

<h3>4.1 Kırık rotalar — menüde/footer'da linki var, 404 dönüyor</h3>
<table><tr><th style="width:38%">Rota</th><th>Not</th></tr>
${routes.broken
  .map(
    (r) =>
      `<tr><td class="mono">${esc(r)}</td><td>kanonik karşılığı <span class="mono">/tum-urunler/&lt;slug&gt;</span> çalışıyor</td></tr>`,
  )
  .join("")}
</table>

<h3>4.2 Boş kategoriler — "0 ürün / Ürün bulunamadı"</h3>
<table><tr><th>Rota</th></tr>
${routes.empty.map((r) => `<tr><td class="mono">${esc(r)}</td></tr>`).join("")}
</table>
<p>Dikkat: header'ın iki ana menü linki de boş kategoriye gidiyor —
<span class="mono">MOBİLYA → /oturma-odasi/tamamlayici-mobilya</span> ve
<span class="mono">EVDEKOR → /tum-urunler/dekoratif-obje-figur</span>. Yani ana navigasyondan ürün
listesine ulaşılamıyor. Ürün dönen rotalar:
${routes.withProducts.map((r) => `<span class="mono">${esc(r)}</span>`).join(", ")}.</p>

<h3>4.3 Kayıtlı ürün hataları</h3>
<table><tr><th style="width:78px">Kod</th><th style="width:24%">Nerede</th><th>Belirti</th></tr>
${issues
  .map(
    (i) =>
      `<tr><td class="mono">${esc(i.id)}${i.intermittent ? '<br><span class="tag ts">aralıklı</span>' : ""}</td><td class="mono">${esc(i.where)}</td><td>${esc(i.detail)}</td></tr>`,
  )
  .join("")}
</table>
<p class="lead">En kritik olan <b>HOMEE-005</b>: <span class="mono">/arama?q=koltuk</span>
sonuçlarının tamamı (50/50, scroll sonrası 100/100) <span class="mono">prod.tepehome.com.tr</span>
adresine link veriyor. Test ortamındaki kullanıcı sonuç kartına bastığında canlı siteye çıkıyor;
test ürünleri aramada bulunamıyor.</p>

<h3>4.4 Ürün hatası sanılan ama olmayan davranışlar</h3>
<p class="lead">İlk koşumlarda hata gibi görünen, keşifle doğrulandığında doğru çalıştığı anlaşılan
davranışlar. Ekip bunları boşuna kovalamasın diye kayda geçirildi.</p>
<table>
  <tr><th style="width:36%">Görünen</th><th>Gerçek</th></tr>
  <tr><td>"Çıkış Yap oturumu kapatmıyor"</td>
      <td>Buton bir <b>onay diyaloğu</b> açıyor ("Bu cihazdaki oturumunuz sonlandırılacak"). Onay basıldığında <span class="mono">auth_token</span>/<span class="mono">refresh_token</span> siliniyor ve korumalı sayfa <span class="mono">/giris</span>'e yönleniyor.</td></tr>
  <tr><td>"Yanlış şifrede / boş formda hata mesajı yok"</td>
      <td>Mesaj var ("Lütfen e-posta adresinizi ya da şifrenizi kontrol edin.") ama ~1.2 sn sonra çıkıp <b>kaybolan bir toast</b>. Sabit bekleyip gövdeye bakan test kaçırıyor.</td></tr>
  <tr><td>"Ödeme yöntemleri render olmuyor"</td>
      <td><span class="mono">/odeme</span> adresine <b>doğrudan gidilemiyor</b>; sepette ürün olsa bile <span class="mono">/sepet</span>'e yönlendiriyor. Checkout oturumu "ÖDEME ADIMINA GEÇİN" ile açılıyor.</td></tr>
  <tr><td>"Adres silinemiyor"</td>
      <td>Silme iki aşamalı: kartın "Sil" butonu → <span class="mono">[role=dialog]</span> onayı. Doğru çalışıyor.</td></tr>
  <tr><td>"Favori eklenmiyor"</td>
      <td>Favori butonu <b>toggle</b>; ürün zaten favorideyse etiket "Favorilerden çıkar" oluyor. Favori listesi ayrıca lazy yükleniyor.</td></tr>
  <tr><td>"Sipariş sayfasında boş durum mesajı yok"</td>
      <td>Mesaj var: "Siparişiniz bulunmamaktadır." — beklenen metin farklı yazılmıştı.</td></tr>
</table>

<h2>5. Ne yapabiliyoruz</h2>

<div class="two"><div>
<h3>5.1 Koşum</h3>
<table>
  <tr><th>Komut</th><th>Ne yapar</th></tr>
  <tr><td class="mono">npm test</td><td>tüm suite</td></tr>
  <tr><td class="mono">npm run test:guest</td><td>misafir seti (01–09)</td></tr>
  <tr><td class="mono">npm run test:member</td><td>üye seti (20–25)</td></tr>
  <tr><td class="mono">npm run test:&lt;grup&gt;</td><td>tek grup, tarayıcı açık</td></tr>
  <tr><td class="mono">npm run panel</td><td>QA paneli (port 4646)</td></tr>
  <tr><td class="mono">npm run report:create</td><td>koşum raporu (HTML)</td></tr>
</table>
<h3>5.3 Otomatik takip</h3>
<ul>
  <li><b>Rota baseline'ı:</b> kırık rota düzelirse test fail eder, kaydın silinmesi zorunlu olur.</li>
  <li><b>Boş kategori baseline'ı:</b> kategori dolarsa test fail eder.</li>
  <li><b>Bilinen hata baseline'ı:</b> <span class="mono">test.fail()</span>; hata düzelince kırmızı.</li>
  <li><b>Yeni bozulma:</b> baseline'da olmayan 404, kırık görsel veya konsol hatası suite'i kırmızıya çevirir.</li>
</ul>
</div><div>
<h3>5.2 Agent'lar</h3>
<table>
  <tr><th>Agent</th><th>Ne zaman</th></tr>
  <tr><td class="mono">homee-explorer</td><td>"nerede tanımlı", salt-okuma arama</td></tr>
  <tr><td class="mono">homee-planner</td><td>yeni test / akış / refactor planı</td></tr>
  <tr><td class="mono">homee-pom-generator</td><td>yeni sayfa için POM (sayfayı gerçekten açar)</td></tr>
  <tr><td class="mono">homee-route-auditor</td><td>rota/link sağlığı, baseline hizalama</td></tr>
  <tr><td class="mono">homee-env-switcher</td><td>ortam geçişi, oturum kurulumu</td></tr>
  <tr><td class="mono">flaky-analyzer</td><td>kararsız test tespiti, N kez koşum</td></tr>
  <tr><td class="mono">homee-report-builder</td><td>HTML / PDF koşum raporu</td></tr>
</table>
<h3>5.4 QA Paneli</h3>
<ul>
  <li>18 whitelist'li koşumu tek tıkla tetikleme — whitelist dışı komut <b>çalışmaz</b>.</li>
  <li>SSE ile canlı log akışı; koşumu panelden durdurma.</li>
  <li>Son koşum sonuçları, "bilinen hata" ile "gerçek başarısızlık" ayrımı yapılmış halde.</li>
  <li>Verdict kaydı + kanıt görselleri, bilinen hata listesi, Playwright raporuna bağlantı.</li>
</ul>
</div></div>

<h2>6. Kapsam dışı ve sonraki adımlar</h2>
<table>
  <tr><th style="width:32%">Konu</th><th>Durum</th></tr>
  <tr><td>Sipariş tamamlama</td><td>Kasıtlı kapsam dışı. <span class="mono">25-checkout-to-payment</span> ödeme adımına kadar gider, "ÖDEME YAP" butonuna basmaz. Açmak için <span class="mono">ALLOW_HOMEE_ORDERS=1</span> ve test kartı bilgisi gerekir.</td></tr>
  <tr><td>Sipariş sonrası akışlar (sipariş detayı, iade talebi)</td><td>Hesapta 0 sipariş var; sipariş açılmadan test edilemiyor.</td></tr>
  <tr><td>Mobil viewport</td><td>Config'de <span class="mono">mobile</span> projesi hazır (Pixel 7 + Chrome); spec'ler henüz mobil için ayarlanmadı.</td></tr>
  <tr><td>Staging / prod ortamı</td><td>Env iskeleti hazır, URL'ler tanımsız. Doldurulunca <span class="mono">HOMEE_ENV</span> ile geçilir.</td></tr>
  <tr><td>Jira / Confluence entegrasyonu</td><td>Panelde kasıtlı olarak yok. İstenirse NadirGold panelindeki desenle eklenir (REST v3 + ADF gövde).</td></tr>
  <tr><td>SMS / Google / Apple ile giriş</td><td>Butonların varlığı doğrulanıyor, akışları test edilmiyor (harici sağlayıcı + OTP).</td></tr>
  <tr><td>Şifre değiştirme, hesap silme</td><td>Hesabı kalıcı bozan işlemler; kullanıcı onayı olmadan koşulmuyor. POM'da locator olarak var, tıklanmıyor.</td></tr>
  <tr><td>CI entegrasyonu</td><td>Henüz yok. Suite <span class="mono">workers:1</span> ve sistem Chrome'u ile koşuyor; CI'da tarayıcı kurulumu gerekir.</td></tr>
</table>

<footer>
Homee QA Otomasyon Raporu · ${today} · ortam ${esc(env)} · ${totalCases} test case ·
kaynak: <span class="mono">~/Desktop/homee-tests</span> — ayrıntı için CLAUDE.md, FINDINGS.md, README.md
</footer>
</body></html>`;

fs.writeFileSync(path.join(ROOT, OUT), html, "utf8");
console.log(`HTML rapor yazıldı: ${OUT}`);
console.log(
  `  ${totalCases} case / ${specs.length} spec / ${pomCount} POM / ${agentCount} agent` +
    (results
      ? ` | koşum: ${results.passed}/${results.total} geçti, ${results.realFail} gerçek başarısız, ${results.knownIssue} bilinen hata`
      : " | koşum sonucu yok"),
);
