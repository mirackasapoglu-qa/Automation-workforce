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

/** Terminal süslerini at; boşlukları da at (TUI kelimeleri imleç hareketiyle diziyor). */
const plain = (s) => String(s)
  .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
  .replace(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const squash = (s) => plain(s).replace(/\s+/g, "").toLowerCase();

/** Bekleyen girişler (bellek): { id, child, raw, label, at }. */
const PENDING = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [k, v] of PENDING) {
    if (now - v.at > LOGIN_TTL_MS) { try { v.child.kill("SIGKILL"); } catch { /* bitmis */ } PENDING.delete(k); }
  }
};

const waitFor = (fn, ms) => new Promise((res) => {
  const t0 = Date.now();
  (function tick() {
    let v = null;
    try { v = fn(); } catch { v = null; }
    if (v) return res(v);
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
  if (PENDING.size >= 3) throw err("BUSY", "Aynı anda en fazla 3 giriş akışı bekleyebilir.");

  const bin = claudeBin ?? which("claude");
  const loginId = `login-${Date.now().toString(36)}`;
  // Gecici yapilandirma: token cikana kadar kalici bir dizin acmiyoruz.
  const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "claude-login-"));
  const child = spawn("script", ["-qec", `${bin} setup-token`, "/dev/null"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmpCfg, CLAUDE_CODE_OAUTH_TOKEN: "", TERM: "dumb", NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const state = { id: loginId, child, raw: "", label, at: Date.now(), tmpCfg };
  child.stdout.on("data", (d) => { state.raw += d; });
  child.stderr.on("data", (d) => { state.raw += d; });
  child.on("error", (e) => { state.raw += `\n[relay] ${e.message}`; });
  PENDING.set(loginId, state);

  const url = await waitFor(() => state.raw.match(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)/)?.[1] ?? null, URL_TIMEOUT_MS);
  if (!url) {
    try { child.kill("SIGKILL"); } catch { /* bitmis */ }
    PENDING.delete(loginId);
    const son = plain(state.raw).split("\n").map((s) => s.trim()).filter(Boolean).slice(-2).join(" · ");
    throw err("NO_URL", `Giriş adresi alınamadı${son ? `: ${son}` : " (CLI yanıt vermedi)"}`);
  }
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
  const c = String(code ?? "").trim();
  if (!c) throw err("BAD_INPUT", "Kod boş.");
  if (!/^[\w#.\-=/+]{6,300}$/.test(c)) throw err("BAD_INPUT", "Kod biçimi geçersiz (tarayıcıdaki kodun tamamını kopyala).");

  const before = state.raw.length;
  state.raw = "";
  try { state.child.stdin.write(`${c}\r`); } catch { throw err("EXPIRED", "Giriş süreci kapanmış — yeniden başlat."); }

  const sonuc = await waitFor(() => {
    const tok = state.raw.match(TOKEN_RE)?.[0];
    if (tok) return { tok };
    const t = squash(state.raw);
    if (/invalidcode|oautherror|expired|denied|failed/.test(t)) return { hata: plain(state.raw).split("\n").map((s) => s.trim()).filter(Boolean).slice(-1)[0] || "kod reddedildi" };
    return null;
  }, CODE_TIMEOUT_MS);

  if (!sonuc) throw err("TIMEOUT", "Kod gönderildi ama yanıt gelmedi — kodu yeniden dene.");
  if (sonuc.hata) throw err("BAD_CODE", `Kod kabul edilmedi: ${sonuc.hata}`);

  const out = save({ label: state.label, token: sonuc.tok, source: "relay" });
  cancelLogin(loginId);
  void before;
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
