import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

const CARDS = [
  {
    shot: "/shots/panel-sg2.jpg",
    tag: "Model destekli",
    title: "Senaryo öner",
    desc:
      "Modele 17 paketi, 80 mevcut senaryoyu ve 33 dayanak kaynağını verir; dayanağı olmayan öneri kapıda elenir. Kural istemde değil kodda: dört katman ve 14 test.",
  },
  {
    shot: "/shots/panel-perf-renk.jpg",
    tag: "Ölçüm",
    title: "Perf sekmesi",
    desc:
      "33 rota, 3009 istek, 32 endpoint. Eşikler Web Vitals'tan; bütçe aşımı renkli. Ölçümü modele yorumlatan bir düğme var, uydurma rota gösteren bulgu eleniyor.",
  },
  {
    shot: "/shots/panel-iframe-rec2.jpg",
    tag: "Kayıt",
    title: "Gezinmeyi koda çevir",
    desc:
      "Panelin içindeki iframe'de gezinirsin, adımlar sağda birikir, tek tuşla Playwright spec'ine döner. Oturum yüklü başlar — kapıyı elle geçmek yok.",
  },
  {
    shot: "/shots/panel-bugform.jpg",
    tag: "Raporlama",
    title: "Kart aç, kanıtı ekle",
    desc:
      "Şablonlu açıklama, 48 kişilik atanan listesi ve kanıt galerisi. Seçtiğin ekran görüntüleri karta ek olarak yükleniyor — 19 ekli bir kart bu formdan açıldı.",
  },
];

export default function ServicesSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="relative bg-black py-28 md:py-40 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.02)_0%,_transparent_60%)]" />
      <div className="relative max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="flex items-end justify-between mb-12 md:mb-16"
        >
          <h2 className="text-3xl md:text-5xl text-white tracking-tight serif">Panelde ne var</h2>
          <p className="text-white/40 text-sm hidden md:block">Sekiz sekme</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {CARDS.map((c, i) => (
            <motion.article
              key={c.title}
              initial={{ opacity: 0, y: 50 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: i * 0.15 }}
              className="liquid-glass rounded-3xl overflow-hidden group"
            >
              <div className="relative aspect-video overflow-hidden">
                <img
                  src={c.shot}
                  alt={c.title}
                  className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </div>

              <div className="p-6 md:p-8">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-white/40 text-xs tracking-widest uppercase">{c.tag}</p>
                  <span className="liquid-glass rounded-full p-2 text-white/80">
                    <ArrowUpRight size={16} />
                  </span>
                </div>
                <h3 className="text-white text-xl md:text-2xl mb-3 tracking-tight serif">
                  {c.title}
                </h3>
                <p className="text-white/50 text-sm leading-relaxed">{c.desc}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
