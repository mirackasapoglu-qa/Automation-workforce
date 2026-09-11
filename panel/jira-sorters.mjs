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
 * JQL'in gerçekten çalıştığı `testJql()` ile (bkz. jira.mjs) ayrı doğrulanmış
 * olmalı — bu fonksiyon JQL'i BİLEREK bir daha Jira'ya sormuyor, sadece
 * yazıyor; çağıran taraf (server.mjs) sırayı garanti eder.
 */
export function saveSorter({ id, label, jql }) {
  const cleanLabel = String(label ?? "").trim();
  const cleanJql = String(jql ?? "").trim();
  if (!cleanLabel) throw new Error("İsim boş olamaz");
  if (!cleanJql) throw new Error("JQL boş olamaz");

  const list = read();
  if (id) {
    const found = list.find((s) => s.id === id);
    if (!found) throw new Error(`Sorter bulunamadı: ${id}`);
    found.label = cleanLabel;
    found.jql = cleanJql;
    write(list);
    return found;
  }
  const record = { id: nextId(list), label: cleanLabel, jql: cleanJql, createdAt: new Date().toISOString() };
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
