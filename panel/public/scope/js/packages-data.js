// Paketler — VERİ katmanı. DOM'a hiç dokunmaz (document.* yok, renderContent()
// çağırmaz); sadece state.packages üzerinde CRUD + hesaplama + kalıcılık.
// Görünüm tarafı packages.js'te, gerçek koşumu tetikleyen motor packages-run.js'te.
//
// Paketler: kullanıcının test case'leri gruplamak için oluşturduğu adlandırılmış
// koleksiyonlar (ör. "Regresyon paketi", "Validasyon paketi"). tree.json'dan AYRI
// bir dosyada kalıcı (bkz. panel/packages.mjs) — bir paket ağacın kendisi değil,
// ona dair bir REFERANS listesidir. Bir referans iki türden biri olabilir:
//   - test case referansı: {nodeId, testCaseId}
//   - paket referansı:     {packageId} — "x paketi y'nin içinden çağrılabilir"
//
// Bir test case aynı anda birden çok pakette olabilir — pakete eklemek onu
// "taşımaz", sadece bir referans ekler (etiket gibi). Bağlı olduğu düğüm ya da
// test case'in kendisi silinirse referans sessizce TEMİZLENMEZ: "kaynağı
// silinmiş" olarak görünür kalır, kullanıcı isterse elle çıkarır — veri kaybını
// gizlemek yerine izlenebilir tutuyoruz (bkz. resolvePackageItem).
import { state, newPackageId } from './state.js';
import { findNode, debounce, setSaveState, effectiveTestCaseStatus } from './data.js';

export const nowIso = () => new Date().toISOString();

export async function loadPackages() {
  const res = await fetch('/api/scope/packages');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  state.packages = Array.isArray(data.packages) ? data.packages : [];
  fixPackageIdCounter(state.packages);
}

/**
 * `state.packageIdCounter` her sayfa yüklemesinde 1'den başlar (bkz. state.js) —
 * yüklenen paketlerin ID'lerinin ÖNÜNE geçmezse bir sonraki `newPackageId()`
 * zaten var olan bir ID'yle çakışır ve o paketin ÜZERİNE YAZAR (ölçüldü: bir
 * sayfa yenilemesinden sonra oluşturulan paket, aynı ID'yi taşıyan eski bir
 * paketi sessizce değiştirdi). `data.js → fixIdCounter`'ın aynısı, paketler için.
 */
function fixPackageIdCounter(packages) {
  packages.forEach((p) => {
    const num = parseInt(String(p.id).replace('pkg', ''), 10);
    if (!isNaN(num) && num >= state.packageIdCounter) state.packageIdCounter = num + 1;
  });
}

export function persistPackages() {
  // Yükleme başarısızsa YAZMA: sunucudaki gerçek listeyi boş/eksik bir kopyayla
  // ezmemek için (bkz. data.js → persist()'in aynı gerekçeli aynı deseni).
  if (state.packagesLoadFailed) return;
  fetch('/api/scope/packages', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-panel-token': window.PANEL_TOKEN ?? '' },
    body: JSON.stringify({ packages: state.packages }),
  })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      setSaveState(null);
    })
    .catch((e) => setSaveState(e.message));
}
const persistPackagesDebounced = debounce(persistPackages, 400);

/**
 * Ad denetimi — büyük/küçük harf ve baştaki/sondaki boşluk YOK sayılarak
 * karşılaştırılır ("Regresyon" ile "regresyon " aynı isim sayılır). `excludeId`
 * yeniden adlandırmada paketin KENDİSİYLE çakışmasını engellemek için —
 * verilmezse (oluşturma) tüm paketlere karşı kontrol edilir.
 * @returns {string|null} hata mesajı, geçerliyse null
 */
export function validatePackageName(name, excludeId) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Paket adı boş olamaz.';
  const norm = trimmed.toLowerCase();
  const dup = state.packages.some((p) => p.id !== excludeId && p.name.trim().toLowerCase() === norm);
  if (dup) return `"${trimmed}" isimli bir paket zaten var.`;
  return null;
}

export function createPackage(name) {
  const pkg = { id: newPackageId(), name: name.trim(), description: '', createdAt: nowIso(), updatedAt: nowIso(), items: [] };
  state.packages.push(pkg);
  persistPackages();
  return pkg;
}

export function deletePackage(id) {
  state.packages = state.packages.filter((p) => p.id !== id);
  persistPackages();
}

export function renamePackage(pkg, name) {
  pkg.name = name.trim();
  pkg.updatedAt = nowIso();
  persistPackagesDebounced();
}

export function setPackageDescription(pkg, description) {
  pkg.description = description;
  pkg.updatedAt = nowIso();
  persistPackagesDebounced();
}

export function addTestCaseToPackage(pkg, nodeId, testCaseId) {
  if (pkg.items.some((it) => it.nodeId === nodeId && it.testCaseId === testCaseId)) return;
  pkg.items.push({ nodeId, testCaseId });
  pkg.updatedAt = nowIso();
  persistPackages();
}

export function removeItemFromPackage(pkg, index) {
  pkg.items.splice(index, 1);
  pkg.updatedAt = nowIso();
  persistPackages();
}

/**
 * Bir paketi başka bir paketin İÇİNE referans olarak ekler ("x paketi y'nin
 * içinden çağrılabilir"). `canNestPackage` çevrimi (x zaten y'yi içeriyorsa
 * y'ye x eklenemez) engelliyor; arayüz zaten yalnızca geçerli adayları
 * listeliyor (bkz. packages.js → renderPackageDetail), buradaki kontrol
 * savunma amaçlı.
 */
export function addPackageToPackage(pkg, childPackageId) {
  if (pkg.items.some((it) => it.packageId === childPackageId)) return;
  if (!canNestPackage(pkg, childPackageId)) return;
  pkg.items.push({ packageId: childPackageId });
  pkg.updatedAt = nowIso();
  persistPackages();
}

/**
 * Bir paketi kopyalar — "geçen sprint'in regresyon paketini al, üstüne ekle"
 * gibi gerçek bir alışkanlık. Item referansları (test case ya da paket) aynen
 * kopyalanır (aynı hedeflere işaret eder, taşımaz); ad çakışmasın diye
 * "(kopya)", çakışırsa "(kopya 2)" şeklinde ilk BOŞ ismi bulur.
 */
export function clonePackage(pkg) {
  const base = `${pkg.name} (kopya)`;
  let name = base;
  let n = 2;
  while (validatePackageName(name, null)) { name = `${base} ${n}`; n += 1; }
  const clone = {
    id: newPackageId(), name, description: pkg.description, createdAt: nowIso(), updatedAt: nowIso(),
    items: pkg.items.map((it) => ({ ...it })),
  };
  state.packages.push(clone);
  persistPackages();
  return clone;
}

/** {node, testCase} çözer; kaynak silinmişse ilgili alan null döner (ghost satır). */
export function resolvePackageItem(item) {
  const node = findNode(state.tree, item.nodeId);
  const testCase = node ? node.testCases.find((tc) => tc.id === item.testCaseId) : null;
  return { node, testCase: testCase || null };
}

/** Ağaçtaki TÜM test case'leri düz bir listeye çıkarır — arama/seçim için. */
export function allTestCases(nodes, acc = []) {
  for (const n of nodes) {
    for (const tc of n.testCases) acc.push({ nodeId: n.id, nodeName: n.name, testCase: tc });
    allTestCases(n.children, acc);
  }
  return acc;
}

/** Bir item test case değil, başka bir pakete referans mı? (bkz. dosya başındaki not) */
export const isPackageRefItem = (item) => Boolean(item.packageId);

/**
 * Bir paketin İÇİNDEKİ paket referanslarını (doğrudan + iç içe, tekrar etmeden)
 * toplar — çevrim denetimi ("x, y'yi içeriyorsa y x'i içeremez") ve iç içe
 * paket ekleme adayı filtrelemesi için. `guard`, veride bir şekilde zaten
 * oluşmuş bir çevrim varsa sonsuz özyinelemeye düşmeyi engeller (savunma —
 * `canNestPackage` normalde çevrimi baştan engelliyor).
 */
function collectNestedPackageIds(pkgId, acc = new Set(), guard = new Set()) {
  if (guard.has(pkgId)) return acc;
  guard.add(pkgId);
  const pkg = state.packages.find((p) => p.id === pkgId);
  if (!pkg) return acc;
  pkg.items.filter(isPackageRefItem).forEach((it) => {
    if (!acc.has(it.packageId)) {
      acc.add(it.packageId);
      collectNestedPackageIds(it.packageId, acc, guard);
    }
  });
  return acc;
}

/** `childId`'yi `pkg`'e paket olarak eklemek çevrim oluşturur mu (kendine referans dahil)? */
export function canNestPackage(pkg, childId) {
  if (pkg.id === childId) return false;
  return !collectNestedPackageIds(childId).has(pkg.id);
}

/**
 * Paketin test case referanslarını, İÇERDİĞİ PAKETLERİ de katarak (özyinelemeli)
 * düz bir listeye çıkarır — "Paketi Çalıştır" (packages-run.js) ve durum özeti
 * (computePackageStats) bu düz listeyi kullanır; görüntülenen satır listesi
 * (packages.js → renderPackageDetail) BUNU kullanmaz, orada iç içe paket kendi
 * satırı olarak kalır. `visited` bir paketin kendi alt ağacında iki kez
 * sayılmasını (elmas şeklinde paylaşılan bir alt paket) önler — çevrimi değil,
 * ÇİFT SAYMAYI engeller.
 */
export function collectEffectiveTestCaseItems(pkg, visited = new Set()) {
  if (visited.has(pkg.id)) return [];
  visited = new Set(visited);
  visited.add(pkg.id);
  const out = [];
  pkg.items.forEach((item) => {
    if (isPackageRefItem(item)) {
      const child = state.packages.find((p) => p.id === item.packageId);
      if (child) out.push(...collectEffectiveTestCaseItems(child, visited));
      // child yoksa (silinmiş) sessizce atlanır — ghost gösterimi satır listesinde ayrı ele alınıyor.
    } else {
      out.push(item);
    }
  });
  return out;
}

/**
 * Paketin doğrudan VE iç içe (özyinelemeli) paket referanslarındaki kırık
 * (kaynağı silinmiş) olanları sayar — bkz. computePackageStats'taki not.
 * `visited` bir alt paketin iki farklı daldan iki kez sayılmasını önler
 * (aynı gerekçeyle collectEffectiveTestCaseItems'daki gibi, çevrim değil
 * çift-sayım riskine karşı — çevrim zaten canNestPackage ile engelleniyor).
 */
function countBrokenPackageRefs(pkg, visited = new Set()) {
  if (visited.has(pkg.id)) return 0;
  visited = new Set(visited);
  visited.add(pkg.id);
  let count = 0;
  pkg.items.filter(isPackageRefItem).forEach((item) => {
    const child = state.packages.find((p) => p.id === item.packageId);
    if (!child) { count += 1; return; }
    count += countBrokenPackageRefs(child, visited);
  });
  return count;
}

/** Aynı test case birden fazla yoldan (iki farklı iç içe paketten) gelirse tekilleştirir. */
export function dedupeTestCaseItems(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.nodeId}:${it.testCaseId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Paketin GERÇEK kapsamı üzerinden durum dağılımı — içerdiği paketler dahil
 * (kaynağı silinmişler, hem tekil test case hem eksik iç içe paket için, ayrı
 * sayılır). Kart ve detay başlığındaki özet bu fonksiyonu kullanır.
 */
export function computePackageStats(pkg) {
  const stats = { '✅': 0, '🔵': 0, '⚠️': 0, '❌': 0, '⬜': 0, total: 0, ghosts: 0 };
  // Yalnızca pkg'nin KENDİ doğrudan paket referanslarına bakmak yetmiyor —
  // A, B'yi içeriyor ve B'nin İÇİNDEKİ C referansı kırılmışsa (C silinmiş),
  // bu A'dan da özyinelemeli olarak görünmeli. Aksi hâlde A "her şey yolunda"
  // gösterirken B'yi açan biri "1 kaynağı silinmiş" görüyordu — aynı gerçeği
  // iki farklı sayfa iki farklı şekilde anlatıyordu (ölçüldü, gerçek bir hata).
  stats.ghosts += countBrokenPackageRefs(pkg);
  dedupeTestCaseItems(collectEffectiveTestCaseItems(pkg)).forEach((item) => {
    const { node, testCase } = resolvePackageItem(item);
    if (!node || !testCase) { stats.ghosts += 1; return; }
    stats.total += 1;
    const s = effectiveTestCaseStatus(testCase);
    if (stats[s] !== undefined) stats[s] += 1;
  });
  return stats;
}

const PACKAGE_RUN_HISTORY_KEEP = 20;

/**
 * Bir "Paketi Çalıştır" koşumunun sonucunu pakete KALICI olarak yazar. Öncesinde
 * sonuç yalnızca geçici bir toast'ta gösteriliyordu — sayfadan ayrılınca ya da
 * panel yenilenince "en son ne olmuştu" sorusunun cevabı kayboluyordu.
 * `case-history.json`'daki HISTORY_KEEP deseniyle aynı: en yeni koşum başta,
 * son N koşum saklanır.
 */
export function recordPackageRun(pkg, run) {
  pkg.runs = pkg.runs || [];
  pkg.runs.unshift(run);
  if (pkg.runs.length > PACKAGE_RUN_HISTORY_KEEP) pkg.runs.length = PACKAGE_RUN_HISTORY_KEEP;
  pkg.updatedAt = run.at;
  persistPackages();
}
