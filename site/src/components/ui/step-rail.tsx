import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Adim rayi — sagda duran dikey gosterge.
 *
 * Ilerleme cizgisi "ne kadar kaldi"yi soyluyor; bu ray "hangi adimdayim"i ve
 * "dogrudan sekizinciye atla"yi veriyor. 10 adimlik bir sayfada ikisi ayri
 * sorular.
 *
 * KONUM: `fixed`, sagda, dikeyde ortali. Kart gridinin genisligine DOKUNMAZ —
 * sayfa yerlesimi degismesin diye akisin disinda.
 *
 * ⚠️ RAY DAR TUTULMALI, yoksa sagdaki karta biner. Ilk halinde etiketler
 * AKISTA duruyordu: ray ~142px genislik istiyor ve icerik `max-w-6xl`
 * oldugu icin 1024/1152/1280'de kartlarla cakisiyordu (olculdu, yalniz
 * 1440'ta temizdi). Etiketler artik `absolute` — ray yalnizca cizgilerin
 * genisligi kadar (28px), boylece xl'den (1280px) itibaren cakisma yok.
 * Etiket YALNIZCA uzerine gelince cikar; aktif olan surekli acik kalsa
 * kartin uzerinde kalici bir yazi olurdu.
 *
 * <xl'de hic basilmaz; orada yon bilgisini ilerleme cizgisi veriyor.
 *
 * AKTIF ADIM: IntersectionObserver, viewport'un orta seridine giren kartlara
 * bakar. `scroll` dinleyip her karede `getBoundingClientRect` okumak da
 * calisirdi ama uzun sayfada surekli layout hesabi demek.
 *
 * ⚠️ AYNI ANDA BIRDEN FAZLA ADIM AKTIF OLABILIR ve bu dogru: grid iki kolonlu,
 * yani 07 ile 08 YAN YANA duruyor. Once "gorunenler arasindan en kucugu"
 * seciliyordu; 08'e tiklayinca ray 07'yi isaretliyordu (olculdu) — kullaniciya
 * yalan soyleyen bir gosterge. Simdi seritteki kartlarin HEPSI isaretli:
 * "yedinci-sekizinci satirdasin" demek, "yedincidesin" demekten dogru.
 */
export function StepRail({
  steps,
}: {
  steps: { n: string; label: string }[];
}) {
  const [aktif, setAktif] = useState<string[]>(steps[0] ? [steps[0].n] : []);
  const anahtar = steps.map((s) => s.n).join(",");

  /**
   * Hedefe kaydirma — tarayicinin CAPA davranisi KULLANILMIYOR.
   *
   * `href="#adim-08"` + `scroll-mt` dogru gorunuyordu (`scroll-margin-top`
   * 94px olculdu) ama kart barin 16px altinda kaliyordu. Sebep: kartlar
   * `initial={{ y: 40 }}` ile asagidan kayarak geliyor ve tarayici capayi
   * DONUSTURULMUS kutuya gore hizaliyor — kart 94px'e oturuyor, sonra
   * animasyon transform'u geri sarinca 40px yukari kayip barin altina
   * giriyor. Olculdu: hic gorulmemis her hedef 54px'te bitiyordu.
   *
   * `offsetTop` zinciri transform'dan ETKILENMEZ, yerleşim konumunu verir;
   * hesap animasyonun nerede oldugundan bagimsiz dogru.
   */
  function atla(e: React.MouseEvent, n: string) {
    // Yeni sekme / orta tik gibi degistiricileri tarayiciya BIRAK.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const el = document.getElementById(`adim-${n}`);
    if (!el) return;
    e.preventDefault();

    let y = 0;
    for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
      y += node.offsetTop;
    }
    const bar =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hq-nav-h")) || 70;
    window.scrollTo({ top: Math.max(0, y - bar - 24), behavior: "smooth" });
    // Adres cubugunda hedef kalsin ki bagliniti paylasilabilir olsun; kaydirmayi
    // tetiklemesin diye `replaceState`, `hash` atamasi degil.
    history.replaceState(null, "", `#adim-${n}`);
  }

  useEffect(() => {
    const hedefler = steps
      .map((s) => document.getElementById(`adim-${s.n}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!hedefler.length) return;

    const gorunen = new Set<string>();
    const gozlemci = new IntersectionObserver(
      (girisler) => {
        for (const g of girisler) {
          const n = g.target.id.replace("adim-", "");
          if (g.isIntersecting) gorunen.add(n);
          else gorunen.delete(n);
        }
        // Serit iki kart arasinda kalabiliyor (satirlarin bosluguna denk
        // gelince): o anda hicbirini isaretlemek yerine son bilinen satir
        // duruyor, yoksa ray kaydirirken yanip sonerdi.
        if (!gorunen.size) return;
        const yeni = [...gorunen].sort();
        // Ayni satir tekrar bildirilirse durumu DEGISTIRME: her bildirimde yeni
        // bir dizi yazmak, ayni icerikle bile React'i yeniden cizdirir ve
        // asagidaki effect'i (bagimliligi diziye dayali) yeniden kurar.
        setAktif((onceki) =>
          onceki.length === yeni.length && onceki.every((v, i) => v === yeni[i]) ? onceki : yeni,
        );
      },
      { rootMargin: "-15% 0px -55% 0px", threshold: 0 },
    );

    hedefler.forEach((el) => gozlemci.observe(el));
    return () => gozlemci.disconnect();
    // Bagimlilik DIZININ KENDISI degil, kimligi: cagiran taraf `steps`i satir
    // ici uretirse (`STEPS.map(...)`) her render'da yeni referans gelir ve
    // gozlemci bos yere sokulup takilirdi.
  }, [anahtar]);

  return (
    <nav
      aria-label="Adımlar"
      className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
    >
      <ul className="flex flex-col gap-1">
        {steps.map((s) => {
          const on = aktif.includes(s.n);
          return (
            <li key={s.n} className="relative">
              <a
                href={`#adim-${s.n}`}
                onClick={(e) => atla(e, s.n)}
                aria-current={on ? "true" : undefined}
                /* Etiket gorsel olarak gizliyken de ad okunabilir olmali. */
                aria-label={`${s.n} — ${s.label}`}
                title={`${s.n} — ${s.label}`}
                className="group flex items-center justify-end py-1"
              >
                {/* AKISTA DEGIL: rayin genisligini etiket belirlemesin (bkz.
                    bileşen basligindaki cakisma notu). Yalnizca uzerine
                    gelince gorunur, o an kartin kenarina binmesi gecici. */}
                <span
                  className={cn(
                    "pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2",
                    "whitespace-nowrap text-[11px] uppercase tracking-widest",
                    "text-white/0 transition-colors duration-300 group-hover:text-white/55",
                  )}
                >
                  {s.label}
                </span>
                <span
                  className={cn(
                    "block h-px transition-all duration-300",
                    on ? "w-7 bg-[#9184d9]" : "w-3.5 bg-white/25 group-hover:w-5 group-hover:bg-white/50",
                  )}
                />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default StepRail;
