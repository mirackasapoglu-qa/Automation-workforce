/**
 * Minik terminal öykünücüsü — ham pty akışından EKRANIN GERÇEK HÂLİNİ üretir.
 *
 * NEDEN: Claude Code'un TUI'si ekranı satır satır yazmıyor, **imleci
 * konumlandırarak boyuyor**. Ölçüldü 2026-09-10 (canlı döküm):
 *
 *   \e[1C\e[2B sk-ant-\e[…  \e[K token\e[19G(valid\e[26Gfor\e[30G1\e[32Gyear):
 *
 * Yani token'ın baytları, kendi başlık satırının ("Your OAuth token (valid
 * for 1 year):") baytlarının ARASINA giriyor. Akışı düz metin sayan her
 * ayrıştırma bu yüzden yanılıyor: bizim "başlık ile 'Store this token'
 * arasını al" mantığımız çuvalladı, satır bazlı okuma da token'a bitişik
 * kelime yapıştırma riski taşıyordu.
 *
 * Çözüm: baytları bir terminal gibi işleyip satır tamponu kurmak. O zaman
 * token EKRANDA olduğu gibi, kendi satırında, tek parça çıkıyor ve okuma
 * heuristik olmaktan çıkıyor.
 *
 * Kapsam bilinçli olarak DAR — yalnız bir TUI'nin ekran boyamak için
 * kullandıkları: imleç hareketi (CUU/CUD/CUF/CUB/CHA/CUP/VPA), satır ve ekran
 * silme (EL/ED), DECSC/DECRC (ESC7/ESC8), satır başı/satır sonu, geri silme.
 * Renk/mod dizileri (SGR, `?` ile başlayan özel modlar) görünmez oldukları
 * için ATLANIR. Kaydırma (scroll), çift genişlikli karakter ve alternatif
 * ekran YOK: bu iş için gerekmiyor, olsaydı sessizce yanlış sonuç üretebilirdi.
 */

const MAX_ROWS = 500;
const MAX_COLS = 2000;
const clamp = (n, max) => Math.max(0, Math.min(n, max));

/**
 * Ham akışı ekran metnine çevirir.
 * @param {string} raw pty'den gelen ham bayt dizisi
 * @returns {string} satırları `\n` ile ayrılmış ekran içeriği
 */
export function renderScreen(raw) {
  const s = String(raw ?? "");
  /** @type {string[][]} */
  const grid = [];
  let r = 0, c = 0;
  let kayitli = null;   // DECSC/DECRC

  const satir = (i) => { while (grid.length <= i && grid.length < MAX_ROWS) grid.push([]); return grid[Math.min(i, MAX_ROWS - 1)] ?? []; };
  const yaz = (ch) => {
    if (r >= MAX_ROWS || c >= MAX_COLS) return;
    const l = satir(r);
    while (l.length < c) l.push(" ");
    l[c] = ch;
    c += 1;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === "\x1b") {
      const next = s[i + 1];
      // CSI: ESC [ <parametre 0x30-0x3f> <ara 0x20-0x2f> <bitiş 0x40-0x7e>
      if (next === "[") {
        let j = i + 2;
        while (j < s.length && s[j] >= "\x30" && s[j] <= "\x3f") j++;
        while (j < s.length && s[j] >= "\x20" && s[j] <= "\x2f") j++;
        const final = s[j];
        const params = s.slice(i + 2, j);
        i = j;                                   // bitiş baytını da yut
        if (params.startsWith("?")) continue;    // özel modlar (imleç gizle vb.)
        const p = params.split(";").map((x) => (x === "" ? null : Number(x)));
        const n = (k = 0, d = 1) => clamp(Number.isFinite(p[k]) && p[k] !== null ? p[k] : d, MAX_COLS);
        switch (final) {
          case "A": r = clamp(r - n(), MAX_ROWS); break;
          case "B": r = clamp(r + n(), MAX_ROWS); break;
          case "C": c = clamp(c + n(), MAX_COLS); break;
          case "D": c = clamp(c - n(), MAX_COLS); break;
          case "E": r = clamp(r + n(), MAX_ROWS); c = 0; break;
          case "F": r = clamp(r - n(), MAX_ROWS); c = 0; break;
          case "G": c = clamp(n() - 1, MAX_COLS); break;
          case "d": r = clamp(n() - 1, MAX_ROWS); break;
          case "H": case "f": r = clamp(n(0) - 1, MAX_ROWS); c = clamp(n(1) - 1, MAX_COLS); break;
          case "K": {                            // satırda silme
            const l = satir(r);
            const mod = n(0, 0);
            if (mod === 0) l.length = Math.min(l.length, c);
            else if (mod === 1) for (let k = 0; k <= c && k < l.length; k++) l[k] = " ";
            else l.length = 0;
            break;
          }
          case "J": {                            // ekranda silme
            const mod = n(0, 0);
            if (mod === 2 || mod === 3) grid.length = 0;
            else if (mod === 0) { satir(r).length = Math.min(satir(r).length, c); grid.length = Math.min(grid.length, r + 1); }
            break;
          }
          default: break;                        // SGR ve diğerleri: görünmez
        }
        continue;
      }
      // OSC / DCS / PM / APC — kendi sonlandırıcısına kadar yut.
      if (next === "]" || next === "P" || next === "^" || next === "_" || next === "X") {
        let j = i + 2;
        while (j < s.length && !(s[j] === "\x07" || (s[j] === "\x1b" && s[j + 1] === "\\"))) j++;
        i = s[j] === "\x1b" ? j + 1 : j;
        continue;
      }
      // Karakter kümesi seçimi: ESC ( B
      if (next === "(" || next === ")" || next === "*" || next === "+") { i += 2; continue; }
      if (next === "7") { kayitli = { r, c }; i += 1; continue; }          // DECSC
      if (next === "8") { if (kayitli) ({ r, c } = kayitli); i += 1; continue; } // DECRC
      i += 1;                                    // diğer iki karakterli diziler
      continue;
    }

    // ⚠️ LF hem satır atlar hem SÜTUNU SIFIRLAR. Gerçek terminalde LF sütunu
    // korur (CR ayrı iş yapar) ama pty'den okuduğumuz akışta satır sonu ya
    // `\r\n` olarak geliyor ya da uygulama konumu zaten açıkça veriyor;
    // sütunu korumak, `\n` ile ayrılmış satırların ikincisini ekranın
    // ortasına kaydırıp okumayı bozuyordu.
    if (ch === "\n") { r = clamp(r + 1, MAX_ROWS); c = 0; continue; }
    if (ch === "\r") { c = 0; continue; }
    if (ch === "\b") { c = clamp(c - 1, MAX_COLS); continue; }
    if (ch === "\t") { c = clamp(c + (8 - (c % 8)), MAX_COLS); continue; }
    if (ch < " " || ch === "\x7f") continue;     // diğer kontrol karakterleri
    yaz(ch);
  }

  return grid.map((l) => l.join("").replace(/\s+$/, "")).join("\n");
}
