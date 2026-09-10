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
 */

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
