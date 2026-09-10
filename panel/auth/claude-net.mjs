/**
 * "Panelden giriş" için ağ erişilebilirliği — görünmez takılmanın teşhisi.
 *
 * NEDEN: relay'de kod gönderildikten sonra CLI ekrana HİÇBİR ŞEY basmadan
 * takılabiliyor (ölçüldü 2026-09-10, sunucuda: kod gönderildi, 60 sn boyunca
 * tek bayt çıkmadı). Bu durumda ekran metni yok, hata kodu yok, kullanıcıya
 * söylenecek bir şey yok. Sebebi genelde tek şey oluyor: sürecin token
 * değişimi için gittiği adrese ULAŞAMAMASI (kurumsal çıkış filtresi, DNS,
 * vekil). Bunu panelden ölçüp hata mesajına koyuyoruz.
 *
 * Adresler CLI'nin kendi binary'sinden çıkarıldı (2.1.267):
 *   giriş sayfası   https://claude.com/cai/oauth/authorize
 *   token değişimi  https://platform.claude.com/v1/oauth/token
 *
 * ⚠️ Kimlik göndermez, gövde göndermez: yalnız TCP+TLS+HTTP kuruluyor mu ona
 * bakar. HERHANGİ bir HTTP yanıtı (405/404/400 dahil) "ulaşıldı" demektir —
 * bu yüzden durum kodu başarı ölçütü DEĞİL, yalnız kanıt olarak yazılır.
 *
 * ⚠️ "Node ulaşıyor" ≠ "CLI ulaşıyor". Claude Code CLI **bun ile derlenmiş**
 * tek parça bir binary; ağ yığını Node'unkiyle AYNI DEĞİL. İki ölçülebilir
 * fark var ve ikisi de tam olarak "istek sessizce takılır" belirtisi verir:
 *   1) IPv6: Node 20+ `autoSelectFamily` ile IPv4'e ~250 ms'de düşer, bun
 *      düşmez — container'ın IPv6 yolu kara delikse Node çalışır, CLI asılır.
 *   2) Vekil (proxy) değişkenleri: bun `HTTPS_PROXY`/`HTTP_PROXY`'yi kendisi
 *      uygular, Node'un `fetch`i UYGULAMAZ — vekil bozuksa aynı asimetri.
 * `diagnose()` ikisini de ayrı ayrı ölçer; `reachability()` "ağ tamamen açık
 * mı" sorusunu, `diagnose()` "CLI neden takıldı" sorusunu cevaplar.
 */

import dns from "node:dns/promises";
import net from "node:net";

/** Ölçülen adresler — sıra önemli değil, ikisi de paralel denenir. */
export const HOSTS = [
  { label: "token değişimi", url: "https://platform.claude.com/v1/oauth/token" },
  { label: "giriş sayfası", url: "https://claude.com/cai/oauth/authorize" },
];

const TIMEOUT_MS = Number(process.env.CLAUDE_NET_TIMEOUT_MS || 8000);

/**
 * Adreslere ulaşılıyor mu.
 * @returns {Promise<{ok:boolean, checks:Array<{label,url,ok,status?,ms,error?}>}>}
 */
export async function reachability({ timeoutMs = TIMEOUT_MS, hosts = HOSTS } = {}) {
  const checks = await Promise.all(hosts.map(async ({ label, url }) => {
    const t0 = Date.now();
    const iptal = AbortSignal.timeout(timeoutMs);
    try {
      const r = await fetch(url, { method: "GET", redirect: "manual", signal: iptal });
      return { label, url, ok: true, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      // AbortError = zaman aşımı; diğerleri DNS/TLS/bağlantı reddi.
      const sebep = e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `${timeoutMs} ms içinde yanıt yok`
        : (e?.cause?.code || e?.code || e?.message || "bilinmeyen hata");
      return { label, url, ok: false, error: String(sebep), ms: Date.now() - t0 };
    }
  }));
  return { ok: checks.every((c) => c.ok), checks };
}

/** Hata mesajına eklenecek tek satır. */
export function summarize({ ok, checks }) {
  const parca = checks.map((c) => `${c.label}: ${c.ok ? `ulaşıldı (HTTP ${c.status}, ${c.ms} ms)` : `ULAŞILAMADI — ${c.error}`}`);
  return ok
    ? `Sunucunun Anthropic'e çıkışı var (${parca.join(" · ")}), yani engel ağda değil.`
    : `⚠️ Sunucudan çıkış sorunlu — ${parca.join(" · ")}. Token değişimi bu yüzden takılmış olabilir.`;
}

// ---------------------------------------------------------------- derin teşhis

/** Vekil değişkenleri — bun uygular, Node'un fetch'i uygulamaz. */
const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];

/** Kullanıcı adı/parola içerebilir: `user:pass@` kısmı maskelenir. */
const maskProxy = (v) => String(v).replace(/\/\/[^@/]*@/, "//***@");

const tcp = (host, port, family, timeoutMs) => new Promise((res) => {
  const t0 = Date.now();
  const s = net.connect({ host, port, family, timeout: timeoutMs });
  const bitir = (ok, error) => { try { s.destroy(); } catch { /* kapali */ } res({ host, family, ok, error, ms: Date.now() - t0 }); };
  s.once("connect", () => bitir(true, null));
  s.once("timeout", () => bitir(false, `${timeoutMs} ms içinde bağlanamadı`));
  s.once("error", (e) => bitir(false, e.code || e.message));
});

const gerekli = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e.code || e.message }; } };

/**
 * "CLI neden takıldı" ölçümü: DNS (iki ayrı çözücüyle), IPv4/IPv6 ayrı ayrı
 * TCP bağlantısı, vekil değişkenleri.
 * @returns {Promise<object>}
 */
export async function diagnose({ host = "platform.claude.com", port = 443, timeoutMs = 5000 } = {}) {
  // getaddrinfo (Node'un fetch'inin kullandığı) vs c-ares (bun'ın kullandığı sınıf)
  const lookup = await gerekli(() => dns.lookup(host, { all: true }));
  const v4 = await gerekli(() => dns.resolve4(host));
  const v6 = await gerekli(() => dns.resolve6(host));

  const adresler = [
    ...(v4.ok ? v4.value.slice(0, 2).map((ip) => ({ ip, family: 4 })) : []),
    ...(v6.ok ? v6.value.slice(0, 2).map((ip) => ({ ip, family: 6 })) : []),
  ];
  const baglanti = await Promise.all(adresler.map(({ ip, family }) => tcp(ip, port, family, timeoutMs)));

  const proxy = PROXY_VARS.filter((k) => process.env[k]).map((k) => ({ name: k, value: maskProxy(process.env[k]) }));
  const v4ok = baglanti.some((b) => b.family === 4 && b.ok);
  const v6var = baglanti.some((b) => b.family === 6);
  const v6ok = baglanti.some((b) => b.family === 6 && b.ok);

  /*
   * ⚠️ IPv6 BAŞARISIZLIĞININ İKİ TÜRÜ VAR; ayırmazsan yanlış yere baktırır:
   *   ENETUNREACH/ECONNREFUSED → ANINDA döner (ölçüm: 1-2 ms). İstemci ya
   *     IPv4'e düşer ya da hemen hata verir; SESSİZ TAKILMA sebebi OLAMAZ.
   *   zaman aşımı (kara delik)  → paket yutulur, istemci yanıt bekler. Node
   *     `autoSelectFamily` ile ~250 ms'de IPv4'e düşer, bun düşmez.
   * İlk sürüm ikisini ayırmıyor ve "IPv6 kara delik" diye YANLIŞ teşhis
   * koyuyordu (canlıda öyle bir satır bastı). Kontrol ölçümü: geliştirici
   * makinesindeki Docker container'ı AYNI profili veriyor (IPv4 bağlı, IPv6
   * ENETUNREACH) ama orada CLI 371 ms'de cevap veriyor — profil tek başına
   * suçlu değil. Gerçek sebep bambaşkaydı (bkz. ENTER_GAP_MS).
   */
  const v6KaraDelik = baglanti.some((b) => b.family === 6 && !b.ok && /içinde bağlanamadı/.test(String(b.error)));
  const sebepler = [];
  if (proxy.length) sebepler.push(`vekil değişkeni tanımlı (${proxy.map((p) => p.name).join(", ")}) — bun bunu uygular, Node uygulamaz; CLI'nin takılması buradan olabilir`);
  if (v6KaraDelik && v4ok) sebepler.push("IPv6 KARA DELİK: IPv6 bağlantısı hata bile vermeden zaman aşımına düşüyor. Node IPv4'e düşer, bun düşmez — sessiz takılmanın klasik sebebi budur");
  if (!v4ok && !v6ok) sebepler.push("hiçbir adrese TCP bağlantısı kurulamadı");
  if (!lookup.ok) sebepler.push(`DNS çözümlenemedi: ${lookup.error}`);

  return {
    host, port,
    dns: {
      getaddrinfo: lookup.ok ? lookup.value.map((a) => `${a.address} (v${a.family})`) : `HATA: ${lookup.error}`,
      A: v4.ok ? v4.value : `HATA: ${v4.error}`,
      AAAA: v6.ok ? v6.value : `HATA: ${v6.error}`,
    },
    tcp: baglanti,
    proxy,
    ipv4: v4ok, ipv6: v6var ? v6ok : null, ipv6KaraDelik: v6KaraDelik,
    sebepler,
    ozet: sebepler.length
      ? sebepler.join(" · ")
      : `DNS, IPv4/IPv6 ve vekil tarafında sorun görünmüyor${v6var && !v6ok ? " (IPv6 anında hata veriyor — bu NORMAL, istemci IPv4'e düşer)" : ""}.`,
  };
}
