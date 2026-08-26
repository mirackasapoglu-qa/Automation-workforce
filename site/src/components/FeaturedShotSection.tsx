import { useRef } from "react";
import { motion, useInView } from "framer-motion";

/**
 * Spec'te burada dekoratif video vardı; paneli anlatan bir sayfada
 * gerçek arayüz ekran görüntüsü daha çok iş görüyor.
 */
export default function FeaturedShotSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="bg-black pt-6 md:pt-10 pb-20 md:pb-32 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9 }}
          className="relative rounded-3xl overflow-hidden aspect-video"
        >
          <img
            src="/shots/panel-dark.png"
            alt="Homee QA Paneli — Site (canlı) sekmesi"
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="liquid-glass rounded-2xl p-6 md:p-8 max-w-md">
              <p className="text-white/50 text-xs tracking-widest uppercase mb-3">Yaklaşımımız</p>
              <p className="text-white text-sm md:text-base leading-relaxed">
                Panel tek dosyalık bir HTML; 53 id ve inline CSS değişkenine bağlı 148 olay
                dinleyicisi var. Tasarımı değiştirirken davranış sözleşmesine dokunmadık —
                her id yerinde, her sekme çalışıyor.
              </p>
            </div>

            <motion.a
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              href="/onboarding"
              className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium shrink-0"
            >
              Nasıl kullanılır
            </motion.a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
