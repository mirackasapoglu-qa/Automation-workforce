import { Globe } from "lucide-react";

/**
 * Sayfa ICI gezinme — yalnizca bu dokumanin bolumleri.
 *
 * YUZEYLER ARASI baglantilar (Panel, Kapsam agaci, Landing ↔ Onboarding)
 * buradan KALKTI: hepsi sayfanin en ustundeki ortak barda (shared/nav/nav.js
 * → SURFACES[...].go). Onceden burada `http://localhost:4646/scope/` SABIT
 * yaziliydi — panel baska bir portta ya da makinede kostugu anda olu link
 * oluyordu; bar adresi bulundugu host'tan cozuyor. Yeni bir yuzey hedefi
 * gerekirse buraya degil SURFACES'a eklenir, o zaman uc yuzde birden cikar.
 */
const LINKS = [
  { label: "Ne yaptık", to: "/#ne-yaptik" },
  { label: "Ölçüm", to: "/#olcum" },
];

export default function Navbar() {
  return (
    <nav className="relative z-20 px-6 py-6">
      <div className="liquid-glass rounded-full max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center">
          {/*
            `<a>`, `<Link>` DEGIL: kok artik React yonlendirmesinde degil, ayri
            bir statik dokuman (Vesper.ai landing). Client-side gecis URL'i "/"
            yapar ama eski Index bilesenini cizerdi — yani yeni landing yerine
            kaldirilmis tasarim gorunurdu. Gercek gezinme sart.
          */}
          {/* Adres bardan: sunucuda landing kokte DEGIL (panel orada), /home'da. */}
          <a data-hq="landing" href="/" className="flex items-center gap-2">
            <Globe size={24} className="text-white" />
            <span className="text-white font-semibold text-lg">Case2AI</span>
          </a>
          <div className="hidden md:flex items-center gap-8 ml-8">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.to}
                className="text-white/80 hover:text-white text-sm font-medium transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
