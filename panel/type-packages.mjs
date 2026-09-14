/**
 * Tür paketleri — kullanıcının isimlendirdiği TEST TÜRÜ kombinasyonları.
 *
 * ⚠️ "Paketler"den (panel/packages.mjs) FARKLI bir şey, ikisi karıştırılmasın:
 *   Paketler   = var olan test CASE'lerinin koşulabilir koleksiyonu
 *                ({nodeId, testCaseId} referansları, Test Suite sidebar grubu)
 *   Tür paketi = case ÜRETİLİRKEN seçilen test TÜRÜ kombinasyonu (bu dosya)
 * Biri üretimin girdisi, diğeri üretimin çıktısının gruplanması.
 *
 * Flowscope'un drawer'ındaki "Test Türleri (birden fazla seçilebilir)" listesi
 * kodda sabit (Happy Path · Negatif · Sınır Değerler · …). Sorun türlerin
 * kendisi değildi: aynı kombinasyonu her düğümde ELDEN yeniden seçmek gerekiyordu
 * ("regresyon için şu üçü", "yeni sayfada şu beşi"). Bu dosya o kombinasyonu
 * bir isimle saklıyor; drawer'da tek tık uygulanıyor.
 *
 * Desen `jira-sorters.mjs` ile AYNI ve bilinçli olarak öyle: aynı depo biçimi,
 * aynı "tohumlama yok" kuralı, aynı id üretimi. İkinci bir kalıcılık deseni
 * icat etmek, aynı hataların ikinci kez yapılması demek olurdu.
 *
 * TOHUMLAMA YOK: dosya yoksa liste boştur. Hazır paket koymak, kullanıcının
 * kendi paketiyle bizim varsayımımızı karıştırırdı.
 *
 * ⚠️ Türlerin kendisi DOĞRULANMAZ (sabit listeye karşı kontrol edilmez):
 * drawer'daki tür listesi değişebilir ve eski bir paket yüzünden kayıt
 * reddedilirse kullanıcı sebebini anlamaz. Uygulama anında bilinmeyen tür
 * sessizce atlanır (arayüz tarafı).
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "panel-data", "type-packages.json");
const MAX_TYPES = 20;

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

/** En yeni eklenen en üstte (sorter listesiyle aynı sıra kuralı). */
export function listPackages() {
  return read().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function nextId(list) {
  let max = 0;
  for (const p of list) {
    const m = /^tp(\d+)$/.exec(p.id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `tp${max + 1}`;
}

/**
 * Ekler ya da günceller. `id` verilmişse ve kayıt varsa günceller.
 *
 * Aynı isim iki kez kaydedilemez (büyük/küçük harf duyarsız): paket listesi
 * tek tıklık bir seçici, iki "Regresyon" satırı hangisinin hangisi olduğunu
 * sormaya zorlar.
 *
 * @param {{id?: string, label: string, types: string[], limit?: number}} p
 */
export function savePackage({ id, label, types, limit } = {}) {
  const ad = String(label ?? "").trim();
  if (!ad) throw new Error("İsim boş olamaz");
  if (ad.length > 60) throw new Error("İsim en fazla 60 karakter olabilir");

  const turler = [...new Set((Array.isArray(types) ? types : []).map((t) => String(t).trim()).filter(Boolean))];
  if (!turler.length) throw new Error("En az bir test türü seçilmeli");
  if (turler.length > MAX_TYPES) throw new Error(`En fazla ${MAX_TYPES} tür olabilir`);

  // Düğüm başına case üst sınırı: paketin bir parçası (bkz. testcase-gen limit).
  const adet = limit == null ? null : Math.min(Math.max(Number(limit) || 0, 1), 10);

  const list = read();
  const cakisma = list.find((p) => p.label.trim().toLowerCase() === ad.toLowerCase() && p.id !== id);
  if (cakisma) throw new Error(`"${ad}" adında bir paket zaten var`);

  const now = new Date().toISOString();
  const mevcut = id ? list.find((p) => p.id === id) : null;
  if (id && !mevcut) throw new Error(`Paket bulunamadı: ${id}`);

  if (mevcut) {
    mevcut.label = ad;
    mevcut.types = turler;
    mevcut.limit = adet;
    mevcut.updatedAt = now;
  } else {
    list.push({ id: nextId(list), label: ad, types: turler, limit: adet, createdAt: now, updatedAt: now });
  }
  write(list);
  return mevcut ?? list[list.length - 1];
}

export function deletePackage(id) {
  const key = String(id ?? "").trim();
  if (!key) throw new Error("id zorunlu");
  const list = read();
  const kalan = list.filter((p) => p.id !== key);
  if (kalan.length === list.length) throw new Error(`Paket bulunamadı: ${key}`);
  write(kalan);
  return { deleted: key };
}
