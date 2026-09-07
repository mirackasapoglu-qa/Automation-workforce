import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { AlertTriangle, ArrowRight, Terminal } from "lucide-react";
import Navbar from "../components/Navbar";
import AuroraBackground from "@/components/ui/aurora-background";
import LargeNameFooter from "@/components/ui/large-name-footer";
import ScrollProgress from "@/components/ui/scroll-progress";
import StepRail from "@/components/ui/step-rail";

/*
 * HERO_VIDEO KALDIRILDI.
 *
 * Hero, d8j0ntlcm91z4.cloudfront.net uzerindeki bir mp4'u cekiyordu — sayfanin
 * TEK dis icerik bagimliligi (olculdu: fonts.googleapis/gstatic disinda kalan
 * tek yabanci host). Dosya repoda yok; o adres dustugu gun hero bosalirdi ve
 * kimse fark etmezdi. Yerine gecen aurora tamamen CSS: dis dosya yok, agirlik
 * yok, cevrimdisi de calisir.
 */

type Step = {
  n: string;
  label: string;
  title: string;
  body: string;
  cmd?: string;
  warn?: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    label: "Kurulum",
    title: "Paneli ayağa kaldır",
    body:
      "Tek komut ikisini birden kaldırır: panel 4646'da, siteyi iframe'de gösteren proxy 4647'de, bu landing sayfası 4321'de. Proxy x-frame-options'ı söküp geçici erişim cookie'sini enjekte eder — ve içine kaydediciyi de gömer.",
    cmd: "npm run up   # panel 4646 + landing 4321",
  },
  {
    n: "02",
    label: "Ortam",
    title: "Hangi ortamdayız",
    body:
      "Üst bardaki jeton aktif ortamı ve sipariş tamamlama kilidinin durumunu gösterir. Ortam .env içindeki HOMEE_ENV ile seçilir; kapı oturumu playwright/.auth/<env>-gate.json dosyasında tutulur ve ~24 saatte bir yenilenmesi gerekir.",
    warn:
      "Kapı cookie'si ~24 saatte sessizce ölür ve dolunca TÜM ölçümler yanlış olur. Bir kez 33 rotalık perf sweep'i çöpe attırdı. Bu yüzden üst barda sürekli görünen bir gösterge var: kalan süre, 4 saatin altında amber, dolmuşsa kırmızı — tıklayınca yeniliyor.",
  },
  {
    n: "03",
    label: "Koşum",
    title: "Testi panelden tetikle",
    body:
      "Sol kolondaki koşumlar panel/runs.json whitelist'inden gelir — listede olmayan hiçbir komut çalışmaz. Parametreli koşumda spec seçip başlık filtresi (-g), tekrar sayısı ve headed seçeneği verebilirsin. Canlı log SSE ile akar.",
    cmd: "npm run test:rota   # 10-route-health.spec.ts",
  },
  {
    n: "04",
    label: "Kayıt",
    title: "Gezinmeyi test koduna çevir",
    body:
      "İki yol var. Panel içindeki iframe'de gezinirsin, tıklama ve yazmalar sağ kolonda adım olarak birikir, tek tuşla Playwright spec'ine döner. Ya da ayrı pencerede Playwright codegen açılır. İkisi de oturum yüklü başlar; kapıyı elle geçmek yok.",
    warn:
      "Codegen'i bitirmenin yolu tarayıcı penceresini KAPATMAK. Süreci öldürmek — SIGTERM de SIGINT de — kodu kaybediyor; ölçüldü. Ayrıca çıktı tests/.recorded/ altına taslak olarak yazılır: locator'lar ham, POM'lara elle taşınmalı.",
  },
  {
    n: "05",
    label: "Ölçüm",
    title: "Perf ve AI yorumu",
    body:
      "33 rota, 3009 istek, 32 endpoint. Eşikler Web Vitals'tan: LCP ≤2500 ms iyi, >4000 ms zayıf; TTFB ≤800 ms. Bütçe aşımı renkli. 'AI yorumu' düğmesi ölçümü modele yorumlatır — özet, önem sıralı bulgular ve uygulanabilir öneri.",
    cmd: "node scripts/perf-sweep.mjs --scroll   # ölçümü yeniler",
  },
  {
    n: "06",
    label: "Öneri",
    title: "Senaryo öner",
    body:
      "Modele 17 paketi, 80 mevcut senaryoyu ve 33 dayanak kaynağını (HOMEE-00X kayıtları, Jira kartları, Figma frame'leri) verir. Dayanağı olmayan öneri kabul edilmez.",
    warn:
      "Bu kural istemde değil KODDA: dört katman (istem, çıktı süzgeci, bağlam doğrulaması, son ret) ve 14 test. Son katman kirli kayıt gelirse sessizce süzmez, patlar — kapıda delik olduğunu söyler. npm run test:gate",
  },
  {
    n: "07",
    label: "Raporlama",
    title: "Kart aç, kanıtı ekle",
    body:
      "Jira sekmesindeki form şablonlu gelir (Ortam / Adımlar / Gerçekleşen / Beklenen / Ölçüm), atanan listesi 48 kişi, kanıt galerisi panel-data/evidence/ içindeki görüntüleri gösterir. Seçtiklerin karta ek olarak yüklenir.",
    warn:
      "Bu projede konu SİLME izni yok. Yanlışlıkla açılan kart kaldırılamıyor — özete [TEST] yazıp kapatmak tek yol. Atama accountId ile yapılır; görünen adla çalışmaz.",
  },
  {
    n: "08",
    label: "Kanıt",
    title: "Verdict ve ekran görüntüsü",
    body:
      "Verdict sekmesi kayıt anahtarı, kapsam, durum ve not alır; panel-data/verdicts/<KART>.json olarak diske yazar. Kanıt görselleri panel-data/evidence/ altında birikir ve Jira yorumuna gönderilebilir.",
  },
  {
    n: "09",
    label: "Tasarım",
    title: "Tasarım diff'i",
    body:
      "Bir rota için Figma frame'i ile canlı sayfa yan yana konur; tasarımda olup canlıda bulunmayan metinler kırmızı işaretlenir. Render'lar panel-data/figma-cache/ içinde kalıcıdır, panel çevrimdışı çalışır.",
    warn:
      "Figma'nın iki ayrı kotası var: REST token'ı veri hacmine göre kesiyor, MCP ise View seat'te ayda 6 çağrıya izin veriyor. Frame id'leri figma-map.mjs'e yazıldı; kota dönünce tek istekle render inebilir.",
  },
  {
    n: "10",
    label: "Sınır",
    title: "Yıkıcı işlemler",
    body:
      "Sipariş tamamlayan spec (26) ALLOW_HOMEE_ORDERS=1 olmadan komple skip edilir. Havale seçildiğinde para çekilmez ama sipariş kaydı oluşur ve otomasyonla iptal edilemez — OrdersPage'de iptal akışı yok.",
    warn: "Hesabı kalıcı bozacak akışlar (telefon/e-posta değişimi, hesap silme) kullanıcı onayı olmadan koşulmaz.",
  },
];

function StepCard({ step, i }: { step: Step; i: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: (i % 2) * 0.1 }}
      /*
       * id + scroll-margin: raydaki baglantilar buraya atliyor. Ust bar
       * YAPISIK oldugu icin duz bir `#adim-03` kartin tepesini barin altina
       * gizlerdi; `scroll-mt` barin kendi yukseklik token'ini kullaniyor
       * (shared/nav/nav.css → --hq-nav-h), sabit piksel degil.
       */
      id={`adim-${step.n}`}
      className="liquid-glass rounded-3xl p-6 md:p-8 scroll-mt-[calc(var(--hq-nav-h,70px)+24px)]"
    >
      <div className="flex items-baseline gap-4 mb-4">
        <span className="text-white/25 text-4xl md:text-5xl serif italic leading-none">
          {step.n}
        </span>
        <p className="text-white/40 text-xs tracking-widest uppercase">{step.label}</p>
      </div>

      <h3 className="text-white text-2xl md:text-3xl tracking-tight mb-4 serif">{step.title}</h3>
      <p className="text-white/60 text-sm md:text-base leading-relaxed">{step.body}</p>

      {step.cmd && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
          <Terminal size={16} className="text-white/40 mt-0.5 shrink-0" />
          <code className="text-white/80 text-xs md:text-sm break-all">{step.cmd}</code>
        </div>
      )}

      {step.warn && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
          <AlertTriangle size={16} className="text-white/50 mt-0.5 shrink-0" />
          <p className="text-white/50 text-xs md:text-sm leading-relaxed">{step.warn}</p>
        </div>
      )}
    </motion.article>
  );
}

/**
 * TASARIM KARSILASTIRMASI
 *
 * Panelin "Tasarim diff" sekmesinin ne yaptigini ANLATMAK yerine GOSTERIYOR:
 * ayni rotanin Figma render'i ve canli sayfasi ust uste, saydamlik surgusuyle.
 * Iki gorsel de gercek: render `panel-data/figma-cache/` icinden, canli kare
 * kapi oturumuyla cekildi (ikisi de 1440 genislik, ustten 1700px kirpildi).
 */
function DesignCompare() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  const [mix, setMix] = useState(50);

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7 }}
      className="mt-16 liquid-glass rounded-3xl p-6 md:p-10"
    >
      <p className="text-white/40 text-xs tracking-widest uppercase mb-3">Tasarım karşılaştırması</p>
      <h3 className="text-white text-2xl md:text-3xl tracking-tight mb-4 serif">
        Figma ile canlı, <em className="italic text-white/50">aynı kare</em>
      </h3>
      <p className="text-white/60 text-sm md:text-base leading-relaxed max-w-3xl">
        Sürgüyü kaydır: solda tasarım, sağda canlı. Panel bunu metin düzeyinde de yapıyor —
        tasarımda olup canlıda bulunmayan metinler kırmızı işaretlenir, render'lar
        <code className="text-white/80"> panel-data/figma-cache/</code> içinde kalır ve panel
        çevrimdışı çalışır.
      </p>

      <div className="mt-6 relative overflow-hidden rounded-2xl border border-white/10 bg-black">
        <img src="/shots/diff-tasarim.jpg" alt="Anasayfa — Figma tasarımı" className="block w-full" />
        <img
          src="/shots/diff-canli.jpg"
          alt="Anasayfa — canlı sayfa"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: mix / 100 }}
        />
        <div className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/80">
          Figma {100 - mix}%
        </div>
        <div className="absolute top-3 right-3 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/80">
          Canlı {mix}%
        </div>
      </div>

      <label className="mt-5 flex items-center gap-4 text-white/50 text-xs">
        <span className="shrink-0">tasarım</span>
        <input
          type="range"
          min={0}
          max={100}
          value={mix}
          onChange={(e) => setMix(Number(e.target.value))}
          aria-label="Tasarım ve canlı sayfa arasında geçiş"
          className="w-full accent-white"
        />
        <span className="shrink-0">canlı</span>
      </label>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["Türkçe normalizasyon", "\u201CI\u0307\u201D.toLowerCase() birleşik nokta veriyor; naif karşılaştırma tek koşumda 12 yanlış pozitif üretti. NFD + \\p{Mn} atılıp küçültülüyor."],
          ["Durum eşitleme", "Boş sepetle ürünlü tasarımı karşılaştırmak 14 uydurma eksik üretiyor; üye oturumu ile koşuluyor."],
          ["Dinamik içerik", "Tasarımdaki örnek veri (fiyat, ürün adı) otomatik ayıklanır, kalanı --ignore ile susturulur."],
        ].map(([b, a]) => (
          <div key={b} className="rounded-2xl bg-white/[0.03] px-4 py-3">
            <p className="text-white/80 text-xs tracking-widest uppercase mb-2">{b}</p>
            <p className="text-white/50 text-xs leading-relaxed">{a}</p>
          </div>
        ))}
      </div>

      <p className="mt-5 text-white/40 text-xs leading-relaxed">
        Ölçüldü: aynı frame'de elle yapılan diff 32–36 “eksik” verirken script <strong className="text-white/70">6</strong> veriyor.
        Figma'nın iki ayrı kotası var — REST veri hacmine göre keser, MCP View seat'te ayda 6 çağrı.
      </p>
    </motion.section>
  );
}

/**
 * Panelin adresi ORTAK BARDAN sorulur, sayfaya sabit yazilmaz.
 *
 * Burada `http://localhost:4646` sabit duruyordu ve `target="_blank"` ile yeni
 * sekme aciyordu — Navbar.tsx'ten kaldirilan desenin ayni kalmis ikizi. Panel
 * baska bir portta ya da makinede kostugu anda olu link oluyordu. `HqNav.url`
 * adresi bulundugun host'tan cozer (shared/nav/nav.js → originFor); bar heniz
 * yuklenmediyse ya da adres cozulemiyorsa panelin varsayilan yereli kalir.
 */
function usePanelUrl() {
  const nav = typeof window !== "undefined" ? window.HqNav : undefined;
  return nav?.url("panel") || "http://localhost:4646/";
}

export default function Onboarding() {
  const headRef = useRef(null);
  const headIn = useInView(headRef, { once: true, margin: "-100px" });
  const panelUrl = usePanelUrl();

  return (
    <div className="bg-black min-h-screen">
      <ScrollProgress />
      <StepRail steps={STEPS.map(({ n, label }) => ({ n, label }))} />

      <AuroraBackground>
        <div>
          <Navbar />

          <div ref={headRef} className="px-6 pt-16 pb-24 md:pt-24 md:pb-32 max-w-6xl mx-auto">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={headIn ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6 }}
              className="text-white/40 text-sm tracking-widest uppercase"
            >
              Başlangıç
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={headIn ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="mt-6 text-5xl md:text-7xl lg:text-8xl text-white tracking-tight leading-[1.05] serif"
            >
              On adımda <em className="italic text-white/50">panel</em>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={headIn ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="mt-8 text-white/60 text-base md:text-lg leading-relaxed max-w-2xl"
            >
              Kurulumdan yıkıcı işlemlerin sınırına kadar. Her adımda gerçekten karşına
              çıkacak tuzağı da yazdım — sessizce ölen oturum, kaydı öldürünce kaybolan kod,
              silinemeyen Jira kartı, iptal edilemeyen sipariş.
            </motion.p>
          </div>
        </div>
      </AuroraBackground>

      <section className="px-6 pb-28 md:pb-40 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {STEPS.map((s, i) => (
            <StepCard key={s.n} step={s} i={i} />
          ))}
        </div>

        <DesignCompare />

        <div className="mt-16 flex flex-col md:flex-row items-center justify-between gap-6 liquid-glass rounded-3xl p-8 md:p-10">
          <div>
            <p className="text-white/40 text-xs tracking-widest uppercase mb-3">Sonraki adım</p>
            <p className="text-white text-xl md:text-2xl tracking-tight serif">
              Paneli aç ve bir rota taraması koş.
            </p>
          </div>
          <motion.a
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            href={panelUrl}
            className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium flex items-center gap-2 shrink-0"
          >
            {panelUrl.replace(/^https?:\/\//, "")} <ArrowRight size={16} />
          </motion.a>
        </div>
      </section>

      <LargeNameFooter />
    </div>
  );
}
