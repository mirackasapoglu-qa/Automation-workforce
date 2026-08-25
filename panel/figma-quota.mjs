/**
 * Figma REST kota durumu — gözlenen gerçeklikten okunur, yoklamayla değil.
 *
 * MEKANİZMA (Figma dokümanı + 24 Ağustos ölçümü): kullandığımız üç uç
 * (`GET /v1/files`, `/v1/files/:key/nodes`, `/v1/images`) hepsi **Tier 1** ve
 * **TEK SAYAÇ** paylaşıyor. Limit koltuk tipine bağlı: View/Collab **6/ay**,
 * Dev/Full **10-20/dk**. Ve limit **istek sayısı** — 7,2 MB'lık çağrı da
 * 33 KB'lık çağrı da 1 istek.
 *
 * NEDEN NOT TUTUYORUZ: `preflight.mjs` eskiden `/v1/images`i canlı yokluyordu ve
 * "kota açık" diyordu; aynı anda `/v1/files` 372.976 sn (4,3 gün) retry-after ile
 * blokeydi. İki sorun birden: (a) yoklama yanlış ucu ölçüyordu, (b) View seat'te
 * yoklamanın kendisi ayda 6 isteğin içinden yiyordu — kotayı ölçmek için kotayı
 * harcamak. Panel yeşil görünüyordu, ilk gerçek diff çağrısı anında patladı.
 *
 * ÇÖZÜM: hiç yoklama yok. Gerçek çağrı yapan her yer (figma-diff, figma-render,
 * figma-prewarm) sonucu buraya not bırakır: 429 gördüyse `noteBlocked`, 200
 * aldıysa `noteOk`. Preflight nottan okur — bedeli sıfır, gecikmesi sıfır.
 *
 * Uçlar tek sayaç paylaşsa da ayrı ayrı not ediliyor: hangi ucun en son ne
 * gördüğü teşhis için değerli (`/files` metin+spec, `/images` render besliyor).
 *
 * Not dosyası elle de düzenlenebilir (`panel-data/quota-notes.json`) — MCP
 * kotası zaten öyle tutuluyor.
 */
import fs from "node:fs";
import path from "node:path";

const NOTES_FILE = path.join(process.cwd(), "panel-data", "quota-notes.json");

/** Kova adları not dosyasındaki anahtarlar; yeni uç eklenirse buraya eklenir. */
const NOTE_KEY = { files: "figmaRestFiles", images: "figmaRestImages" };

const readNotes = () => {
  try {
    return JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
  } catch {
    return {};
  }
};

function writeNote(bucket, value) {
  const key = NOTE_KEY[bucket];
  if (!key) return;
  try {
    const all = readNotes();
    all[key] = value;
    fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
    fs.writeFileSync(NOTES_FILE, JSON.stringify(all, null, 1));
  } catch { /* yazilamazsa cagri akisini bozma */ }
}

/** URL veya yol parçasından hangi kova olduğunu çıkarır. */
export function bucketOf(pathOrUrl = "") {
  if (/\/v1\/files\//.test(pathOrUrl)) return "files";
  if (/\/v1\/images\//.test(pathOrUrl)) return "images";
  return null;
}

/**
 * 429 gözlendi. `retryAfterSec` yoksa blokaj bitişi bilinmiyor demektir —
 * "ne zaman açılıyor" sorusuna yanlış cevap vermek yerine null bırakılır.
 */
export function noteBlocked(bucket, retryAfterSec, source = null) {
  const s = Number(retryAfterSec) || 0;
  writeNote(bucket, {
    state: "blocked",
    seenAt: new Date().toISOString(),
    retryAfterSec: s || null,
    blockedUntil: s ? new Date(Date.now() + s * 1000).toISOString() : null,
    source,
  });
}

/** Başarılı çağrı gözlendi — kova o an açıktı. */
export function noteOk(bucket, source = null) {
  writeNote(bucket, { state: "ok", seenAt: new Date().toISOString(), source });
}

/** Çağrı sonucunu tek yerden not eder; `figma()` sarmalayıcılarında kullanılır. */
export function noteResponse(pathOrUrl, res, source = null) {
  const bucket = bucketOf(pathOrUrl);
  if (!bucket) return;
  if (res.status === 429) noteBlocked(bucket, res.headers.get("retry-after"), source);
  else if (res.ok) noteOk(bucket, source);
}

const fmtTR = (iso) =>
  new Date(iso).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Preflight satırı — API çağrısı YAPMAZ.
 *
 * Durumlar: hiç not yok → `unknown` (yalan söylemekten iyidir). Blokaj süresi
 * dolmuş → `unknown`, çünkü açıldığını ancak gerçek bir çağrı doğrular.
 */
export function quotaCheck(bucket, { key, label }) {
  const n = readNotes()[NOTE_KEY[bucket]];
  if (!n) return { key, label, state: "unknown", detail: "not yok — henüz çağrı yapılmadı" };

  if (n.state === "blocked") {
    const until = n.blockedUntil ? new Date(n.blockedUntil).getTime() : null;
    if (until && Date.now() < until) {
      const h = (until - Date.now()) / 3600e3;
      return {
        key, label, state: "blocked",
        detail: `429 — ${h < 24 ? `${h.toFixed(1)} saat` : `${(h / 24).toFixed(1)} gün`} kaldı ` +
          `(~${fmtTR(n.blockedUntil)})${n.source ? ` · ${n.source}` : ""}`,
        hoursLeft: Number(h.toFixed(1)),
        blockedUntil: n.blockedUntil,
      };
    }
    return {
      key, label, state: "unknown",
      detail: until
        ? `blokaj süresi doldu (${fmtTR(n.blockedUntil)}) — açıldığı teyit edilmedi`
        : `429 görüldü (${fmtTR(n.seenAt)}), retry-after yok — süre bilinmiyor`,
    };
  }

  const ageH = (Date.now() - new Date(n.seenAt).getTime()) / 3600e3;
  return {
    key, label, state: "ok",
    detail: `son başarılı çağrı ${ageH < 1 ? `${Math.round(ageH * 60)} dk` : `${ageH.toFixed(1)} saat`} önce`,
  };
}
