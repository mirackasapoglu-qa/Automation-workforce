import { Globe } from "lucide-react";
import { useLocation } from "react-router-dom";

const LINKS = [
  { label: "Ne yaptık", to: "/#ne-yaptik" },
  { label: "Ölçüm", to: "/#olcum" },
  { label: "Başlangıç", to: "/onboarding" },
];

export default function Navbar() {
  const { pathname } = useLocation();

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
          <a href="/" className="flex items-center gap-2">
            <Globe size={24} className="text-white" />
            <span className="text-white font-semibold text-lg">Homee QA</span>
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

        <div className="flex items-center gap-4">
          <a
            href={pathname === "/onboarding" ? "/" : "/onboarding"}
            className="text-white text-sm font-medium hover:text-white/80 transition-colors"
          >
            {pathname === "/onboarding" ? "Landing" : "Onboarding"}
          </a>
          <a
            href="http://localhost:4646"
            target="_blank"
            rel="noreferrer"
            className="liquid-glass rounded-full px-6 py-2 text-white text-sm font-medium hover:bg-white/5 transition-colors"
          >
            Paneli aç
          </a>
        </div>
      </div>
    </nav>
  );
}
