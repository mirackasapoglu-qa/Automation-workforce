/**
 * Bilinen ürün hataları — `tests/known-issues.ts`'i ayrıştırır.
 *
 * NEDEN AYRI MODÜL (2026-09-16): ayrıştırıcı önceden yalnızca server.mjs
 * içindeydi (panelin "Açık Bulgular" listesi için). Test case üretimi de AYNI
 * veriye ihtiyaç duyunca (bkz. testcase-gen.mjs → regresyon türü, bir düğüme
 * bağlı bilinen hatayı görüp tekrar "keşfetmesin" diye) ikinci bir kopya
 * yazmak yerine tek kaynağa çıkarıldı.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * `text[quoteStart]`'ten başlayan bir JS string literalini (tek ya da çift
 * tırnak, ters eğik çizgiyle kaçışlı tırnaklara saygılı) okur.
 *
 * ESKİ regex'in (`"([^"]+)"`) anlamadığı şey kaçış: bir `detail` metninde
 * `\"` geçince (ör. `pageerror: \"...\"`) `[^"]+` kaçışlı tırnağın KENDİSİNDE
 * duruyordu — metin yanlış yerden kesiliyordu (ölçüldü: <önek>-010). Değer tek
 * tırnakla yazılmışsa (içinde kaçışsız `"` geçtiği için, ör. <önek>-001) durum
 * daha kötüydü: `detail:\s*"` deseni HİÇ eşleşmiyor, arayış bir SONRAKİ
 * kaydın `detail:"..."`ına kadar sürüklenip onu bu kayda mal ediyordu —
 * sonraki kayıt (<önek>-002/<önek>-005) TAMAMEN kayboluyordu. İkisi de bu
 * fonksiyonun kaçış-duyarlı, tek karakter karakter okumasıyla düzeldi.
 */
function readStringLiteral(text, quoteStart) {
  const quote = text[quoteStart];
  if (quote !== '"' && quote !== "'") return null;
  let out = "";
  for (let i = quoteStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { out += text[i + 1] ?? ""; i++; continue; }
    if (ch === quote) return out;
    out += ch;
  }
  return null; // kapanis tirnagi yok — bozuk dosya, alan bos donsun
}

/** `field: "..."` ya da `field: '...'`ı bir blok icinde bulup degerini okur. */
function extractField(block, field) {
  const m = new RegExp(`${field}:\\s*\\n?\\s*(["'])`).exec(block);
  if (!m) return null;
  return readStringLiteral(block, m.index + m[0].length - 1);
}

/**
 * Tüm bilinen hata kayıtlarını döner.
 *
 * Her kaydın SINIRI kendi `id:"..."` alanı — bir SONRAKİ `id:"..."`
 * başlayana kadarki metin o kaydın bloğu sayılır. Böylece bir kaydın
 * içindeki tırnak/kaçış çeşitliliği ne olursa olsun kayıtlar BİRBİRİNE
 * KARIŞAMAZ (eski regex'in asıl hatası tam buydu: tek bir eşleşme birden
 * fazla kaydın alanlarını birbirine bağlayabiliyordu).
 */
export function knownIssues(filePath = path.join(process.cwd(), "tests", "known-issues.ts")) {
  const f = filePath;
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, "utf8");

  const idMatches = [...src.matchAll(/id:\s*"([^"]+)"/g)];
  const out = [];
  for (let i = 0; i < idMatches.length; i++) {
    const m = idMatches[i];
    const blockEnd = idMatches[i + 1]?.index ?? src.length;
    const block = src.slice(m.index, blockEnd);
    out.push({
      id: m[1],
      where: extractField(block, "where") ?? "",
      detail: extractField(block, "detail") ?? "",
      nodeId: extractField(block, "nodeId"),
    });
  }
  return out;
}

/** Belirli bir kapsam-ağacı düğümüne bağlı bilinen hataları döner. */
export function knownIssuesForNode(nodeId, filePath) {
  if (!nodeId) return [];
  return knownIssues(filePath).filter((k) => k.nodeId === nodeId);
}
