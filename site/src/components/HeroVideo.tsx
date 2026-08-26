import { useEffect, useRef } from "react";

/**
 * Hero arka plan videosu — CSS transition YOK, opacity elle
 * requestAnimationFrame ile sürülüyor. Bitişte siyaha yumuşak geçip
 * baştan başlıyor, böylece döngüde sert kesme olmuyor.
 */
export default function HeroVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const fadingOut = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const fade = (from: number, to: number, ms: number, done?: () => void) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - start) / ms, 1);
        video.style.opacity = String(from + (to - from) * t);
        if (t < 1) rafRef.current = requestAnimationFrame(step);
        else done?.();
      };
      rafRef.current = requestAnimationFrame(step);
    };

    const onCanPlay = () => {
      void video.play().catch(() => {});
      fade(0, 1, 500);
    };

    const onTimeUpdate = () => {
      if (!video.duration || fadingOut.current) return;
      if (video.duration - video.currentTime <= 0.55) {
        fadingOut.current = true;
        fade(Number(video.style.opacity || 1), 0, 500);
      }
    };

    const onEnded = () => {
      video.style.opacity = "0";
      window.setTimeout(() => {
        video.currentTime = 0;
        void video.play().catch(() => {});
        fadingOut.current = false;
        fade(0, 1, 500);
      }, 100);
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      muted
      autoPlay
      playsInline
      preload="auto"
      className="absolute inset-0 w-full h-full object-cover object-bottom"
      style={{ opacity: 0 }}
    />
  );
}
