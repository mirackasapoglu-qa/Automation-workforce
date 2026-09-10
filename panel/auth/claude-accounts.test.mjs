/**
 * Claude hesapları — depo (her platform) + panelden giriş relay'i (yalnız Linux).
 *
 * Relay testi GERÇEK bir pty kullanır (`script`) ama SAHTE bir `claude`
 * çalıştırır: Anthropic'e hiç gidilmez, gerçek hesap kullanılmaz. macOS'ta
 * BSD `script` borulu stdin ile pty açamadığı için (ölçüldü) o testler atlanır;
 * sunucu Linux olduğu için üretim yolu kapsanmış olur.
 *
 * Koşum: node --test panel/auth/claude-accounts.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-acct-"));
process.chdir(tmp);
// Modul zaman asimlarini yuklenirken okuyor: testte kisa tut (hata yollari 60 sn beklemesin).
process.env.CLAUDE_LOGIN_URL_TIMEOUT_MS = "6000";
process.env.CLAUDE_LOGIN_CODE_TIMEOUT_MS = "8000";
const acc = await import("./claude-accounts.mjs");

const TOKEN = (n) => `sk-ant-oat01-${"x".repeat(30)}${n}`;
const LINUX = process.platform === "linux";

test("kaydet/listele: token yanita SIZMAZ, yalniz son dort hane", () => {
  const out = acc.save({ label: "Murat", token: TOKEN("A") });
  assert.equal(out.id, "claude-1");
  assert.equal(out.label, "Murat");
  const list = acc.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].token, undefined, "token listede YOK");
  assert.match(list[0].tokenTail, /…\w{4}$/);
  assert.equal(list[0].source, "paste");
  assert.ok(Date.parse(list[0].expiresAt) > Date.now(), "bir yillik gecerlilik");
  const f = path.join(acc.accountsDir(), "claude-1.json");
  assert.equal(fs.statSync(f).mode & 0o777, 0o600, "0600 ile yazilir");
});

test("her hesap ayri conf dizini alir: claude-1, claude-2, …", () => {
  const b = acc.save({ label: "Ayşe", token: TOKEN("B") });
  const c = acc.save({ label: "Can", token: TOKEN("C") });
  assert.equal(b.id, "claude-2");
  assert.equal(c.id, "claude-3");
  for (const id of ["claude-1", "claude-2", "claude-3"]) {
    assert.ok(fs.existsSync(acc.configDir(id)), `${id} conf dizini`);
  }
  assert.equal(acc.count(), 3);
  assert.deepEqual(acc.list().map((a) => a.label), ["Murat", "Ayşe", "Can"]);
});

test("envFor: hesabin token'i + kendi conf dizini; id verilmezse ilki", () => {
  const e2 = acc.envFor("claude-2");
  assert.equal(e2.label, "Ayşe");
  assert.equal(e2.env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN("B"));
  assert.equal(e2.env.CLAUDE_CONFIG_DIR, acc.configDir("claude-2"));
  assert.equal(acc.envFor().id, "claude-1", "id yoksa ilk hesap");
  assert.throws(() => acc.envFor("claude-99"), /Hesap yok/);
});

test("token dogrulamasi: bicim, tekrar, etiket kirpma", () => {
  assert.throws(() => acc.save({ label: "x", token: "sk-ant-api03-yanlis" }), /biçimi/);
  assert.throws(() => acc.save({ label: "x", token: TOKEN("A") }), /zaten kayıtlı/);
  const uzun = acc.save({ label: "y".repeat(200), token: TOKEN("D") });
  assert.equal(acc.list().find((a) => a.id === uzun.id).label.length, 60);
  acc.remove(uzun.id);
});

test("yeniden adlandir ve sil: conf dizini de gider, bosalan numara tekrar kullanilir", () => {
  acc.rename("claude-3", "Can Y.");
  assert.equal(acc.list().find((a) => a.id === "claude-3").label, "Can Y.");
  acc.remove("claude-2");
  assert.ok(!fs.existsSync(acc.configDir("claude-2")), "conf dizini silindi");
  assert.equal(acc.count(), 2);
  const yeni = acc.save({ label: "Yeni", token: TOKEN("E") });
  assert.equal(yeni.id, "claude-2", "bosalan numara tekrar kullanilir");
  acc.remove("claude-2");
  assert.deepEqual(acc.remove("claude-9"), { ok: true, removed: false });
});

test("touch: son kullanim isaretlenir", () => {
  assert.equal(acc.list().find((a) => a.id === "claude-1").lastUsedAt, null);
  acc.touch("claude-1");
  assert.ok(acc.list().find((a) => a.id === "claude-1").lastUsedAt);
  acc.touch("yok-boyle"); // hata firlatmaz
});

test("relaySupported: macOS'ta kapali (sebep yazili), Linux'ta script+cli sarti", () => {
  const r = acc.relaySupported({ claudeBin: "/bin/echo" });
  if (LINUX) assert.equal(r.ok, true);
  else {
    assert.equal(r.ok, false);
    assert.match(r.reason, /Linux|yapıştır/);
  }
  const yok = acc.relaySupported({ claudeBin: null });
  if (LINUX && !process.env.PATH?.includes("claude")) assert.equal(typeof yok.ok, "boolean");
});

test("relay desteklenmiyorsa startLogin NO_RELAY firlatir", { skip: LINUX ? "Linux'ta relay acik" : false }, async () => {
  await assert.rejects(acc.startLogin({ label: "x", claudeBin: "/bin/echo" }), (e) => e.code === "NO_RELAY");
});

// ---------------------------------------------------------------- relay (Linux)
const skipRelay = LINUX ? false : "pty relay yalniz Linux'ta (BSD script borulu stdin ile pty acmiyor)";

/** Sahte `claude setup-token`: OSC-8 adres basar, kodu bekler, token ya da hata doner. */
function fakeClaude(behaviour) {
  const f = path.join(tmp, `fake-claude-${behaviour}.sh`);
  fs.writeFileSync(f, `#!/bin/sh
printf '\\033]8;id=1;https://claude.com/cai/oauth/authorize?code=true&client_id=test&scope=user%%3Ainference&code_challenge_method=S256&state=abc\\007tikla\\033]8;;\\007\\n'
printf 'Paste code here if prompted > '
read code
case "${behaviour}" in
  ok)      printf '\\nSuccess! Token:\\nsk-ant-oat01-RELAY0123456789ABCDEFGHIJ%s\\nStore this token securely.\\n' "$(echo "$code" | cut -c1-4)" ;;
  bad)     printf '\\nOAuth error: Invalid code. Please make sure the full code was copied. Press Enter to retry.\\n'; sleep 30 ;;
  hold)    printf '\\nYour Claude account is on hold. Visit claude.ai/settings/billing\\n'; sleep 1; exit 0 ;;
  silent)  sleep 30 ;;
esac
`, { mode: 0o755 });
  return f;
}

test("panelden giris: adres yakalanir, kod iletilir, token kaydedilir", { skip: skipRelay }, async () => {
  const once = acc.pendingCount();
  const { loginId, url } = await acc.startLogin({ label: "Relay Kullanıcı", claudeBin: fakeClaude("ok") });
  try {
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://claude.com/cai/oauth/authorize");
    assert.equal(u.searchParams.get("scope"), "user:inference");
    assert.equal(acc.pendingCount(), once + 1);
    const out = await acc.submitCode(loginId, "KOD1234567890");
    assert.equal(out.label, "Relay Kullanıcı");
    const rec = acc.list().find((a) => a.id === out.id);
    assert.equal(rec.source, "relay");
    assert.equal(acc.pendingCount(), once, "basarili girisde akis kapanir");
    assert.ok(acc.envFor(out.id).env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat01-RELAY"));
    acc.remove(out.id);
  } finally {
    acc.cancelLogin(loginId);
  }
});

test("gecersiz kod: BAD_CODE, akis AYAKTA kalir (kullanici tekrar dener)", { skip: skipRelay }, async () => {
  const once = acc.pendingCount();
  const { loginId } = await acc.startLogin({ label: "Tekrar", claudeBin: fakeClaude("bad") });
  await assert.rejects(acc.submitCode(loginId, "YANLISKOD123"), (e) => e.code === "BAD_CODE" && /Invalid code/i.test(e.message));
  assert.equal(acc.pendingCount(), once + 1, "akis dusmedi — kullanici kodu yeniden yapistirabilir");
  acc.cancelLogin(loginId);
  assert.equal(acc.pendingCount(), once);
});

test("kod dogrulamasi ve bilinmeyen akis", { skip: skipRelay }, async () => {
  const { loginId } = await acc.startLogin({ label: "Dogrulama", claudeBin: fakeClaude("silent") });
  // Bicim kontrolu surece HIC yazmaz: sessiz sahte CLI ile de aninda doner.
  await assert.rejects(acc.submitCode(loginId, ""), (e) => e.code === "BAD_INPUT");
  await assert.rejects(acc.submitCode(loginId, "kısa"), (e) => e.code === "BAD_INPUT");
  await assert.rejects(acc.submitCode("login-yok", "KOD1234567890"), (e) => e.code === "EXPIRED");
  acc.cancelLogin(loginId);
});

test("adres gelmezse NO_URL ve surec oldurulur", { skip: skipRelay }, async () => {
  const sessiz = path.join(tmp, "fake-noop.sh");
  fs.writeFileSync(sessiz, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
  const once = acc.pendingCount();
  await assert.rejects(acc.startLogin({ label: "x", claudeBin: sessiz }), (e) => e.code === "NO_URL");
  assert.equal(acc.pendingCount(), once, "adres gelmeyen akis birakilmaz");
});

// -------------------------------------------------- 2026-09-10'da olculen yollar

test("token vermeden kapanan CLI: TAM zaman asimi beklenmez, ekran gosterilir", { skip: skipRelay }, async () => {
  // `account_on_hold` ekrani "OAuth error" ONEKI KULLANMIYOR ve surec 500 ms
  // sonra oluyor: eski kod 60 sn bekleyip "kodu yeniden dene" diyordu.
  const { loginId } = await acc.startLogin({ label: "Askida", claudeBin: fakeClaude("hold") });
  const t0 = Date.now();
  await assert.rejects(acc.submitCode(loginId, "KOD1234567890"), (e) => {
    assert.equal(e.code, "CLI_EXIT");
    assert.match(e.message, /on hold/i, "ekranin son satirlari hataya girer");
    assert.equal(e.alive, false);
    return true;
  });
  assert.ok(Date.now() - t0 < 6000, `cikisla birlikte bitmeli, surdu: ${Date.now() - t0} ms`);
  assert.ok(!acc.pendingList().some((l) => l.loginId === loginId), "olu akis birakilmaz");
});

test("dolu kuyruk yeni girisi ENGELLEMEZ: en eski akis dusurulur", { skip: skipRelay }, async () => {
  for (const l of acc.pendingList()) acc.cancelLogin(l.loginId);
  const ilk = await acc.startLogin({ label: "1", claudeBin: fakeClaude("silent") });
  await acc.startLogin({ label: "2", claudeBin: fakeClaude("silent") });
  await acc.startLogin({ label: "3", claudeBin: fakeClaude("silent") });
  assert.equal(acc.pendingCount(), 3);
  const yeni = await acc.startLogin({ label: "4", claudeBin: fakeClaude("silent") });
  assert.equal(acc.pendingCount(), 3, "tavan korunur");
  const idler = acc.pendingList().map((l) => l.loginId);
  assert.ok(!idler.includes(ilk.loginId), "en eski akis dusuruldu");
  assert.ok(idler.includes(yeni.loginId), "yeni akis acildi");
  for (const l of acc.pendingList()) acc.cancelLogin(l.loginId);
});

test("pendingList: akis gorunur olur, TOKEN ve EKRAN METNI sizmaz", { skip: skipRelay }, async () => {
  const { loginId, url } = await acc.startLogin({ label: "Gorunur", claudeBin: fakeClaude("silent") });
  const l = acc.pendingList().find((x) => x.loginId === loginId);
  assert.equal(l.label, "Gorunur");
  assert.equal(l.url, url, "kart 'devam et' icin adresi gorur");
  assert.equal(l.alive, true);
  assert.ok(l.ttlSec > 0 && l.ttlSec <= 600);
  assert.deepEqual(Object.keys(l).sort(), ["ageSec", "alive", "label", "loginId", "startedAt", "ttlSec", "url"]);
  acc.cancelLogin(loginId);
});

test("tokenFromScreen: ANSI, satir kirilmasi ve yarim kare", () => {
  const T = `sk-ant-oat01-${"A".repeat(95)}`;
  // 1) Duz satir.
  assert.equal(acc.tokenFromScreen(`Your OAuth token:\n${T}\nStore this token securely.\n`), T);
  // 2) Ink 80 sutunda kirmis: satir tam genislikte bitiyor, devami alt satirda.
  const kirik = `${T.slice(0, 80)}\n${T.slice(80)}\nStore this token securely.\n`;
  assert.equal(acc.tokenFromScreen(kirik), T, "kirilmis token BIRLESTIRILIR (yoksa sessizce kirpilirdi)");
  // 3) Bosluklu satir birlestirilmez: "Store" token'a yapismaz.
  assert.equal(acc.tokenFromScreen(`${T}\nStore this token securely.\n`), T);
  // 4) Yarim basilmis kare: satir bitmeden token kabul edilmez.
  assert.equal(acc.tokenFromScreen(`Your OAuth token:\n${T.slice(0, 60)}`), null);
  // 5) Surec kapandiysa son satir da kabul edilir.
  assert.ok(acc.tokenFromScreen(`\n${T}`, { exited: true }));
  // 6) ANSI dizileri temizlenir.
  assert.equal(acc.tokenFromScreen(`\x1b[33m${T}\x1b[39m\nStore this\n`), T);
});

test("screenTail: token MASKELENIR, son satirlar ozetlenir", () => {
  const raw = `\x1b[2Kbir\niki\nsk-ant-oat01-${"Z".repeat(90)}\nuc\n`;
  const ozet = acc.screenTail(raw, 3);
  assert.ok(!/oat01-Z/.test(ozet), "token ozete DUZ girmez");
  assert.match(ozet, /sk-ant-oat…ZZZZ/);
  assert.match(ozet, /iki · .* · uc$/);
});

test("sendCode: kod ve Enter AYRI yazmalarda gider (uzun kod yapistirma sayiliyor)", async () => {
  // ⚠️ Olculdu 2026-09-10 (gercek CLI): kod + "\r" TEK yazmada gonderilince
  // 184 karakterlik kod HIC gonderilmedi (ekranda yalniz yildizlar), Enter
  // 300 ms sonra AYRI gonderilince calisti. Gercek OAuth kodu ~105 karakter.
  const yazmalar = [];
  const sahteStdin = { write: (v) => yazmalar.push({ v, at: Date.now() }) };
  const kod = `ac_${"A".repeat(120)}#${"B".repeat(60)}`;
  const t0 = Date.now();
  await acc.sendCode(sahteStdin, kod, { gapMs: 40 });
  assert.equal(yazmalar.length, 2, "iki ayri yazma");
  assert.equal(yazmalar[0].v, kod, "once kodun kendisi, Enter'siz");
  assert.equal(yazmalar[1].v, "\r", "Enter ayri yazmada");
  assert.ok(yazmalar[1].at - yazmalar[0].at >= 35, "aralarinda gercek bir boslukla");
  assert.ok(Date.now() - t0 >= 35);
});

test("tokenFromScreen: PARCALANMIS token (canlida olusan durum) bolgeden okunur", () => {
  // ⚠️ Canlida 2026-09-10: CLI token'i URETTI, ekranda "Store this token
  // securely." gorundu ama panel token'i okuyamadi — TUI metni parcalayarak
  // yaziyor ve parca siniri `sk-ant-oat` capasinin ORTASINA denk gelmisti.
  const T = `sk-ant-oat01-${"Q".repeat(90)}`;
  const parcali = [
    " ✓ Long-lived authentication token created successfully!",
    "",
    " Your OAuth token (valid for 1 year):",
    "",
    ` sk-ant- oat01-${"Q".repeat(40)}   ${"Q".repeat(50)}`,   // capa VE govde bolunmus
    "",
    " Store this token securely. You won't be able to see it again.",
    " Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>",
  ].join("\n");
  assert.equal(acc.tokenFromScreen(parcali), T, "bölge içindeki boşluklar atılarak birleştirilir");
  assert.equal(acc.successOnScreen(parcali), true);

  // Bosluksuz (glued) ekran da ayni sekilde okunur — TUI genelde boyle yaziyor.
  const glued = `YourOAuthtoken(validfor1year):${T}Storethistokensecurely.`;
  assert.equal(acc.tokenFromScreen(glued), T);

  // "Store" token'a YAPISMAZ: bolge disina tasmaz.
  assert.ok(!acc.tokenFromScreen(parcali).includes("Store"));
});

test("successOnScreen: basari YOKKEN false (abonelik mesaji yanlislikla basari sayilmasin)", () => {
  assert.equal(acc.successOnScreen("Your Claude account is on hold. Visit billing"), false);
  assert.equal(acc.successOnScreen("OAuth error: Invalid code"), false);
});

test("tokenFromConfigDir: CLI yapilandirma dizinine yazdiysa oradan kurtarilir", () => {
  const d = fs.mkdtempSync(path.join(tmp, "cfg-kurtarma-"));
  assert.equal(acc.tokenFromConfigDir(d), null, "dosya yoksa null");
  const T = `sk-ant-oat01-${"R".repeat(90)}`;
  fs.writeFileSync(path.join(d, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: T } }));
  assert.equal(acc.tokenFromConfigDir(d), T);
});

test("tokenFromScreen: token ORTASINDAKI bosluk KIRPMAYA yol acmaz", () => {
  // Simulasyon yakaladi: TUI imleci ilerletince token'in ortasina bosluk
  // giriyor; satir okuyucusu orada kesip 105 karakterlik token'i 53 karakter
  // olarak kabul ediyordu. Bolge okuyucusu ONCE kosmali.
  const T = `sk-ant-oat01-${"Z".repeat(92)}`;
  const ekran = ` Your OAuth token (valid for 1 year):\n\n ${T.slice(0, 53)}  ${T.slice(53)}\n\n Store this token securely.\n`;
  const okunan = acc.tokenFromScreen(ekran);
  assert.equal(okunan, T);
  assert.equal(okunan.length, T.length, "kirpilmadan tam okunur");
});

test("plain: CLI'nin bastigi TUM diziler elenir (ESC7/ESC8 rakam birakiyordu)", () => {
  // Canlida olculdu: ekran ozetinde `(B[>4m[<u78[>4m[<u` gorundu — bunlar
  // elenmemis ESC(B, ESC[>4m, ESC[<u, ESC7, ESC8 kalintilaridir. `7`/`8`
  // token'in ORTASINA dusrse token'a rakam ekleyip BOZUK kaydettirir.
  const T = `sk-ant-oat01-${"K".repeat(92)}`;
  const cop = "\x1b(B\x1b[>4m\x1b[<u\x1b7\x1b8\x1b[?25l\x1b[39m";
  const ekran = ` Your OAuth token (valid for 1 year):\n\n ${cop}${T.slice(0, 40)}${cop}${T.slice(40)}${cop}\n\n ${cop}Store this token securely.\n`;
  const okunan = acc.tokenFromScreen(ekran);
  assert.equal(okunan, T, "kalinti karakter token'a KARISMAZ");
  assert.ok(!/[78]{2}/.test(okunan.slice(13)), "ESC7/ESC8 kalintisi sizmaz");
  // Ozet metninde de kalinti gorunmemeli.
  assert.ok(!acc.screenTail(`${cop}bir satir${cop}`).includes("[>4m"), "ozet temiz");
  assert.ok(!acc.screenTail(`\x1b7\x1b8son satir`).match(/^78/), "ESC7/8 rakam birakmaz");
});

test("plain: DCS/OSC bloklari ve karakter kumesi secimleri elenir", () => {
  const T = `sk-ant-oat01-${"L".repeat(92)}`;
  const ekran = ` Your OAuth token:\n \x1b]8;;https://x\x07${T}\x1b]8;;\x07\n Store this token securely.\n`;
  assert.equal(acc.tokenFromScreen(ekran), T);
});

test("FARKSAL boyama: gecmis atilirsa token delik desik olur", () => {
  // Canlida olculdu 2026-09-10: TUI degismeyen sutunlarin uzerinden \e[<n>C
  // ile ATLIYOR. Kod gonderilmeden once tampon sifirlanirsa o sutunlar bosluk
  // kaliyor ve token ekranda `sk-ant- <100 karakter>` diye ikiye bolunuyordu.
  const T = `sk-ant-oat01-${"J".repeat(92)}`;
  const oncekiKare = `\x1b[6;2H${T}`;                       // govde: ONCEKI kare
  const sonrakiKare = "\x1b[4;2HYour OAuth token (valid for 1 year):"
    + `\x1b[6;2Hsk-ant-\x1b[${T.length - 7}C\x1b[K`        // yalniz onek tazeleniyor
    + "\x1b[8;2HStore this token securely.";
  assert.equal(acc.tokenFromScreen(oncekiKare + sonrakiKare, { exited: true }), T,
    "tum akis verilirse token TAM okunur");
  assert.equal(acc.tokenFromScreen(sonrakiKare, { exited: true }), null,
    "gecmis atilirsa okunamaz — tampon SIFIRLANMAMALI");
});
