/**
 * Makinede kurulu Claude Code CLI'sini panel adına çağırır — "tek tık" yolu.
 *
 * NEDEN BU YOL: panelin kendi model çağrısı bir API anahtarı istiyordu ve bu
 * yüzden kaldırıldı (bkz. scenario-suggest.mjs başlığı). Kopyala-yapıştır turu
 * anahtarsızdı ama üç adım sürüyordu. CLI zaten kullanıcının Claude Code
 * oturumuyla kimlikli: panel ikinci bir kimlik taşımadan tek adıma iniyor.
 *
 * KURALLAR:
 *  - `--allowedTools ""` → model ARAÇ KULLANMAZ. İstemi biz kuruyoruz, modelin
 *    repoda dolaşmasına gerek yok; araçlar açık kalsa koşum başlatmak ya da
 *    dosya yazmak gibi yan etkiler mümkün olurdu.
 *  - cwd olarak repo DEĞİL geçici dizin veriliyor: repo kökünde çağrıldığında
 *    CLI proje CLAUDE.md'sini ve skill'leri yükleyip her isteğe ~11k token
 *    ekliyor (ölçüldü). İstem kendi bağlamını taşıyor, bu yüzden gereksiz.
 *  - Zaman aşımı var ve süreç öldürülüyor: askıda kalan bir çağrı paneli
 *    süresiz bekletirdi.
 *  - Kimlik/PATH sorunları AYRI kodla dönüyor (NO_CLI): "üretim başarısız"
 *    yerine ne yapılacağını söyleyebilmek için.
 */
import { spawn } from "node:child_process";
import os from "node:os";

const BIN = process.env.CLAUDE_BIN || "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 240_000);

export const CLI_HINT =
  "Claude Code CLI bulunamadı. Panel bu yolu kullanabilmek için `claude` " +
  "komutunun PATH'te olması gerekiyor (kurulum: npm i -g @anthropic-ai/claude-code). " +
  "Farklı bir konumdaysa CLAUDE_BIN ile yolu ver. Bu arada 'İstem üret' ile " +
  "kopyala-yapıştır yolu çalışmaya devam eder.";

/**
 * Kullanım/limit hatasını ayırt eder: kullanıcıya "tekrar dene" demek yerine
 * hangi hesabın limitinin dolduğunu ve ne zaman açılacağını söyleyebilelim.
 * Hesaplar arası OTOMATİK GEÇİŞ YOK (abonelik paylaşımı) — seçim insana kalır.
 */
const LIMIT_RE = /(usage limit|rate limit|limit reached|too many requests|quota|resets? at|try again (later|in))/i;

/**
 * @param {string} prompt tam istem (bağlamı içinde taşımalı)
 * @param {{env?: object, bin?: string, account?: {id:string,label:string}}} [opt]
 *   env     → hesaba özgü ortam (CLAUDE_CODE_OAUTH_TOKEN + CLAUDE_CONFIG_DIR)
 *   account → hata mesajlarında ve defterde görünecek hesap
 * @returns {Promise<{text: string, costUsd: number|null, durationMs: number, model: string|null, models: string[]|null, sessionId: string|null}>}
 */
export function askClaude(prompt, { env = null, bin = null, account = null } = {}) {
  if (!prompt || !String(prompt).trim())
    return Promise.reject(new Error("istem boş"));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        bin || BIN,
        ["-p", "--output-format", "json", "--allowedTools", ""],
        {
          cwd: os.tmpdir(),
          /*
           * Hesap ortamı: `CLAUDE_CODE_OAUTH_TOKEN` + `CLAUDE_CONFIG_DIR`.
           * Verilmezse sürecin kendi ortamı (geliştiricinin kendi oturumu).
           */
          env: env ? { ...process.env, ...env } : process.env,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (e) {
      const err = new Error(CLI_HINT);
      err.code = "NO_CLI";
      return reject(err);
    }

    const t0 = Date.now();
    let out = "";
    let err = "";
    let bitti = false;

    const timer = setTimeout(() => {
      if (bitti) return;
      bitti = true;
      child.kill("SIGKILL");
      const e = new Error(
        `Claude Code CLI ${Math.round(TIMEOUT_MS / 1000)} sn içinde yanıt vermedi.`,
      );
      e.code = "TIMEOUT";
      reject(e);
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    child.on("error", (e) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(timer);
      const isMissing = e.code === "ENOENT";
      const wrapped = new Error(isMissing ? CLI_HINT : `CLI hatası: ${e.message}`);
      wrapped.code = isMissing ? "NO_CLI" : "CLI_ERROR";
      reject(wrapped);
    });

    child.on("close", (code) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(timer);
      if (code !== 0) {
        const ham = (err || out).slice(0, 300);
        const e = new Error(
          LIMIT_RE.test(ham)
            ? `${account ? `"${account.label}" hesabının` : "Hesabın"} kullanım limiti dolmuş görünüyor: ${ham}`
            : `CLI ${code} koduyla çıktı: ${ham}`,
        );
        e.code = LIMIT_RE.test(ham) ? "RATE_LIMIT" : "CLI_ERROR";
        e.account = account?.label ?? null;
        return reject(e);
      }
      let zarf;
      try {
        zarf = JSON.parse(out);
      } catch {
        // Zarf okunamadıysa ham çıktıyı metin sayıyoruz: sürüm farkında
        // biçim değişse bile üretim tamamen çökmesin.
        return resolve({
          text: out.trim(),
          costUsd: null,
          durationMs: Date.now() - t0,
          model: null,
          sessionId: null,
        });
      }
      if (zarf.is_error) {
        const ham = String(zarf.result ?? "").slice(0, 300);
        const limit = LIMIT_RE.test(ham);
        const e = new Error(
          limit
            ? `${account ? `"${account.label}" hesabının` : "Hesabın"} kullanım limiti dolmuş görünüyor: ${ham}`
            : `CLI hata döndürdü: ${ham}`,
        );
        e.code = limit ? "RATE_LIMIT" : "CLI_ERROR";
        e.account = account?.label ?? null;
        return reject(e);
      }
      /*
       * `modelUsage` birden fazla model içerebilir (CLI alt görevler için
       * küçük model kullanıyor). "İlk anahtar" yanıltıcıydı (ölçüldü: 3 case
       * üretiminde haiku görünüyordu) — asıl üretimi yapan, en çok çıktı
       * token'ı olan modeldir; hepsi `models` ile ayrıca verilir.
       */
      const usage = zarf.modelUsage ?? {};
      const models = Object.keys(usage);
      const outTok = (m) => Number(usage[m]?.outputTokens ?? usage[m]?.output_tokens ?? 0);
      const model = models.length ? models.reduce((a, b) => (outTok(b) > outTok(a) ? b : a)) : null;
      resolve({
        text: String(zarf.result ?? ""),
        costUsd: typeof zarf.total_cost_usd === "number" ? zarf.total_cost_usd : null,
        durationMs: Date.now() - t0,
        model,
        models,
        sessionId: zarf.session_id ?? null,
      });
    });

    /*
     * ⚠️ stdin'de HATA DINLEYICISI ŞART. CLI istemi okumadan çıkarsa (bozuk
     * token, sürüm uyuşmazlığı, çökme) boruya yazmak `EPIPE` üretir; dinleyici
     * yoksa Node bunu YAKALANMAMIŞ hata sayar ve PANELİN TAMAMI düşer
     * (ölçüldü 2026-09-10: sahte CLI ile sunucu süreci öldü, ECONNREFUSED).
     * Koşum motorundaki `child.on("error")` ile aynı sınıf hata — burada da
     * yutulmaz, sebep close handler'ında raporlanır.
     */
    child.stdin.on("error", (e) => {
      err += `\n[stdin] ${e.code === "EPIPE" ? "CLI istemi okumadan çıktı (EPIPE)" : e.message}`;
    });
    try {
      child.stdin.end(String(prompt));
    } catch (e) {
      err += `\n[stdin] ${e.message}`;
    }
  });
}

/**
 * Modelin döndürdüğü metinden JSON çıkarır.
 * Model bazen ``` bloğuna sarıyor ya da öncesine bir cümle ekliyor — ikisi de
 * `JSON.parse`'ı patlatıyordu, o yüzden ilk `{`–son `}` aralığına düşülüyor.
 */
export function parseJsonLoose(text) {
  const ham = String(text ?? "").trim();
  const soyulmus = ham
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(soyulmus);
  } catch {
    const bas = soyulmus.indexOf("{");
    const son = soyulmus.lastIndexOf("}");
    if (bas === -1 || son <= bas)
      throw new Error(`Model JSON döndürmedi: ${soyulmus.slice(0, 200)}`);
    return JSON.parse(soyulmus.slice(bas, son + 1));
  }
}
