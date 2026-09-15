/*
 * Ürün giriş bilgileri — GERÇEK dosyaya yazar, o yüzden geçici cwd'de ayrı
 * süreçte koşar (aynı desen `scope-writeback.test.mjs`'te). En kritik ölçüm:
 * parolanın dışarıya dönen hiçbir nesnede bulunmaması.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MOD = path.resolve(import.meta.dirname, "product-credentials.mjs");

function calistir(kod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-"));
  const script = `
    const c = await import(${JSON.stringify(MOD)});
    const hata = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
    const sonuc = await (async () => { ${kod} })();
    console.log("<<<" + JSON.stringify(sonuc) + ">>>");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
  const parsed = JSON.parse(out.slice(out.indexOf("<<<") + 3, out.lastIndexOf(">>>")));
  const dosya = path.join(dir, "panel-data", "scope", "product-credentials.json");
  const izin = fs.existsSync(dosya) ? (fs.statSync(dosya).mode & 0o777).toString(8) : null;
  const ham = fs.existsSync(dosya) ? fs.readFileSync(dosya, "utf8") : "";
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...parsed, __izin: izin, __ham: ham };
}

test("kayit yoksa null doner", () => {
  const r = calistir(`return { g: c.get("x"), l: c.list(), env: c.runEnv("x") };`);
  assert.equal(r.g, null);
  assert.deepEqual(r.l, {});
  assert.deepEqual(r.env, {});
});

test("kaydedilen kayitta PAROLA disariya DONMEZ", () => {
  const r = calistir(`
    const kaydedilen = c.save("urun1", { loginUrl: "/giris", username: "qa@x.test", password: "gizli123" });
    return { kaydedilen, okunan: c.get("urun1"), liste: c.list() };
  `);
  assert.equal(r.kaydedilen.username, "qa@x.test");
  assert.equal(r.kaydedilen.hasPassword, true);
  assert.equal(r.kaydedilen.password, undefined, "parola donmemeli");
  assert.equal(r.okunan.password, undefined);
  assert.equal(r.liste.urun1.password, undefined);
  assert.equal(JSON.stringify(r.kaydedilen).includes("gizli123"), false);
});

test("parola diskte duruyor ve dosya izni 0600", () => {
  const r = calistir(`c.save("u", { username: "a", password: "p123" }); return true;`);
  assert.match(r.__ham, /p123/);              // koşum bunu kullanacak
  assert.equal(r.__izin, "600");
});

test("runEnv koşum icin parolayi VERIR, adlar istemle ayni", () => {
  // NOT: `calistir` donen nesneye __izin/__ham ekliyor (dosya kontrolu icin),
  // o yuzden alan alan karsilastiriliyor.
  const r = calistir(`
    c.save("u", { loginUrl: "https://x.test/giris", username: "qa", password: "p" });
    return c.runEnv("u");
  `);
  assert.equal(r.QA_LOGIN_URL, "https://x.test/giris");
  assert.equal(r.QA_USERNAME, "qa");
  assert.equal(r.QA_PASSWORD, "p");
});

test("eksik kimlikte runEnv BOS doner (yanlis parolayla denenmesin)", () => {
  const r = calistir(`
    return { yok: c.runEnv("hic"), };
  `);
  assert.deepEqual(r.yok, {});
});

test("parola BOS gelirse eskisi korunur (arayuz parolayi hic gostermiyor)", () => {
  const r = calistir(`
    c.save("u", { username: "a", password: "ilk" });
    c.save("u", { username: "b", password: "" });
    return { gorunen: c.get("u"), env: c.runEnv("u") };
  `);
  assert.equal(r.gorunen.username, "b");
  assert.equal(r.env.QA_PASSWORD, "ilk", "parola sessizce silinmemeli");
});

test("dogrulama: kullanici adi ve parola zorunlu, adres bicimi kontrollu", () => {
  const r = calistir(`
    return {
      adsiz: hata(() => c.save("u", { username: "  ", password: "p" })),
      parolasiz: hata(() => c.save("u2", { username: "a", password: "" })),
      kotuUrl: hata(() => c.save("u3", { username: "a", password: "p", loginUrl: "giris" })),
      iyiYol: c.save("u4", { username: "a", password: "p", loginUrl: "/giris" }).loginUrl,
    };
  `);
  assert.match(r.adsiz, /Kullanıcı adı boş/);
  assert.match(r.parolasiz, /Parola boş/);
  assert.match(r.kotuUrl, /tam adres/);
  assert.equal(r.iyiYol, "/giris");
});

test("silme kaydi kaldirir", () => {
  const r = calistir(`
    c.save("u", { username: "a", password: "p" });
    const s = c.remove("u");
    return { s, sonra: c.get("u"), tekrar: c.remove("u") };
  `);
  assert.equal(r.s.removed, true);
  assert.equal(r.sonra, null);
  assert.equal(r.tekrar.removed, false);
});
