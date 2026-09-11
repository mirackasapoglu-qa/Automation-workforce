/**
 * Tarama kapısı — `/api/crawl` hedefini ve hızını denetler; süreç başlatmaz.
 *
 * NEDEN AYRI DOSYA: landing'deki "URL'i gir, tarama hemen başlasın" kutusu
 * taramayı herkese açık bir sayfadan tek adımda tetiklenebilir kıldı. Sunucu
 * tarafında bir Playwright tarayıcısı verilen adrese gidiyor; bu üç riski
 * kapatmadan o kutu açılamaz:
 *
 *   1. SSRF — `http://127.0.0.1:4646/api/...`, `http://169.254.169.254/`
 *      (bulut metadata), `http://10.0.0.5/` gibi iç adresler. Alan adı üzerinden
 *      de gelebilir (DNS iç IP'ye çözülür), o yüzden DNS çözümü de denetlenir.
 *   2. Şema — `file:///etc/passwd`, `javascript:` vb. Yalnızca http/https.
 *   3. Sel — aynı istemcinin art arda onlarca tarama açması. Kayan pencere.
 *
 * İstisna: projenin KENDİ host'u (BASE_URL) ve `allowPrivate` (lokalde panel
 * zaten yalnızca localhost'ta dinliyor, kişi kendi makinesindeki uygulamayı
 * taramak ister). Sunucuda `allowPrivate` kapalıdır.
 *
 * Koşum: node --test panel/crawl-guard.test.mjs
 */
import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".arpa"];

/** IPv4 adresi özel/yerel/rezerve mi (RFC1918, loopback, link-local, metadata, CGNAT, 0.0.0.0/8, çoklu yayın…). */
function isPrivateV4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;            // 0/8, 10/8, loopback
  if (a === 169 && b === 254) return true;                       // link-local + bulut metadata
  if (a === 172 && b >= 16 && b <= 31) return true;              // 172.16/12
  if (a === 192 && b === 168) return true;                       // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;             // 100.64/10 (CGNAT)
  if (a === 192 && b === 0 && p[2] === 0) return true;           // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;          // benchmark
  if (a >= 224) return true;                                     // multicast + rezerve + broadcast
  return false;
}

/** IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10), IPv4-eşlenmiş (::ffff:a.b.c.d) → v4 kuralı. */
function isPrivateV6(ip) {
  const low = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (low === "::" || low === "::1") return true;
  const mapped = low.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  // URL ayrıştırıcı eşlenmiş adresi onaltılık yazar: ::ffff:7f00:1 → 127.0.0.1
  const hexMapped = low.match(/^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16), lo = parseInt(hexMapped[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(low)) return true;               // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(low)) return true;               // fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(low)) return true;                  // multicast
  return false;
}

export function isPrivateAddress(ip) {
  const v = net.isIP(String(ip).replace(/^\[|\]$/g, ""));
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // IP değilse güvenli tarafta kal
}

function isBlockedHostname(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (!h.includes(".")) return true; // tek etiketli ad (intranet kısayolu) — dışarıda böyle site yok
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

function sameHost(a, b) {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

/**
 * Hedef URL'i denetler.
 * @returns {Promise<{ok: true, url: string} | {ok: false, error: string}>}
 */
export async function validateTarget(raw, { projectBaseUrl = "", allowPrivate = false, lookup = dns.lookup } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "url gerekli." };
  if (text.length > 2048) return { ok: false, error: "URL çok uzun." };

  let u;
  try { u = new URL(text); } catch { return { ok: false, error: "Geçerli bir adres değil. Örnek: https://siten.com" }; }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Yalnızca http:// ve https:// adresler taranabilir." };
  }
  if (u.username || u.password) {
    return { ok: false, error: "Adreste kullanıcı adı/şifre olamaz. Giriş gerekiyorsa 'giriş yapmam gerekiyor' kutusunu kullan." };
  }

  // Projenin kendi host'u: lokal/iç adres olsa da serbest (staging çoğu zaman iç ağda).
  if (projectBaseUrl && sameHost(u.href, projectBaseUrl)) return { ok: true, url: u.href };
  if (allowPrivate) return { ok: true, url: u.href };

  const host = u.hostname;
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
    if (isPrivateAddress(host)) return { ok: false, error: "İç ağ / yerel adresler bu sunucudan taranamaz." };
    return { ok: true, url: u.href };
  }
  if (isBlockedHostname(host)) return { ok: false, error: "İç ağ / yerel adresler bu sunucudan taranamaz." };

  let addrs;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: `Alan adı çözümlenemedi: ${host}` };
  }
  if (!addrs?.length) return { ok: false, error: `Alan adı çözümlenemedi: ${host}` };
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    return { ok: false, error: "Bu alan adı iç ağ adresine çözülüyor; bu sunucudan taranamaz." };
  }
  return { ok: true, url: u.href };
}

/**
 * Kayan pencere hız sınırı: istemci başına `limit` / `windowMs`.
 * Bellekte; süreç yeniden başlarsa sıfırlanır (kabul edilebilir — sınır sel önleme için, kota için değil).
 */
export function createRateLimiter({ limit = 6, windowMs = 10 * 60_000, now = Date.now } = {}) {
  const hits = new Map(); // key → [ts, ts, …]
  function sweep(t) {
    for (const [k, arr] of hits) {
      const kept = arr.filter((ts) => t - ts < windowMs);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }
  return {
    /** @returns {{ok: true} | {ok: false, retryAfterSec: number}} */
    take(key) {
      const t = now();
      if (hits.size > 5000) sweep(t);
      const arr = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (arr.length >= limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
      }
      arr.push(t);
      hits.set(key, arr);
      return { ok: true };
    },
    size: () => hits.size,
  };
}

/**
 * İstemci anahtarı: ters vekil arkasında `x-forwarded-for`'un İLK adresi,
 * yoksa soket adresi. Sahte XFF sınırı yalnızca kendi aleyhine bozabilir
 * (kendini başka bir kovaya koyar); toplam eşzamanlılık sınırı ayrıca var.
 */
export function clientKey(req) {
  const xff = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req?.socket?.remoteAddress || "unknown";
}
