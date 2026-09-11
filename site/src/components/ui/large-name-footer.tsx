import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Buyuk isimli footer — sayfanin sonunu kapatan wordmark serifi.
 *
 * 21st.dev'deki "Large Name Footer" secildi; kaynagi cekilemedigi icin
 * (registry 403, sayfa kodu istemci tarafinda) ayni fikir site'in kendi
 * diliyle yazildi: Instrument Serif wordmark + ince baglanti kolonlari.
 *
 * ⚠️ YUZEY ADRESLERI SABIT YAZILMAZ. Panel ve Kapsam'in adresi ortak bardan
 * sorulur (`HqNav.url`, shared/nav/nav.js): panel baska bir portta ya da
 * makinede kostugunda footer'daki linkler de dogru kalir. Bu sayfada daha
 * once ayni hata iki kez vardi (Navbar.tsx ve CTA'da `localhost:4646` sabit).
 * Adres cozulemezse link HIC BASILMAZ — olu link gostermeyiz.
 */

type Col = { baslik: string; linkler: { ad: string; href: string }[] };

function surfaceUrl(s: "panel" | "scope" | "landing" | "onboarding") {
  return (typeof window !== "undefined" && window.HqNav?.url(s)) || "";
}

export function LargeNameFooter({ className }: { className?: string }) {
  const kolonlar: Col[] = [
    {
      baslik: "Yüzeyler",
      linkler: [
        { ad: "Panel", href: surfaceUrl("panel") },
        { ad: "Kapsam ağacı", href: surfaceUrl("scope") },
        { ad: "Landing", href: surfaceUrl("landing") },
      ],
    },
    {
      baslik: "Sayfa",
      linkler: [
        { ad: "Ne yaptık", href: "/#ne-yaptik" },
        { ad: "Ölçüm", href: "/#olcum" },
        { ad: "Başlangıç", href: "/onboarding" },
      ],
    },
  ];

  return (
    <footer className={cn("relative overflow-hidden border-t border-white/10 bg-black", className)}>
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-8 md:pt-20">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <Globe size={20} className="text-white/70" />
              <span className="text-lg font-semibold text-white">Case2AI</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/45">
              88 test case, 33 rotanın performans ölçümü, Jira kartları ve kotasız tasarım
              diff'i — tek ekranda, ölçülmüş kanıtla.
            </p>
          </div>

          <div className="flex gap-12 sm:gap-20">
            {kolonlar.map((k) => (
              <nav key={k.baslik} aria-label={k.baslik}>
                <p className="mb-4 text-xs uppercase tracking-widest text-white/35">{k.baslik}</p>
                <ul className="space-y-3">
                  {k.linkler.map((l) =>
                    /* Adres cozulemediyse satiri hic basma (bkz. bileşen basligi) */
                    l.href ? (
                      <li key={l.ad}>
                        <a
                          href={l.href}
                          className="text-sm text-white/60 transition-colors hover:text-white"
                        >
                          {l.ad}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {/* Wordmark: footer'in asil isi. `select-none` — bu bir baslik degil,
            imza; kopyalanacak bir metin gibi davranmasin. */}
        <div
          aria-hidden
          className="mt-16 select-none bg-gradient-to-b from-white/[0.14] to-white/[0.02] bg-clip-text text-transparent"
        >
          <p className="serif text-center text-[19vw] leading-[0.8] tracking-tight md:text-[15vw]">
            Case2AI
          </p>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/[0.07] pt-6 text-xs text-white/30 sm:flex-row">
          <p>Yerel QA altyapısı — panel, kapsam ağacı ve Playwright suite'i.</p>
          <p>Ölçülmemiş hiçbir şey iddia edilmez.</p>
        </div>
      </div>
    </footer>
  );
}

export default LargeNameFooter;
