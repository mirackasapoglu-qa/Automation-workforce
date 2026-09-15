// Test case ÜRETİM DURUMU — sidebar'daki "Test Repository" rozetinin tek kaynağı.
//
// NEDEN: üretim (~15-40 sn) arka planda sürüyor; kullanıcı bu arada Test
// Repository sayfasına ya da başka görünüme geçiyor ve "bitti mi?" sorusunun
// cevabı yalnızca sağ alttaki toast'taydı — kapatılınca iz kalmıyordu.
// Şimdi: sürerken sidebar öğesinde nabız, bitince yeşil "üretildi" rozeti;
// rozet Test Repository görünümüne girildiğinde söner (bildirim deseni).
//
// Yayıncı: testcase-request.js (tek tık + elle yol). Abone: shell.js.
// shell.js ↔ testcase-request.js zaten birbirine bağlı; durum ayrı modülde
// ki döngüsel içe alma büyümesin.

const dinleyiciler = new Set();

/** running: sürmekte olan istek sayısı · unseen: henüz bakılmamış üretimden yazılan case sayısı. */
export const genStatus = { running: 0, unseen: 0, unseenRuns: 0, lastAt: null };

export function onGenStatus(fn) { dinleyiciler.add(fn); return () => dinleyiciler.delete(fn); }
function yay() { for (const fn of dinleyiciler) { try { fn(genStatus); } catch (e) { console.warn('gen-status dinleyicisi:', e); } } }

/** Model çağrısı başladı (tek tık yolu). */
export function genStarted() { genStatus.running++; yay(); }

/** Model çağrısı bitti — başarı/başarısızlık fark etmez, nabız durur. */
export function genEnded() { genStatus.running = Math.max(0, genStatus.running - 1); yay(); }

/**
 * Ağaca case yazıldı (iki yol da). `written` 0 olabilir (hepsi tekrar diye
 * atlandı) — rozet yine çıkar: "bitti" haberi sayıdan bağımsız.
 */
export function genProduced(written = 0) {
  genStatus.unseen += Math.max(0, Number(written) || 0);
  genStatus.unseenRuns++;
  genStatus.lastAt = Date.now();
  yay();
}

/** Kullanıcı Test Repository görünümüne baktı — rozet söner. */
export function genSeen() {
  if (!genStatus.unseen && !genStatus.unseenRuns) return;
  genStatus.unseen = 0; genStatus.unseenRuns = 0;
  yay();
}
