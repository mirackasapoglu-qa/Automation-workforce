import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Aurora arka plani — hero'nun altinda duran hareketli isik katmani.
 *
 * 21st.dev'deki "Aurora Background" secildi ama kaynagi cekilemedi: registry
 * ucu (21st.dev/r/...) hesap istiyor (403 authentication_required) ve kod
 * sayfada istemci tarafinda render ediliyor. Bu yuzden ayni fikir site'in
 * kendi dilinde yazildi — 21st'ten kod yapistirilirsa bunun yerine gecebilir.
 *
 * Efektin tamami CSS'te (index.css → .aurora): iki tekrarlayan gradyan ust
 * uste, `background-position` yavasca kayiyor. Bileşen yalnizca katmanlari
 * sirali diziyor. WebGL yok, kare kare JS yok, dis dosya yok.
 *
 * ⚠️ `overflow-hidden` SART: .aurora `inset:-30%` ile cerceveden tasar ki
 * blur'un kenarinda kesik bir cizgi gorunmesin. Sarmalayici kirpmazsa tasan
 * kisim sayfaya yatay kaydirma ekler.
 */
export function AuroraBackground({
  children,
  className,
  /** Ustten asagi sonen maske. Kapatmak icin false — o zaman aurora tum kareyi doldurur. */
  masked = true,
}: {
  children?: ReactNode;
  className?: string;
  masked?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <div aria-hidden className={cn("absolute inset-0", masked && "aurora-mask")}>
        <div className="aurora" />
      </div>
      {/* Metnin okunurlugunu garantileyen dusey karartma. Aurora'nin uzerinde,
          icerigin altinda: opacity ile oynamak yerine ayri katman, cunku
          basligin kontrasti auroranin o anki parlakligina birakilamaz. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/45 to-black"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export default AuroraBackground;
