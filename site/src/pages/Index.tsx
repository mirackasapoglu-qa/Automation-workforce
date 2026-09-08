import { ArrowRight, FileText, Gauge, Terminal } from "lucide-react";
import HeroVideo from "../components/HeroVideo";
import Navbar from "../components/Navbar";
import AboutSection from "../components/AboutSection";
import FeaturedShotSection from "../components/FeaturedShotSection";
import PhilosophySection from "../components/PhilosophySection";
import ServicesSection from "../components/ServicesSection";

const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4";

/**
 * Panelin adresi ORTAK BARDAN sorulur (shared/nav/nav.js → HqNav.url), sayfaya
 * sabit yazılmaz. Burada dört bağlantı `http://localhost:4646` sabitiyle
 * duruyordu; sunucuda (panel aynı origin'de, 4646 yok) hepsi ölü linkti.
 * Bar yüklenmemişse yerel varsayılana düşer — Onboarding.tsx ile aynı desen.
 */
function usePanelUrl() {
  const nav = typeof window !== "undefined" ? window.HqNav : undefined;
  return (nav?.url("panel") || "http://localhost:4646/").replace(/\/+$/, "");
}

export default function Index() {
  const panelUrl = usePanelUrl();
  const panelHost = panelUrl.replace(/^https?:\/\//, "");
  // Site proxy'si (iframe) panelin bir port üstünde; sunucuda ters vekil
  // arkasında ayrı port yok, o yüzden yalnızca localhost'ta gösterilir.
  const proxyUrl = /localhost|127\.0\.0\.1/.test(panelUrl)
    ? panelUrl.replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`)
    : null;
  return (
    <div className="bg-black">
      <div className="min-h-screen overflow-hidden relative flex flex-col">
        <HeroVideo src={HERO_VIDEO} />

        <Navbar />

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center -translate-y-[20%]">
          <h1 className="text-7xl md:text-8xl lg:text-9xl text-white tracking-tight whitespace-nowrap serif">
            Ölç, sonra <em className="italic">iddia et</em>.
          </h1>

          <div className="max-w-xl w-full mt-10">
            <form
              className="liquid-glass rounded-full pl-6 pr-2 py-2 flex items-center gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                window.location.assign(panelUrl + "/");
              }}
            >
              <input
                type="text"
                defaultValue={panelHost}
                aria-label="Panel adresi"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/40 text-sm"
                placeholder="Panel adresi"
              />
              <button
                type="submit"
                aria-label="Paneli aç"
                className="bg-white rounded-full p-3 text-black shrink-0 hover:bg-white/90 transition-colors"
              >
                <ArrowRight size={20} />
              </button>
            </form>
          </div>

          <p className="text-white text-sm leading-relaxed px-4 mt-6 max-w-xl">
            Homee QA Paneli; 80 test case'ini, 33 rotanın performans ölçümünü, Jira kartlarını,
            gezinmeyi koda çeviren kaydediciyi ve kotasız tasarım diff'ini tek ekranda toplar.
            Yıkıcı işlemler guard arkasında, koşulabilir komutlar whitelist'te.
          </p>

          <a
            data-hq="onboarding" href="/onboarding"
            className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium hover:bg-white/5 transition-colors mt-8"
          >
            Başlangıç rehberi
          </a>
        </div>

        <div className="relative z-10 flex justify-center gap-4 pb-12">
          {[
            { Icon: Terminal, href: `${panelUrl}/#log`, label: "Canlı log" },
            { Icon: FileText, href: `${panelUrl}/report`, label: "Playwright raporu" },
            ...(proxyUrl ? [{ Icon: Gauge, href: proxyUrl, label: "Site proxy" }] : []),
          ].map(({ Icon, href, label }) => (
            <a
              key={label}
              href={href}
              title={label}
              aria-label={label}
              className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all"
            >
              <Icon size={20} />
            </a>
          ))}
        </div>
      </div>

      <AboutSection />
      <FeaturedShotSection />
      <PhilosophySection />
      <ServicesSection />

      <footer className="bg-black border-t border-white/10 px-6 py-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/40 text-sm">
            Homee QA Paneli — yerel araç, dış dünyaya açılmaz.
          </p>
          <p className="text-white/40 text-sm serif italic">redesign-prod.test.tepehome.com.tr</p>
        </div>
      </footer>
    </div>
  );
}
