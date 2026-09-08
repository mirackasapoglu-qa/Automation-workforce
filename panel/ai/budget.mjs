/**
 * AI harcama defteri + günlük tavan + eşzamanlılık kapısı.
 *
 * NEDEN: "bu hafta ne harcadık" sorusunun cevabı hiçbir yerde durmuyordu
 * (CLI yolu `costUsd`'yi yalnızca denetim kaydına yazıyordu, toplanmıyordu).
 * Sunucuda anahtar tek olduğu ve paneli birden fazla kişi kullanacağı için:
 *   1) her çağrı `panel-data/ai-usage.jsonl`'e tek satır (ekleme, üzerine yazma yok),
 *   2) `AI_DAILY_USD` verilmişse gün içi toplam tavanı aşınca çağrı 429 ile durur,
 *   3) aynı anda en çok `AI_MAX_CONCURRENCY` (varsayılan 2) çağrı; kuyruk 4,
 *      fazlası BUSY — çift tık ya da iki kullanıcı anahtarı boşa yakmasın.
 *
 * Gün sınırı UTC: sunucu saati ile panelin saati farklı olabilir, tek referans
 * dosyadaki ISO tarih. Dosya küçük (satır/çağrı); okuma günde bir kez, sonra
 * bellekte tutulur ve her kayıtta güncellenir.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = () => path.join(process.cwd(), "panel-data", "ai-usage.jsonl");

const err = (code, message) => Object.assign(new Error(message), { code });

/** Günlük tavan (USD). Verilmemişse null = sınırsız. */
export function dailyCapUsd() {
  const n = Number(process.env.AI_DAILY_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

let cache = { day: null, spent: 0, calls: 0 };
const todayKey = () => new Date().toISOString().slice(0, 10);

function loadToday() {
  const day = todayKey();
  if (cache.day === day) return cache;
  let spent = 0;
  let calls = 0;
  try {
    for (const line of fs.readFileSync(FILE(), "utf8").split("\n")) {
      if (!line.startsWith(`{"at":"${day}`)) continue;
      try {
        const j = JSON.parse(line);
        spent += Number(j.costUsd) || 0;
        calls++;
      } catch { /* bozuk satır: sayma */ }
    }
  } catch { /* dosya yok: sıfır */ }
  cache = { day, spent, calls };
  return cache;
}

/** Bugünkü toplam (USD) ve çağrı sayısı. */
export function spentToday() {
  const c = loadToday();
  return { day: c.day, usd: Math.round(c.spent * 1e4) / 1e4, calls: c.calls, capUsd: dailyCapUsd() };
}

/** Tavan dolduysa fırlatır (429'a eşlenir). */
export function assertBudget() {
  const cap = dailyCapUsd();
  if (cap == null) return;
  const { usd } = spentToday();
  if (usd >= cap) {
    throw err("BUDGET", `Günlük AI bütçesi doldu: $${usd.toFixed(2)} / $${cap.toFixed(2)} (AI_DAILY_USD). Yarın sıfırlanır.`);
  }
}

/** Çağrı kaydı — başarılı ya da başarısız. Yazılamazsa çağrı etkilenmez. */
export function record(entry) {
  const row = { at: new Date().toISOString(), ...entry };
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.appendFileSync(FILE(), JSON.stringify(row) + "\n");
  } catch { /* defter yazılamadı */ }
  const c = loadToday();
  if (c.day === row.at.slice(0, 10)) {
    c.spent += Number(row.costUsd) || 0;
    c.calls++;
  }
  return row;
}

// ---- eşzamanlılık
const MAX = () => {
  const n = Number(process.env.AI_MAX_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 8) : 2;
};
const QUEUE_LIMIT = 4;
let running = 0;
const waiting = [];

/**
 * Bir AI çağrısını eşzamanlılık kapısından geçirir. Kapı doluysa kısa kuyruk;
 * kuyruk da doluysa BUSY (429). Kuyruktakiler FIFO.
 */
export async function withSlot(fn) {
  if (running >= MAX()) {
    if (waiting.length >= QUEUE_LIMIT) {
      throw err("BUSY", `Aynı anda ${MAX()} AI çağrısı sürüyor ve kuyruk dolu — biraz sonra tekrar dene.`);
    }
    await new Promise((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    const next = waiting.shift();
    if (next) next();
  }
}

/** Test/teşhis: anlık kapı durumu. */
export const slotState = () => ({ running, waiting: waiting.length, max: MAX() });
