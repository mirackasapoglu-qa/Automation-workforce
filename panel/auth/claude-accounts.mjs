/**
 * Claude hesapları — kişi başına abonelik kimliği, sunucuda saklanır.
 *
 * NEDEN: API anahtarı herkeste yok; ekip kendi Claude aboneliğiyle çalışmak
 * istiyor. Anthropic'in bunun için belgelediği yol `claude setup-token`:
 * tarayıcıda kendi hesabınla girersin, bir yıllık bir OAuth token'ı çıkar,
 * `CLAUDE_CODE_OAUTH_TOKEN` ile Claude Code onu kullanır. Panel token'ı SAKLAR
 * ve her koşumda CLI'ye verir; token'la doğrudan API'ye GİTMEZ (izin verilen
 * kullanım bu).
 *
 * İKİ EKLEME YOLU (ikisi de aynı depoya yazar):
 *   1) RELAY — panel sunucuda `claude setup-token`'ı sözde terminalde (pty)
 *      başlatır, Anthropic'in giriş adresini karta koyar; kişi kendi
 *      tarayıcısında girer, dönen kodu panele yapıştırır, panel kodu bekleyen
 *      sürece iletir ve çıkan token'ı kaydeder. Kişinin makinesine kurulum yok.
 *   2) YAPIŞTIR — kişi kendi makinesinde `claude setup-token` çalıştırıp
 *      token'ı panele yapıştırır. Her yerde çalışır; relay yoksa tek yol budur.
 *
 * ⚠️ RELAY YALNIZ POSIX + `script` + CLI VARSA. `setup-token` boru üzerinde
 * HİÇBİR ŞEY basmıyor (ölçüldü 2026-09-10), gerçek terminal şart; Node'da
 * yerleşik pty yok ve `node-pty` yerel derleme ister (sıfır bağımlılık kuralı).
 * Çözüm `script(1)`: Linux'ta (util-linux, Debian imajında hazır)
 * `script -qec "<komut>" /dev/null` boru stdin ile çalışır. macOS'un BSD
 * `script`i stdin'in TTY olmasını istiyor ve borulu çağrıda
 * "tcgetattr/ioctl: Operation not supported on socket" ile düşüyor (ölçüldü) —
 * bu yüzden macOS'ta relay KAPALI, panel yapıştırma yolunu gösterir.
 *
 * ⚠️ HESAPLAR ARASI OTOMATİK GEÇİŞ YOK. Her token bir kişinin aboneliğidir;
 * limit dolunca başkasının hesabına düşmek hesap paylaşımıdır ve sözleşmeye
 * aykırıdır. Limit hatası hesabın adıyla gösterilir, seçim insana kalır.
 *
 * Depo: `panel-data/claude/accounts/<id>.json` (0600) — token yalnız burada.
 * Yapılandırma: `panel-data/claude/config/<id>/` — her hesabın kendi oturumu,
 * ayarları ve geçmişi ayrı (CLAUDE_CONFIG_DIR).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/** `sk-ant-oat01-…` — setup-token çıktısı. */
export const TOKEN_RE = /sk-ant-oat[\w-]{20,}/;
const ID_RE = /^claude-\d+$/;
const LOGIN_TTL_MS = 10 * 60_000;
const URL_TIMEOUT_MS = Number(process.env.CLAUDE_LOGIN_URL_TIMEOUT_MS || 45_000);
const CODE_TIMEOUT_MS = Number(process.env.CLAUDE_LOGIN_CODE_TIMEOUT_MS || 60_000);
const MAX_PENDING = 3;
/** Süreç öldükten sonra son çıktının pty'den boşalması için tanınan süre. */
const EXIT_GRACE_MS = Number(process.env.CLAUDE_LOGIN_EXIT_GRACE_MS || 400);
/**
 * Pty genişliği. Ink metni TERMİNAL GENİŞLİĞİNDE kendisi kırıyor: ölçüldü
 * 2026-09-10, varsayılan pty 80 sütun ve 346 karakterlik giriş adresi ekrana
 * 5 satır hâlinde iniyor. Aynı kırılma token'a da uygulanır ve ekrandan
 * okunan token SESSİZCE KIRPILIR (kayıt geçerli görünür, her `claude -p`
 * çağrısı sonra "geçersiz token" der). `stty cols` pty'yi genişletir.
 */
const PTY_COLS = Number(process.env.CLAUDE_LOGIN_PTY_COLS || 400);

const root = () => process.cwd();
export const accountsDir = () => path.join(root(), "panel-data", "claude", "accounts");
export const configDir = (id) => path.join(root(), "panel-data", "claude", "config", id);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

const err = (code, message) => Object.assign(new Error(message), { code });

// ---------------------------------------------------------------- depo

/** Hesap kayıtları (token DAHİL) — yalnız bu modül içinde kullanılır. */
function records() {
  let files = [];
  try { files = fs.readdirSync(accountsDir()).filter((f) => f.endsWith(".json")); } catch { return []; }
  return files
    .map((f) => readJson(path.join(accountsDir(), f)))
    .filter((r) => r?.id && r?.token)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** Panele/arayüze giden liste — TOKEN YOK. */
export function list() {
  return records().map(({ token, ...r }) => ({
    ...r,
    tokenTail: `…${String(token).slice(-4)}`,
    expired: r.expiresAt ? Date.parse(r.expiresAt) < Date.now() : false,
  }));
}

export const count = () => records().length;
export const has = (id) => records().some((r) => r.id === id);

function nextId() {
  const used = new Set(records().map((r) => Number(r.id.split("-")[1])));
  let n = 1;
  while (used.has(n)) n++;
  return `claude-${n}`;
}

/**
 * Hesabı kaydeder. Etiket "kimin hesabı" — panelde bu görünür, token değil.
 * @returns {{id:string,label:string}}
 */
export function save({ id, label, token, source = "paste" }) {
  const t = String(token ?? "").trim();
  if (!TOKEN_RE.test(t)) throw err("BAD_TOKEN", "Token biçimi beklenen gibi değil (sk-ant-oat… olmalı).");
  const clean = t.match(TOKEN_RE)[0];
  if (records().some((r) => r.token === clean)) throw err("DUPLICATE", "Bu token zaten kayıtlı.");
  const useId = id && ID_RE.test(id) ? id : nextId();
  const rec = {
    id: useId,
    label: String(label ?? "").trim().slice(0, 60) || useId,
    token: clean,
    source,
    createdAt: new Date().toISOString(),
    // setup-token bir yıllık; kesin tarihi CLI vermiyor, kayıt tarihinden türetiyoruz.
    expiresAt: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
    lastUsedAt: null,
  };
  fs.mkdirSync(configDir(useId), { recursive: true });
  writeJson(path.join(accountsDir(), `${useId}.json`), rec);
  return { id: rec.id, label: rec.label };
}

export function rename(id, label) {
  const f = path.join(accountsDir(), `${id}.json`);
  const rec = readJson(f);
  if (!rec) throw err("NOT_FOUND", `Hesap yok: ${id}`);
  rec.label = String(label ?? "").trim().slice(0, 60) || rec.id;
  writeJson(f, rec);
  return { id, label: rec.label };
}

/** Hesabı ve yapılandırma dizinini siler. Token'ı claude.ai'den de iptal etmek kullanıcıya kalır. */
export function remove(id) {
  let removed = false;
  try { fs.unlinkSync(path.join(accountsDir(), `${id}.json`)); removed = true; } catch { /* yok */ }
  try { fs.rmSync(configDir(id), { recursive: true, force: true }); } catch { /* yok */ }
  return { ok: true, removed };
}

export function touch(id) {
  const f = path.join(accountsDir(), `${id}.json`);
  const rec = readJson(f);
  if (!rec) return;
  rec.lastUsedAt = new Date().toISOString();
  writeJson(f, rec);
}

/**
 * Bir hesabın çalıştırma ortamı: token + kendi yapılandırma dizini.
 * `id` verilmezse ilk hesap (tek hesaplı kurulumda seçim derdi olmasın).
 * @returns {{env:object, id:string, label:string}|null}
 */
export function envFor(id = null) {
  const all = records();
  if (!all.length) return null;
  const rec = id ? all.find((r) => r.id === id) : all[0];
  if (!rec) throw err("NOT_FOUND", `Hesap yok: ${id}`);
  fs.mkdirSync(configDir(rec.id), { recursive: true });
  return {
    id: rec.id,
    label: rec.label,
    env: { CLAUDE_CODE_OAUTH_TOKEN: rec.token, CLAUDE_CONFIG_DIR: configDir(rec.id) },
  };
}

// ---------------------------------------------------------------- relay

const which = (bin) => {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, bin);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* yok */ }
  }
  return null;
};

/**
 * Panelden giriş mümkün mü. macOS'ta BSD `script` borulu stdin ile pty
 * açamıyor (ölçüldü) — orada yalnız yapıştırma yolu var.
 * @returns {{ok:boolean, reason?:string}}
 */
export function relaySupported({ claudeBin } = {}) {
  if (process.platform !== "linux") {
    return { ok: false, reason: `panelden giriş yalnız Linux sunucuda (bu makine: ${process.platform}) — token'ı kendi makinende üretip yapıştır` };
  }
  if (!which("script")) return { ok: false, reason: "`script` komutu yok (Debian: bsdutils) — yapıştırma yolunu kullan" };
  if (!(claudeBin ?? which("claude"))) return { ok: false, reason: "Claude Code CLI kurulu değil — yapıştırma yolunu kullan" };
  return { ok: true };
}

/**
 * Terminal süslerini at. ⚠️ İmleç-ileri dizisi (`ESC[<n>C`) BOŞLUĞA çevrilir:
 * TUI kelimeleri boşluk yazmak yerine imleci ilerleterek diziyor, düz atılınca
 * ekran "Requstfailed withstatus code" gibi yapışık çıkıyordu (ölçüldü).
 */
const plain = (s) => String(s)
  .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
  .replace(/\x1b\[(\d*)C/g, (_, n) => " ".repeat(Math.min(Number(n || 1), 200)))
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
  .replace(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const squash = (s) => plain(s).replace(/\s+/g, "").toLowerCase();

/** Ekranı kullanıcıya gösterirken token'ı maskele — hata metni loglara da düşer. */
const maskToken = (s) => String(s).replace(/sk-ant-oat[\w-]+/g, (m) => `sk-ant-oat…${m.slice(-4)}`);

/**
 * Ekranın son anlamlı satırları — HER hata bunu taşır.
 * Eskiden zaman aşımında kullanıcıya yalnız "yanıt gelmedi" deniyordu; CLI
 * ekranda sebebi yazarken (ör. abonelik yok) panel onu hiç göstermiyordu.
 */
export const screenTail = (raw, n = 3) => maskToken(plain(raw))
  .split("\n").map((s) => s.trim())
  // Yildizla maskelenmis girdi yankisi ATILIR: yapistirilan kodun kuyrugu
  // hata mesajina (ve denetim kaydina) sizmasin.
  .filter((s) => s && !s.includes("***") && !/Paste code here/i.test(s))
  .slice(-n).join(" · ").slice(0, 400);

/**
 * Token'ı ekrandan okur. İki tuzak birden:
 *  1) Ham akışta ANSI dizileri var → önce `plain()`.
 *  2) Ink token'ı terminal genişliğinde kırabilir → satır TAM genişlikte
 *     bitiyorsa ve SONRAKİ SATIRIN TAMAMI token karakteriyse birleştir.
 *     ("Store this token securely." gibi boşluklu satır birleştirilmez.)
 * Satırın bittiğini görmeden (ya da süreç kapanmadan) token kabul edilmez:
 * yarım basılmış bir kare kırpılmış token verirdi.
 * @returns {string|null}
 */
export function tokenFromScreen(raw, { exited = false } = {}) {
  const lines = plain(raw).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/sk-ant-oat[\w-]+/);
    if (!m) continue;
    let tok = m[0];
    let j = i;
    // Satırın sonuna dayanan token kırılmış olabilir; devamı sonraki satırdadır.
    let kirilmis = lines[i].endsWith(m[0]) && lines[i].length >= 60;
    while (kirilmis && j + 1 < lines.length && /^[\w-]+$/.test(lines[j + 1])) {
      tok += lines[j + 1];
      j += 1;
      kirilmis = lines[j].length >= 60;
    }
    const satirBitti = j + 1 < lines.length || exited;
    if (satirBitti && TOKEN_RE.test(tok)) return tok;
  }
  return null;
}

/** Bekleyen girişler (bellek): { id, child, raw, label, at, url, exit }. */
const PENDING = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [k, v] of PENDING) {
    if (now - v.at > LOGIN_TTL_MS) { try { v.child.kill("SIGKILL"); } catch { /* bitmis */ } PENDING.delete(k); }
  }
};

/**
 * `fn` bir değer dönene kadar bekler. `state` verilirse SÜREÇ KAPANDIĞINDA da
 * biter: CLI hatayı basıp çıktığında (ör. hesap askıda) eskiden tam zaman
 * aşımı kadar boşuna bekleniyordu.
 */
const waitFor = (fn, ms, state = null) => new Promise((res) => {
  const t0 = Date.now();
  (function tick() {
    let v = null;
    try { v = fn(); } catch { v = null; }
    if (v) return res(v);
    if (state?.exit && Date.now() - state.exit.at > EXIT_GRACE_MS) return res(null);
    if (Date.now() - t0 > ms) return res(null);
    setTimeout(tick, 120);
  })();
});

/**
 * Girişi başlatır: `claude setup-token` pty'de koşar, Anthropic'in giriş
 * adresi yakalanır. Adres OSC-8 köprü dizisinden okunur — ekrandaki metin
 * satırlara bölünüyor, köprüdeki adres TAM.
 *
 * @returns {Promise<{loginId:string, url:string}>}
 */
export async function startLogin({ label, claudeBin } = {}) {
  sweep();
  const sup = relaySupported({ claudeBin });
  if (!sup.ok) throw err("NO_RELAY", sup.reason);
  // Terk edilmis akis yeni girisi ENGELLEMEZ: doluysa en eskisi dusurulur.
  // (Sayfa yenilenince loginId tarayicidan gidiyordu; uc terk edilmis akis
  // "Hesap ekle"yi 10 dk boyunca 429 BUSY ile kilitliyordu — olculdu.)
  while (PENDING.size >= MAX_PENDING) {
    const eski = [...PENDING.values()].sort((a, b) => a.at - b.at)[0];
    cancelLogin(eski.id);
  }

  const bin = claudeBin ?? which("claude");
  const loginId = `login-${Date.now().toString(36)}`;
  // Gecici yapilandirma: token cikana kadar kalici bir dizin acmiyoruz.
  const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "claude-login-"));
  // `stty` pty'yi genisletir → Ink token'i satira sigdirir (bkz. PTY_COLS).
  const komut = `stty cols ${PTY_COLS} rows 60 2>/dev/null; '${String(bin).replace(/'/g, "'\\''")}' setup-token`;
  const child = spawn("script", ["-qec", komut, "/dev/null"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmpCfg, CLAUDE_CODE_OAUTH_TOKEN: "", TERM: "dumb", NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const state = { id: loginId, child, raw: "", label, at: Date.now(), tmpCfg, url: null, exit: null };
  child.stdout.on("data", (d) => { state.raw += d; });
  child.stderr.on("data", (d) => { state.raw += d; });
  child.on("error", (e) => { state.raw += `\n[relay] ${e.message}`; });
  // ⚠️ Cikis izlenmezse hata ekrani basip olen CLI icin tam zaman asimi beklenir.
  child.on("exit", (code, signal) => { state.exit = { code, signal, at: Date.now() }; });
  // stdin'de dinleyici yoksa CLI istemi okumadan olunce EPIPE PANELI DUSURUR
  // (ayni sinif hata `claude-cli.mjs`de olculmustu).
  child.stdin.on("error", (e) => { state.raw += `\n[relay] stdin: ${e.message}`; });
  PENDING.set(loginId, state);

  const url = await waitFor(
    () => state.raw.match(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)/)?.[1] ?? null,
    URL_TIMEOUT_MS,
    state,
  );
  if (!url) {
    const son = screenTail(state.raw, 2);
    cancelLogin(loginId);
    throw err("NO_URL", `Giriş adresi alınamadı${son ? `: ${son}` : " (CLI yanıt vermedi)"}`);
  }
  state.url = url;
  return { loginId, url };
}

/**
 * Tarayıcıdan alınan kodu bekleyen sürece iletir ve token'ı yakalar.
 * Geçersiz kodda CLI "Press Enter to retry" diyor ve AYAKTA kalıyor — akış
 * düşürülmez, kullanıcı kodu yeniden yapıştırabilir.
 *
 * @returns {Promise<{id:string,label:string}>}
 */
export async function submitCode(loginId, code) {
  sweep();
  const state = PENDING.get(loginId);
  if (!state) throw err("EXPIRED", "Giriş akışı bulunamadı ya da zaman aşımına uğradı — yeniden başlat.");
  if (state.exit) {
    const son = screenTail(state.raw, 2);
    cancelLogin(loginId);
    throw err("EXPIRED", `Giriş süreci kapanmış${son ? ` — ekran: ${son}` : ""}. Yeniden başlat.`);
  }
  const c = String(code ?? "").trim();
  if (!c) throw err("BAD_INPUT", "Kod boş.");
  if (!/^[\w#.\-=/+]{6,300}$/.test(c)) throw err("BAD_INPUT", "Kod biçimi geçersiz (tarayıcıdaki kodun tamamını kopyala).");

  state.raw = "";
  try { state.child.stdin.write(`${c}\r`); } catch { throw err("EXPIRED", "Giriş süreci kapanmış — yeniden başlat."); }

  const sonuc = await waitFor(() => {
    const tok = tokenFromScreen(state.raw, { exited: !!state.exit });
    if (tok) return { tok };
    // CLI'nin HER hata durumu ekrana "OAuth error: …" basiyor (binary'den
    // dogrulandi); "account_on_hold" ise bu oneki KULLANMIYOR ve surec 500 ms
    // sonra oluyor — o yol asagidaki cikis kontroluyle yakalanir.
    const t = squash(state.raw);
    if (/oautherror|invalidcode/.test(t)) {
      return { hata: screenTail(state.raw, 2) || "kod reddedildi" };
    }
    return null;
  }, CODE_TIMEOUT_MS, state);

  if (!sonuc && state.exit) {
    const son = screenTail(state.raw, 3);
    cancelLogin(loginId);
    throw Object.assign(
      err("CLI_EXIT", `Claude CLI kodu işledi ama token vermeden kapandı${son ? ` — ekranın son satırları: ${son}` : ""}.`
        + " En sık sebebi: hesapta aktif Claude aboneliği yok ya da kuruluş politikası uzun ömürlü abonelik token'ına izin vermiyor (o durumda API anahtarı yolunu kullan)."),
      { alive: false, screen: son },
    );
  }
  if (!sonuc) {
    const son = screenTail(state.raw, 3);
    throw Object.assign(
      err("TIMEOUT", `Kod gönderildi ama ${Math.round(CODE_TIMEOUT_MS / 1000)} sn içinde yanıt gelmedi`
        + `${son ? ` — ekran: ${son}` : " (CLI ekranına hiçbir şey basmadı)"}. Akış açık, kodu yeniden deneyebilirsin.`),
      { alive: true, screen: son },
    );
  }
  if (sonuc.hata) throw Object.assign(err("BAD_CODE", `Kod kabul edilmedi: ${sonuc.hata}`), { alive: !state.exit });

  const out = save({ label: state.label, token: sonuc.tok, source: "relay" });
  cancelLogin(loginId);
  return out;
}

export function cancelLogin(loginId) {
  const state = PENDING.get(loginId);
  if (!state) return { ok: true, removed: false };
  try { state.child.kill("SIGKILL"); } catch { /* bitmis */ }
  try { fs.rmSync(state.tmpCfg, { recursive: true, force: true }); } catch { /* yok */ }
  PENDING.delete(loginId);
  return { ok: true, removed: true };
}

/** Teşhis: bekleyen giriş sayısı. */
export const pendingCount = () => { sweep(); return PENDING.size; };

/**
 * Süren giriş akışları — panel kartı bunları GÖSTERİR ve devam ettirir.
 * Gerekçe: `loginId` yalnız tarayıcı belleğindeydi; sayfa yenilenince akış
 * sunucuda 10 dk yaşamaya devam ediyor ama kullanıcı ne devam edebiliyor ne
 * iptal edebiliyordu ("3 işlem var" der, kartta hiçbir şey görünmezdi).
 * TOKEN YOK, ekran metni YOK — yalnız akışın kimliği, etiketi ve adresi.
 */
export function pendingList() {
  sweep();
  const now = Date.now();
  return [...PENDING.values()]
    .sort((a, b) => a.at - b.at)
    .map((s) => ({
      loginId: s.id,
      label: s.label ?? null,
      url: s.url ?? null,
      startedAt: new Date(s.at).toISOString(),
      ageSec: Math.round((now - s.at) / 1000),
      ttlSec: Math.max(0, Math.round((LOGIN_TTL_MS - (now - s.at)) / 1000)),
      alive: !s.exit,
    }));
}
