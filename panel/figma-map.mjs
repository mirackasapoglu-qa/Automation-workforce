/**
 * Rota → Figma frame eşlemesi (eşleme mantığı).
 *
 * Verinin kendisi proje profilinde: `panel/projects/<proje>.mjs → figma`.
 * Burada yalnızca eşleştirme var, proje bilgisi yok.
 */
import { PROJECT } from "./project.mjs";

export const FIGMA_FILE = PROJECT.figma.file;
export const FIGMA_ROUTES = PROJECT.figma.routes;

export function figmaForRoute(pathname = "/") {
  const p = (pathname.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";
  for (const r of FIGMA_ROUTES) {
    if (r.test(p)) return { ...r, test: undefined, matched: p, file: FIGMA_FILE };
  }
  return null;
}
