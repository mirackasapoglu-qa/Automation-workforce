/*
 * KOŞUM KONSOLU — "Koşumlar" sekmesinin beyni.
 *
 * Panelin geri kalanı OKUMA ekranı; burası YAPMA ekranı. Üç adımı da aynı
 * sayfada tutmak zorunda: ne koşacağını seçmek · koşarken ne olduğunu görmek ·
 * bittiğinde sonuca göre aksiyon almak. Önceki hâli yalnızca birinciyi
 * yapıyordu (bir düğme listesi); koşum başlayınca sayfa hiçbir şey söylemiyor,
 * bitince başka sekmeye gitmek gerekiyordu.
 *
 * ⚠️ Klasik script, modül DEĞİL (panelin `onclick="..."` globalleri ve satır içi
 * kodu adla bakıyor) — dialogs.js / run-client.js / scope-client.js ile aynı desen.
 *
 * Veri kaynakları ZATEN VARDI, gösterilmiyordu:
 *   /api/meta            → whitelist koşumları (id, label, group, cmd)
 *   /api/runs/history    → koşum günlüğü (başlangıç, süre, sayımlar, durum)
 *   /api/run/state       → o an koşan + kuyruk
 *   /api/specs           → case sayıları, geçme oranı, kararsızlık, mutasyon işareti
 *   /api/scope/summary   → koşumun kapsadığı düğümler ve Jira kartları
 *   SSE                  → run-start / log / run-end / run-queued
 *
 * ⚠️ `META` / `SPECS` / `HEADLESS` panelin satır içi kodunda `let` ile tanımlı:
 * bunlar GLOBAL SÖZLÜKSEL kapsamda, `window` ÜZERİNDE DEĞİL (`window.META`
 * undefined döner — ölçüldü, tablo ilk denemede bu yüzden BOŞ çizildi). Klasik
 * script'ler bu kapsamı paylaştığı için çıplak adla okunuyorlar; erken çağrılma
 * ihtimaline karşı `rcMeta()` / `rcSpecs()` / `rcHeadless()` sarmalayıcıları var.
 */

/* eslint-disable no-unused-vars */

/** Sayfa durumu — yeniden çizimler arası korunur (sekme değişince sıfırlanmaz). */
const RC = {
  q: '',                 // filtre metni
  durum: 'hepsi',        // hepsi | basarisiz | hic | mutasyon
  gecmis: new Map(),     // runId -> günlük kayıtları (en yeni önde)
  canli: null,           // { id, label, startedAt, gecti, kaldi, satir }
  sonuc: null,           // biten koşumun özeti
  sayac: null,           // geçen süre zamanlayıcısı
};

/* ---------------------------------------------------------------- yardımcılar */

/** Panelin `let` ile tanımlı globalleri — TDZ'ye yakalanmadan oku. */
function rcMeta() { try { return META; } catch { return null; } }
function rcSpecs() { try { return Array.isArray(SPECS) ? SPECS : []; } catch { return []; } }
function rcHeadless() { try { return HEADLESS; } catch { return false; } }

const rcEsc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "3 dk 12 sn" / "45 sn" — süre okunur kalsın, ham ms değil. */
function rcSure(ms) {
  if (ms == null) return '';
  const sn = Math.round(ms / 1000);
  return sn < 60 ? `${sn} sn` : `${Math.floor(sn / 60)} dk ${String(sn % 60).padStart(2, '0')} sn`;
}

/** "2 dk önce" · "dün 14:05" — mutlak tarih uzun listede gürültü. */
function rcNeZaman(iso) {
  if (!iso) return '';
  const t = new Date(iso), fark = Date.now() - t;
  if (Number.isNaN(fark)) return '';
  const dk = Math.round(fark / 60000);
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  const saat = Math.round(dk / 60);
  if (saat < 24) return `${saat} sa önce`;
  const gun = Math.round(saat / 24);
  return gun === 1 ? 'dün' : `${gun} gün önce`;
}

/**
 * Koşumun dokunduğu spec dosyaları — SUNUCUDAN gelir (`/api/meta → runs[].specs`).
 *
 * ⚠️ Komutu istemcide ayrıştırmak YETMİYOR: koşumların çoğu `npm run test:sepet`
 * biçiminde ve gerçek spec yolu `package.json` scriptinde duruyor. İstemci onu
 * göremediği için risk rozetleri 22 koşumun 15'inde sessizce boş kalıyordu
 * (ölçüldü). Çözüm sunucuda (`specsForCommand`), burada sadece okunuyor.
 */
function rcSpecsOf(run) {
  return Array.isArray(run?.specs) ? run.specs : [];
}

/** Bir koşumun risk işaretleri — ⓘ tooltip'ine gömülü kalmasın, satırda dursun. */
function rcRisk(run, specs) {
  const rozet = [];
  const dosyalar = rcSpecs().filter((sp) =>
    specs.some((s) => (s.endsWith('*') ? sp.file.startsWith(s.slice(0, -1)) : sp.file === s)));

  // Gerçek sipariş açan koşum: guard kapalıysa spec zaten skip eder, ama
  // kullanıcı bunu düğmeye basmadan ÖNCE bilmeli.
  if (dosyalar.some((sp) => /order|havale/i.test(sp.file)) || /havale|order/i.test(run.id)) {
    rozet.push(rcMeta()?.ordersAllowed
      ? { k: 'SİPARİŞ AÇAR', c: 'no', t: 'Bu koşum GERÇEK sipariş açar ve guard AÇIK.' }
      : { k: 'sipariş guard', c: 'sk', t: 'Sipariş açan spec içeriyor; guard kapalı olduğu için spec skip eder.' });
  }
  if (dosyalar.some((sp) => sp.member)) rozet.push({ k: 'üye', c: '', t: 'Üye oturumu gerekir (her test kendi girişini yapar).' });
  if (dosyalar.some((sp) => (sp.list ?? []).some((c) => c.mutates))) {
    rozet.push({ k: 'veri değiştirir', c: 'sk', t: 'Veri oluşturur/siler — testler başlangıç durumunu geri alır.' });
  }
  return rozet;
}

/** Son N koşumun sonucu — bir bakışta kararsızlık görünsün. */
function rcNoktalar(kayitlar) {
  const son = kayitlar.slice(0, 10).reverse();
  if (!son.length) return '<span class="rc-dots rc-dots-bos" title="bu koşumun kaydı yok">—</span>';
  return '<span class="rc-dots">' + son.map((k) => {
    const cls = k.status === 'running' ? 'run'
      : !k.counts ? 'yok'
        : k.counts.failed ? 'no' : 'ok';
    const ip = `${rcNeZaman(k.startedAt)}${k.counts ? ` · ${k.counts.passed}/${k.counts.total}` : ' · sonuç kaydedilmemiş'}`;
    return `<i class="${cls}" title="${rcEsc(ip)}"></i>`;
  }).join('') + '</span>';
}

/** Günlüğü runId'ye göre grupla (en yeni önde). */
function rcGecmisKur(runs) {
  const m = new Map();
  for (const k of runs) {
    if (!k.runId) continue;
    if (!m.has(k.runId)) m.set(k.runId, []);
    m.get(k.runId).push(k);
  }
  for (const liste of m.values()) liste.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return m;
}

/* ------------------------------------------------------------ 1) canlı koşum */

/**
 * CANLI KOŞUM KARTI. SSE olayları zaten akıyordu ama yalnızca "Canlı log"
 * sekmesinde görünüyordu; kullanıcı koşumu başlatıp sayfada kalınca hiçbir şey
 * olmuyor gibi görünüyordu. Sayaç, o an koşan test ve akan geçti/kaldı sayımı
 * burada.
 */
function rcRenderLive() {
  const el = document.getElementById('runLive');
  if (!el) return;
  const c = RC.canli;
  if (!c) { el.hidden = true; el.innerHTML = ''; return; }

  const gecen = rcSure(Date.now() - c.startedAt);
  el.hidden = false;
  el.innerHTML = `
    <div class="rc-live">
      <span class="rc-live-dot"></span>
      <div class="rc-live-body">
        <div class="rc-live-t">${rcEsc(c.label)}</div>
        <div class="rc-live-m">${rcEsc(c.satir || 'başlıyor...')}</div>
      </div>
      <div class="rc-live-n">
        <span class="ok">${c.gecti}</span><span class="sep">/</span><span class="${c.kaldi ? 'no' : 'mut'}">${c.kaldi}</span>
        <span class="rc-live-s">${rcEsc(gecen)}</span>
      </div>
      <button class="rc-stop" onclick="stopRun()">durdur</button>
    </div>
    <div id="rcQueue"></div>`;
  rcRenderQueue();
}

/** Zamanlayıcı yalnız koşum varken döner — boşta saniyede bir çizim yapmayalım. */
function rcSayacBasla() {
  rcSayacDurdur();
  RC.sayac = setInterval(() => { if (RC.canli) rcRenderLive(); else rcSayacDurdur(); }, 1000);
}
function rcSayacDurdur() { if (RC.sayac) { clearInterval(RC.sayac); RC.sayac = null; } }

/** Log satırından "şu an ne koşuyor" ve geçti/kaldı sayımını çıkarır. */
function rcLogSatiri(line) {
  if (!RC.canli) return;
  const s = String(line ?? '');
  // Playwright satır formatı: "  ✓  12 [chromium] › tests/06-cart.spec.ts:31:5 › ... (4.2s)"
  const m = s.match(/›\s*([^›]+)\s*$/);
  if (m) RC.canli.satir = m[1].trim().slice(0, 110);
  if (/^\s*[✓✔]\s/.test(s)) RC.canli.gecti++;
  else if (/^\s*[✘×✗]\s/.test(s)) RC.canli.kaldi++;
}

/* --------------------------------------------------------------- 4) kuyruk */

/**
 * KUYRUK GÖRÜNÜR. Sunucu kuyruğu destekliyordu (`{queue:true}`) ama arayüzde
 * hiçbir yerde görünmüyordu: sıraya alınan koşum "kayboluyor" gibiydi.
 */
async function rcRenderQueue() {
  const el = document.getElementById('rcQueue');
  if (!el) return;
  let st = null;
  try { st = await (await fetch('/api/run/state')).json(); } catch { return; }
  const bekleyen = st?.pending ?? [];
  if (!bekleyen.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rc-queue">
    <span class="rc-queue-h">sırada ${bekleyen.length}</span>
    ${bekleyen.map((q, i) => `<span class="rc-queue-i" title="${rcEsc(q.label || q.runId)}">${i + 1}. ${rcEsc(q.label || q.runId)}</span>`).join('')}
    <button class="rc-queue-x" onclick="rcKuyrukTemizle()" title="Sıradakileri iptal et (süren koşum devam eder)">sırayı boşalt</button>
  </div>`;
}

async function rcKuyrukTemizle() {
  if (!await uiConfirm('Sıradaki koşumlar iptal edilecek. Süren koşum devam eder.',
    { title: 'Sırayı boşalt', ok: 'Boşalt', danger: true })) return;
  await post('/api/stop', { all: false });
  rcRenderQueue();
}

/* ------------------------------------------------------- 2) biten koşum sonucu */

/**
 * KOŞUM BİTİNCE YERİNDE SONUÇ. Önceden sonucu görmek için "Son sonuçlar"
 * sekmesine, bug kartı açmak için "Jira" sekmesine gitmek gerekiyordu; koşumu
 * başlatan kişi sonucu görene kadar iki sekme değiştiriyordu.
 *
 * ⚠️ Bilinen hata (`expected === 'failed'`) GERÇEK başarısızlıkla karıştırılmaz
 * — panelin her yerinde geçerli kural.
 */
async function rcRenderSonuc() {
  const el = document.getElementById('runResult');
  if (!el) return;
  if (!RC.sonuc) { el.hidden = true; el.innerHTML = ''; return; }

  let d = null;
  try { d = await (await fetch('/api/results')).json(); } catch { /* sonuc okunamadi */ }
  const rows = d?.rows ?? [];
  const gercek = rows.filter((r) => (r.status === 'failed' || r.status === 'timedOut') && r.expected !== 'failed');
  const bilinen = rows.filter((r) => (r.status === 'failed' || r.status === 'timedOut') && r.expected === 'failed');
  const gecti = rows.filter((r) => r.status === 'passed').length;

  const { label, code, durationMs } = RC.sonuc;
  const iyi = !gercek.length && code === 0;

  el.hidden = false;
  el.innerHTML = `
    <div class="rc-res ${iyi ? 'ok' : 'no'}">
      <div class="rc-res-h">
        <span class="rc-res-b">${iyi ? 'Temiz geçti' : 'Başarısız var'}</span>
        <span class="rc-res-t">${rcEsc(label)}</span>
        <span class="rc-res-m">${gecti} geçti${gercek.length ? ` · ${gercek.length} başarısız` : ''}${bilinen.length ? ` · ${bilinen.length} bilinen hata` : ''} · ${rcEsc(rcSure(durationMs))}</span>
        <button class="rc-res-x" title="Kapat" onclick="rcSonucKapat()">&times;</button>
      </div>
      ${gercek.length ? `<div class="rc-res-list">${gercek.slice(0, 8).map((r) => `
        <div class="rc-res-row">
          <span class="rc-res-n">${rcEsc(r.title)}<span class="f">${rcEsc(r.file)}</span></span>
          <button onclick='rcBugAc(${JSON.stringify({ file: r.file, title: r.title, error: r.error || '' }).replace(/'/g, '&#39;')})'
                  title="Jira sekmesinde bug formunu bu hatayla doldurur">bug kartı</button>
          <button onclick="rcTekrarKos('${rcEsc(r.file)}', this.dataset.t)" data-t="${rcEsc(r.title)}"
                  title="Yalnızca bu case'i yeniden koş (-g)">tekrar koş</button>
        </div>`).join('')}
        ${gercek.length > 8 ? `<div class="rc-res-more">+${gercek.length - 8} başarısız daha — Sonuçlar sekmesinde</div>` : ''}
      </div>` : ''}
      <div class="rc-res-act">
        <button onclick="document.querySelector('.tabs button[data-tab=cases]').click()">Sonuçlar</button>
        <button onclick="loadArtifacts()" title="Bu koşumun video/trace kayıtları">kayıtlar</button>
      </div>
    </div>`;
}

function rcSonucKapat() { RC.sonuc = null; rcRenderSonuc(); }

/** Başarısız case'i Jira bug formuna taşır (kart AÇMAZ — yazma tek yerden). */
function rcBugAc(v) {
  document.querySelector('.tabs button[data-tab=jira]').click();
  setTimeout(() => bugFromQueue({
    summary: `${v.file}: ${v.title}`.slice(0, 120),
    detail: [v.error, v.file ? `Spec: ${v.file}` : ''].filter(Boolean).join('\n'),
  }), 350);
}

function rcTekrarKos(file, title) { runCase(file, title, 1); }

/* ------------------------------------------------------------ 3) koşum tablosu */

function rcEslesir(run, specs) {
  const q = RC.q.trim().toLowerCase();
  if (q) {
    const havuz = `${run.label} ${run.id} ${run.group} ${specs.join(' ')}`.toLowerCase();
    if (!havuz.includes(q)) return false;
  }
  const kayitlar = RC.gecmis.get(run.id) ?? [];
  const son = kayitlar[0];
  if (RC.durum === 'basarisiz' && !(son?.counts?.failed)) return false;
  if (RC.durum === 'hic' && kayitlar.length) return false;
  if (RC.durum === 'mutasyon' && !rcRisk(run, specs).length) return false;
  return true;
}

/**
 * Düğme listesi yerine TABLO: ad · kapsam · son sonuç · süre · geçmiş · koş.
 * Her satırdaki bilgi zaten diskte duruyordu (günlük + case geçmişi + kapsam
 * ağacı); düğmenin üstünde yalnız etiket vardı ve "bu koşum ne zaman koştu,
 * geçti mi, ne kadar sürer" sorusu cevapsızdı.
 */
function rcRenderTablo() {
  const el = document.getElementById('runs');
  const meta = rcMeta();
  if (!el || !meta) return;

  const runs = (meta.runs ?? []).slice();
  const gruplar = new Map();
  for (const r of runs) {
    const specs = rcSpecsOf(r);
    if (!rcEslesir(r, specs)) continue;
    const g = r.group || 'Diger';
    if (!gruplar.has(g)) gruplar.set(g, []);
    gruplar.get(g).push({ r, specs });
  }

  if (!gruplar.size) {
    el.innerHTML = '<p class="mono rc-bos">Süzgece uyan koşum yok.</p>';
    return;
  }

  // Kapsam: hangi koşum hangi düğümleri/kartları kapsıyor (scope-client.js).
  const kapsamIdx = new Map();
  for (const x of window.SCOPE?.runs ?? []) if (x.runId) kapsamIdx.set(x.runId, x);

  el.innerHTML = [...gruplar.entries()].map(([g, liste]) => `
    <div class="rc-grp">
      <div class="rc-grp-h">${rcEsc(g)}<span class="cnt">${liste.length}</span></div>
      <div class="rc-tbl">
        ${liste.map(({ r, specs }) => rcSatir(r, specs, kapsamIdx.get(r.id))).join('')}
      </div>
    </div>`).join('');
  decorateTips(el);
}

function rcSatir(run, specs, kapsam) {
  const kayitlar = RC.gecmis.get(run.id) ?? [];
  const son = kayitlar[0];
  const kosuyor = RC.canli?.id === run.id;

  const sonuc = kosuyor ? '<span class="rc-now">koşuyor</span>'
    : !son ? '<span class="rc-none">hiç koşulmadı</span>'
      : !son.counts ? `<span class="rc-none" title="${rcEsc(son.note || '')}">sonuç yok</span>`
        : `<span class="${son.counts.failed ? 'no' : 'ok'}">${son.counts.passed}/${son.counts.total}</span>`;

  // Ortalama süre: son 5 ölçülü koşumdan. "Ne kadar sürer" sorusu düğmeye
  // basmadan önce sorulan bir soru.
  const sureler = kayitlar.filter((k) => k.durationMs).slice(0, 5).map((k) => k.durationMs);
  const ort = sureler.length ? Math.round(sureler.reduce((a, b) => a + b, 0) / sureler.length) : null;

  const riskler = rcRisk(run, specs).map((x) =>
    `<span class="rc-badge ${x.c}" title="${rcEsc(x.t)}">${rcEsc(x.k)}</span>`).join('');

  const kapsamHtml = kapsam?.nodes?.length
    ? `<a class="rc-scope" href="${scopeNodeUrl(kapsam.nodes[0].nodeId)}" title="${rcEsc(kapsam.nodes.map((n) => n.name).join(', '))}">
         <span class="sc-dot ${scopeStatusCls(kapsam.nodes[0].status)}"></span>${rcEsc(kapsam.nodes[0].name.slice(0, 22))}${kapsam.nodes.length > 1 ? ` +${kapsam.nodes.length - 1}` : ''}</a>`
    : '<span class="rc-none">—</span>';

  const etiket = rcHeadless() ? String(run.label).replace(/\(headed\)/i, '(headless)') : run.label;

  return `<div class="rc-row${kosuyor ? ' kosuyor' : ''}">
    <div class="rc-c-ad">
      <span class="rc-ad">${rcEsc(etiket)}</span>
      <span class="rc-specs">${rcEsc(specs.join(', ') || run.id)}</span>
    </div>
    <div class="rc-c-risk">${riskler}</div>
    <div class="rc-c-kapsam">${kapsamHtml}</div>
    <div class="rc-c-sonuc">${sonuc}<span class="rc-ne">${rcEsc(son ? rcNeZaman(son.startedAt) : '')}</span></div>
    <div class="rc-c-sure">${ort ? rcEsc('~' + rcSure(ort)) : ''}</div>
    <div class="rc-c-gecmis">${rcNoktalar(kayitlar)}</div>
    <div class="rc-c-act">
      <button data-run-id="${rcEsc(run.id)}" ${kosuyor ? 'disabled' : ''}
        onclick="startRun('${rcEsc(run.id)}')">${kosuyor ? '...' : 'koş'}</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- 5) filtre + klavye */

function rcRenderFiltre() {
  const el = document.getElementById('runFilter');
  if (!el) return;
  const secenek = [['hepsi', 'Tümü'], ['basarisiz', 'Son koşumu düşen'], ['hic', 'Hiç koşulmamış'], ['mutasyon', 'Riskli']];
  el.innerHTML = `
    <input id="rcQ" class="rc-q" type="search" placeholder="Koşum, spec ya da grup ara...  ( / )" value="${rcEsc(RC.q)}">
    <span class="rc-pills">${secenek.map(([v, t]) =>
      `<button class="rc-pill${RC.durum === v ? ' active' : ''}" onclick="rcDurum('${v}')">${t}</button>`).join('')}</span>
`;
  const q = document.getElementById('rcQ');
  q.addEventListener('input', () => {
    RC.q = q.value;
    const k = q.selectionStart;
    rcRenderTablo();
    // Tablo yeniden çizildi, kutu aynı kaldı; odak korunuyor.
    q.focus();
    try { q.setSelectionRange(k, k); } catch { /* search alaninda desteklenmeyebilir */ }
  });
}

function rcDurum(v) { RC.durum = v; rcRenderFiltre(); rcRenderTablo(); }

/** `/` filtreye odaklanır — uzun listede fare gezdirmeden aramak için. */
addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
  const tab = document.getElementById('tab-runs');
  if (!tab || tab.hidden) return;
  e.preventDefault();
  document.getElementById('rcQ')?.focus();
});

/* ------------------------------------------------------------------ dış yüzey */

/** Günlüğü tazeler ve tabloyu çizer. Sekme açılışında ve koşum bitince çağrılır. */
async function rcYenile() {
  try {
    const d = await (await fetch('/api/runs/history?limit=200')).json();
    RC.gecmis = rcGecmisKur(d.runs ?? []);
  } catch { /* gunluk okunamadi: tablo kayitsiz cizilir */ }
  rcRenderFiltre();
  rcRenderTablo();
  rcRenderQueue();
}

/** SSE köprüleri — index.html'deki tek EventSource buradan besliyor. */
function rcRunStart(d) {
  RC.canli = { id: d.id, label: d.label, startedAt: Date.parse(d.startedAt) || Date.now(), gecti: 0, kaldi: 0, satir: '' };
  RC.sonuc = null;
  rcRenderSonuc();
  rcRenderLive();
  rcSayacBasla();
  rcRenderTablo();
}

function rcRunLog(line) { rcLogSatiri(line); }

function rcRunEnd(d) {
  const label = RC.canli?.label ?? d.id ?? '';
  RC.canli = null;
  rcSayacDurdur();
  rcRenderLive();
  RC.sonuc = { label, code: d.code, durationMs: d.durationMs };
  rcRenderSonuc();
  rcYenile();
  // Kosumlar sekmesi = paketler; satirdaki "son kosum" ve noktalar tazelensin.
  if (typeof renderScopePackages === 'function') renderScopePackages();
}
