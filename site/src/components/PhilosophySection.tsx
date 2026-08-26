import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4";

export default function PhilosophySection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="olcum" ref={ref} className="bg-black py-28 md:py-40 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-5xl md:text-7xl lg:text-8xl text-white tracking-tight mb-16 md:mb-24 serif"
        >
          Ölçüm <em className="italic text-white/40">x</em> Kanıt
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.9 }}
            className="rounded-3xl overflow-hidden aspect-[4/3]"
          >
            <video
              src={VIDEO}
              muted
              autoPlay
              loop
              playsInline
              preload="auto"
              className="w-full h-full object-cover"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.9 }}
          >
            <div>
              <p className="text-white/40 text-xs tracking-widest uppercase mb-4">
                Durum kodu yalan söyler
              </p>
              <p className="text-white/70 text-base md:text-lg leading-relaxed">
                Homee 404 sayfasında da HTTP 200 dönüyor. Bu yüzden rota sağlığı DOM'dan
                ölçülüyor: "Sayfa Bulunamadı" görünür mü, kaç ürün kartı render oldu, hangi
                görsel <span className="text-white">naturalWidth=0</span> döndü. 31 rota tek
                geçişte tarandı; bilinen 6 kırık rotanın 6'sı hâlâ kırık, 5 boş kategorinin
                5'i hâlâ boş.
              </p>
            </div>

            <div className="w-full h-px bg-white/10 my-10" />

            <div>
              <p className="text-white/40 text-xs tracking-widest uppercase mb-4">
                Kota kapalıyken de
              </p>
              <p className="text-white/70 text-base md:text-lg leading-relaxed">
                Figma'nın iki ayrı kotası tükendiğinde tasarım karşılaştırması durmadı:
                önbellekteki düğüm ağaçları font, punto ve metin katmanlarını taşıyor.
                <span className="text-white"> 26 ekran frame'i</span> API'ye hiç çağrı yapılmadan
                diff'lenebiliyor. Elle yapılan aynı diff 32–36 "eksik" verirken script
                <span className="text-white"> 6</span> veriyor.
              </p>
            </div>

            <div className="w-full h-px bg-white/10 my-10" />

            <div>
              <p className="text-white/40 text-xs tracking-widest uppercase mb-4">
                Ağ envanteri
              </p>
              <p className="text-white/70 text-base md:text-lg leading-relaxed">
                33 rota, 3009 istek, 229 API çağrısı, 32 ayrı endpoint. Eşikler Web Vitals'tan;
                hiçbir rota "zayıf" bandında değil ama iki yapısal sorun var:
                <span className="text-white"> token 20 rotada 61 kez</span> isteniyor ve mega menü
                endpoint'i <span className="text-white">33/33 rotada</span> cache'siz — 511 ms'e kadar.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
