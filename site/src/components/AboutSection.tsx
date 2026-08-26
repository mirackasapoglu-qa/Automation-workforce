import { useRef } from "react";
import { motion, useInView } from "framer-motion";

export default function AboutSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="ne-yaptik"
      ref={ref}
      className="relative bg-black pt-32 md:pt-44 pb-10 md:pb-14 px-6 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />
      <div className="relative max-w-6xl mx-auto">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-white/40 text-sm tracking-widest uppercase"
        >
          Ne yaptık
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="mt-6 text-4xl md:text-6xl lg:text-7xl text-white leading-[1.1] tracking-tight serif"
        >
          Bir QA paneli <em className="italic text-white/60">yeniden</em> tasarlandı
          <br className="hidden md:block" />
          <em className="italic text-white/60">ölçen, kaydeden ve kart açan</em> bir araca dönüştü.
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-10 flex flex-wrap gap-2"
        >
          {[
            ["17", "spec"],
            ["80", "test case"],
            ["21", "whitelist'li koşum"],
            ["8", "sekme"],
            ["33", "rota ölçüldü"],
            ["19", "Jira kartı"],
            ["26", "Figma frame"],
          ].map(([n, l]) => (
            <span
              key={l}
              className="liquid-glass rounded-full px-4 py-2 text-sm text-white/70"
            >
              <b className="text-white font-medium">{n}</b> {l}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
