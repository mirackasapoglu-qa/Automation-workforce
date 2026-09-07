import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn kuralindaki `cn` yardimcisi.
 *
 * 21st.dev bileşenleri bunu VAR SAYAR (`import { cn } from "@/lib/utils"`).
 * Yaptigi is: kosullu sinif birlestirme (clsx) + Tailwind catismasi cozme
 * (twMerge) — "px-4" ile "px-8" yan yana gelirse sonuncusu kazansin diye.
 * Elle sinif birlestirmek bu ikinci kismi kaciriyor ve bileşenin disaridan
 * verilen className'i sessizce etkisiz kaliyor.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
