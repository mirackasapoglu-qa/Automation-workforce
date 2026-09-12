/**
 * Kullanıcının panelden eklediği özel Jira sorter'ları (isim + JQL çifti).
 *
 * Profildeki eski sabit görünümler (Test kolonu, Bloklu, Tüm epic, Bug'lar)
 * 2026-09-11'de TAMAMEN kaldırıldı — kodda STATİK hiçbir sorter tanımı yok
 * artık (bkz. CLAUDE.md → "Jira: Sorter"). Tek sabit seçenek "Tümü"
 * (`panel/jira.mjs → ALL_SORTER`, doğrudan bağlı projeden türetilir); bunun
 * dışındaki HER sorter kullanıcının panelden eklediği, bu dosyada saklanan
 * bir kayıt.
 *
 * TOHUMLAMA YOK: dosya yoksa boş dizi demektir, profilden hiçbir şey
 * kopyalanmaz — kullanıcı ne eklerse liste o (bilinçli karar, bkz. sohbet
 * geçmişi: "default olarak tohumlanma olmasın").
 *
 * Kimlik/e-posta alanı YOK — bu panelin önünde henüz kullanıcı girişi yok,
 * sorter'lar bu paneli kullanan herkes için ortak/paylaşılan bir liste.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "panel-data", "jira-sorters.json");

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 1));
}

/** En yeni eklenen en üstte. */
export function listSorters() {
  return read().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function nextId(list) {
  let max = 0;
  for (const s of list) {
    const m = /^cs(\d+)$/.exec(s.id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `cs${max + 1}`;
}

/**
 * Ekle ya da güncelle. `id` verilmişse VE mevcutsa günceller, verilmemişse
 * (ya da bulunamazsa değil — o zaman hata) yeni kayıt açar. Kaydetmeden önce
 * sorgunun gerçekten çalıştığı ayrı doğrulanmış olmalı (JQL'de `testJql()`,
 * bkz. jira.mjs) — bu fonksiyon sorguyu BİR DAHA sormuyor, sadece yazıyor;
 * sırayı garanti etmek çağıran tarafın (server.mjs) işi.
 *
 * İKİ MOD: `mode:"raw"` (JQL gibi sağlayıcının kendi metin dilinde, bugün
 * yalnız Jira'da var) ve `mode:"filter"` (durum kategorisi/atanan/anahtar
 * listesi gibi genel alanlardan kurulu, HER sağlayıcının kendi diline
 * çevirebildiği ortak şekil — bkz. jira.mjs → filterToJql,
 * providers/linear.mjs → filterToLinearFilter). `provider` hangi sağlayıcı
 * için yazıldığını işaretler; yalnızca o sağlayıcı aktifken listede görünür
 * (bkz. server.mjs → sorters route'u). Eski kayıtlarda (2026-09-11'den önce)
 * `provider`/`mode` hiç yoktu — ikisi de eksikse "jira" + "raw" varsayılır,
 * hepsi zaten o zaman yalnızca Jira'yı biliyordu.
 */
export function saveSorter({ id, label, provider, mode, jql, filter }) {
  const cleanLabel = String(label ?? "").trim();
  if (!cleanLabel) throw new Error("İsim boş olamaz");
  const useProvider = String(provider || "jira");
  const useMode = mode === "filter" ? "filter" : "raw";

  let payload;
  if (useMode === "raw") {
    const cleanJql = String(jql ?? "").trim();
    if (!cleanJql) throw new Error("JQL boş olamaz");
    payload = { provider: useProvider, mode: "raw", jql: cleanJql };
  } else {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error("filtre boş olamaz");
    payload = { provider: useProvider, mode: "filter", filter };
  }

  const list = read();
  if (id) {
    const found = list.find((s) => s.id === id);
    if (!found) throw new Error(`Sorter bulunamadı: ${id}`);
    Object.assign(found, { label: cleanLabel, ...payload });
    write(list);
    return found;
  }
  const record = { id: nextId(list), label: cleanLabel, ...payload, createdAt: new Date().toISOString() };
  list.push(record);
  write(list);
  return record;
}

export function deleteSorter(id) {
  const list = read();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new Error(`Sorter bulunamadı: ${id}`);
  write(next);
  return { ok: true };
}
