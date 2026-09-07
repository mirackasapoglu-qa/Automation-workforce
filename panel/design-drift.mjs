/**
 * Tasarım Drift Radarı — Figma tarafı.
 *
 * Bir düğüm ✅ (Tamamlandı) VE Kaynaklar'da bir Figma linki taşıyorsa, o
 * dosyanın Figma'daki son değişim zamanını (`lastModified`) düğümün
 * `lastVerifiedAt`'ıyla kıyaslamak için gereken tek şey bu: dosya anahtarını
 * URL'den çıkarmak ve `/v1/files/:key?depth=1`'i (kota-bilinçli, önbellekli)
 * çağırmak. Ağaç mutasyonu burada YOK — `panel/scope.mjs → sweepResourceDrift`
 * yapıyor (Confluence ile PAYLAŞILAN aynı fonksiyon, bkz. o dosyadaki gerekçe).
 *
 * ⚠️ ÖLÇÜM SINIRI: bu uç DOSYA seviyesinde `lastModified` veriyor, FRAME
 * seviyesinde değil. "Bu dosyada bir şey değişti" ile "senin baktığın frame
 * değişti" aynı şey değil — bilerek kaba tutuldu. Frame-seviyesinde tespit
 * tam ağaç çekmek ister (pahalı, 429 riski); dosya seviyesi TEK ucuz istekle
 * "bir şeye bak" sinyali veriyor, `figma-render.mjs`'in şığ sorgusuyla aynı
 * kovada (`/v1/files`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteResponse } from "./figma-quota.mjs";
import { isCut } from "./connectors/cuts.mjs";

const CACHE_DIR = path.join(process.cwd(), "panel-data", "figma-cache");
/**
 * Tasarım ağacı/render önbelleği (figma-render.mjs) 1 YIL tutuluyor çünkü
 * kota o kadar dar — ama Drift Radarı'nın işi tam tersi, TAZELİK istiyor.
 * 6 saat: "Bayat/Bekleyen" panelini kim ne sıklıkla açarsa açsın gerçek
 * çağrı israf edilmesin (View/Collab koltukta ayda 6 istek), ama bir günlük
 * kullanım içinde birden fazla kez gerçek bir değişikliği kaçırmasın.
 */
const CACHE_TTL_MS = Number(process.env.DESIGN_DRIFT_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);

function lastModCachePath(fileKey) {
  return path.join(CACHE_DIR, `lastmod_${fileKey.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}

function token() {
  if (isCut("figma")) return null;
  const f = path.join(os.homedir(), ".figma-credentials");
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, "utf8").match(/FIGMA_TOKEN\s*=\s*(\S+)/)?.[1] ?? null;
}

/** Figma URL'inden dosya anahtarını çıkarır — hem eski (`/file/`) hem yeni (`/design/`) biçim. */
export function extractFigmaFileKey(url) {
  const m = /figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/.exec(String(url ?? ""));
  return m?.[1] ?? null;
}

/**
 * Bir dosyanın son değişim zamanını döner (ISO string) — önbellek öncelikli.
 * Kimlik yok, koparılmış, ağ hatası ya da 429 ise sessizce `null` döner:
 * bu bir dosya için "bilinmiyor" demektir, sweep'in geri kalanını durdurmaz.
 */
async function fileLastModified(fileKey) {
  const cf = lastModCachePath(fileKey);
  if (fs.existsSync(cf)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cf, "utf8"));
      if (Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) return cached.lastModified;
    } catch { /* bozuksa yeniden cek */ }
  }
  const t = token();
  if (!t) return null;
  const url = `https://api.figma.com/v1/files/${fileKey}?depth=1`;
  let res;
  try {
    res = await fetch(url, { headers: { "X-Figma-Token": t } });
  } catch {
    return null;
  }
  noteResponse(url, res, `design-drift ${fileKey}`);
  if (!res.ok) return null; // 429 dahil — bu dosyayi atla, digerleri devam etsin
  const json = await res.json().catch(() => null);
  const lastModified = json?.lastModified ?? null;
  if (lastModified) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cf, JSON.stringify({ lastModified, checkedAt: new Date().toISOString() }));
  }
  return lastModified;
}

/**
 * Birden çok dosya anahtarı için `lastModified` haritası döner. SIRALI
 * çağırır (Promise.all değil) — paylaşılan kota tek sayaç, aynı anda çoklu
 * istek 429 riskini artırır (bkz. CLAUDE.md → "Figma rate limit").
 * @param {string[]} fileKeys
 * @returns {Promise<Record<string, string|null>>}
 */
export async function lastModifiedByKey(fileKeys) {
  const out = {};
  for (const key of fileKeys) out[key] = await fileLastModified(key);
  return out;
}
