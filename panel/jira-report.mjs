/**
 * Jira yorum TASLAKLARI — koşum sonucundan ve verdict kaydından.
 *
 * ⚠️ BU MODÜL JIRA'YA YAZMAZ. Yalnızca metin üretir; gönderme tek bir yerden,
 * `/api/jira/comment` ucundan ve kullanıcı onayıyla oluyor. Taslak üretimini
 * göndermeden ayırmanın sebebi: yorum kalıcı ve geri alınamaz bir iz, koşum
 * biter bitmez otomatik yazmak yanlış koşumun sonucunu kartın altına
 * çakabilirdi (ortam yanlış, kapı oturumu dolmuş, filtre yanlış...).
 *
 * Metinler DÜZ METİN döner; `jira.mjs → textToAdf()` ADF'ye çeviriyor.
 */

/**
 * Satırları birleştirir. `null`/`undefined` atılır ama BOŞ STRING KALIR —
 * `filter(Boolean)` kullanmak paragraf aralarını da siliyordu, yorum tek blok
 * hâlinde okunmaz çıkıyordu (ölçüldü).
 */
function head(lines) {
  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}

const stamp = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");

/**
 * Koşum sonucundan yorum taslağı.
 *
 * Sonuç satırları kartın SPEC'LERİNE göre süzülüyor: son koşum tüm suite'i
 * kapsıyor olabilir ve kartla ilgisi olmayan 70 satırı kartın altına yazmak
 * yorumu okunamaz yapıyor. Süzgeç sonucu boşsa bunu SÖYLÜYOR — sessizce boş
 * yorum üretmek "test edildi" izlenimi verirdi.
 *
 * @param {{key:string, specs:string[], results:object, env:string, baseURL:string}} arg
 */
export function runCommentDraft({ key, specs = [], results, env, baseURL }) {
  if (!results || !Array.isArray(results.rows) || !results.rows.length) {
    const e = new Error(
      "Son koşum sonucu yok (test-results/results.json). Önce bir koşum tetikle.",
    );
    e.code = "NO_RESULTS";
    throw e;
  }

  const scoped = specs.length
    ? results.rows.filter((r) => specs.includes(r.file))
    : results.rows;

  const count = (st) => scoped.filter((r) => r.status === st).length;
  const passed = count("passed");
  const failed = scoped.filter(
    (r) => r.status === "failed" || r.status === "timedOut",
  );
  const skipped = count("skipped");

  const lines = [
    `${key} — panel koşumu`,
    "",
    `Ortam: ${env ?? "—"} · ${baseURL ?? "—"}`,
    `Koşum: ${stamp(results.startedAt)}`,
    specs.length
      ? `Kartın spec'leri: ${specs.join(", ")}`
      : "Kart eşlemesi yok — son koşumun TAMAMI raporlanıyor.",
    "",
    `Sonuç: ${passed} geçti · ${failed.length} başarısız · ${skipped} atlandı (${scoped.length} test)`,
  ];

  if (specs.length && !scoped.length) {
    lines.push(
      "",
      "⚠️ Son koşumda bu kartın spec'lerinden hiç test yok — muhtemelen başka bir grup koşuldu.",
      "Yorumu göndermeden önce kartın testlerini koş.",
    );
    return head(lines);
  }

  if (failed.length) {
    lines.push("", "Başarısız:");
    for (const r of failed.slice(0, 12)) {
      lines.push(`- ${r.file} › ${r.title}`);
      if (r.error) {
        // Hata gövdesi 4 satıra kadar geliyor; yorumu şişirmemek için ilk satır.
        lines.push(`  ${String(r.error).split("\n")[0].slice(0, 220)}`);
      }
    }
    if (failed.length > 12)
      lines.push(`- … ve ${failed.length - 12} başarısız test daha`);
  } else {
    lines.push("", "Başarısız test yok.");
  }

  return head(lines);
}

/**
 * Verdict kaydından yorum taslağı.
 *
 * Verdict, otomatik koşumun söyleyemediği kararı taşıyor (özellikle `blocked`
 * ve `known-issue`); bu yüzden ortam ve baseURL kayıttan geliyor — kararın
 * hangi ortamda verildiği yorumun içinde kalsın.
 */
export function verdictCommentDraft(v) {
  if (!v) {
    const e = new Error("Verdict kaydı bulunamadı.");
    e.code = "NO_VERDICT";
    throw e;
  }
  const DURUM = {
    pass: "PASS — doğrulandı",
    fail: "FAIL — hata var",
    blocked: "BLOCKED — test edilemedi",
    "known-issue": "KNOWN ISSUE — bilinen hata",
  };
  return head([
    `QA kararı: ${DURUM[v.status] ?? v.status ?? "—"}`,
    "",
    `Kapsam: ${v.scope || "—"}`,
    `Ortam: ${v.env ?? "—"} · ${v.baseURL ?? "—"}`,
    `Kayıt: ${v.key} · güncelleme ${stamp(v.updatedAt)}`,
    v.note ? "" : null,
    v.note ? v.note : null,
    v.evidence?.length ? "" : null,
    v.evidence?.length
      ? `Kanıt (${v.evidence.length}): ${v.evidence.join(", ")}`
      : null,
  ]);
}
