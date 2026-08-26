import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { AlertTriangle, ArrowRight, Terminal } from "lucide-react";
import Navbar from "../components/Navbar";

const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260402_054547_9875cfc5-155a-4229-8ec8-b7ba7125cbf8.mp4";

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
      className="liquid-glass rounded-3xl p-6 md:p-8"
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

export default function Onboarding() {
  const headRef = useRef(null);
  const headIn = useInView(headRef, { once: true, margin: "-100px" });

  return (
    <div className="bg-black min-h-screen">
      <div className="relative overflow-hidden">
        <video
          src={HERO_VIDEO}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/70 to-black" />

        <div className="relative z-10">
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
      </div>

      <section className="px-6 pb-28 md:pb-40 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {STEPS.map((s, i) => (
            <StepCard key={s.n} step={s} i={i} />
          ))}
        </div>

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
            href="http://localhost:4646"
            target="_blank"
            rel="noreferrer"
            className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium flex items-center gap-2 shrink-0"
          >
            localhost:4646 <ArrowRight size={16} />
          </motion.a>
        </div>
      </section>
    </div>
  );
}
