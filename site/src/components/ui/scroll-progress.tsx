import { motion, useScroll, useSpring } from "framer-motion";

/**
 * Sayfa ilerleme cizgisi.
 *
 * NEDEN: onboarding 5 ekrandan uzun (olculdu: 5392px) ve 10 kart ayni ritimde
 * akiyor — okuyanin nerede oldugu ve daha ne kadar kaldigi hicbir yerden belli
 * degildi. Bu cizgi o iki soruyu tek bakista cevapliyor.
 *
 * ⚠️ Ust barin ALTINA yapisir, ustune degil: `top: var(--hq-nav-h)`. O token
 * ortak barin kendi dosyasindan geliyor (shared/nav/nav.css) — buraya 70px
 * yazmak, bar yuksekligi degistigi gun cizgiyi barin ortasinda birakirdi.
 *
 * `scaleX` + `transform-origin:left` kullaniliyor, `width` DEGIL: genislik
 * animasyonu her karede yeniden yerlesim (layout) tetikler; olcek yalnizca
 * bilesik katmanda calisir ve uzun sayfada kaydirma takilmaz.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  // Ham deger kaydirmayi birebir izler ve tiz durur; yay biraz gecikme
  // vererek cizgiyi akiskan gosteriyor.
  const x = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX: x, top: "var(--hq-nav-h, 70px)" }}
      className="fixed inset-x-0 z-30 h-[2px] origin-left bg-gradient-to-r from-[#6d5fc4] via-[#9184d9] to-[#c9c2f0]"
    />
  );
}

export default ScrollProgress;
