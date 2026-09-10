/**
 * Terminal öykünücüsü — canlı dökümden alınan GERÇEK boyama deseniyle.
 *
 * Koşum: node --test panel/auth/tty-screen.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderScreen } from "./tty-screen.mjs";

test("imleç konumlandırmasıyla boyanan satır DOĞRU sırayla kurulur", () => {
  // Canlı döküm (2026-09-10) tam olarak böyle boyuyordu: kelimeler mutlak
  // sütun numaralarıyla yerleştiriliyor, bayt sırası görsel sıra DEĞİL.
  const raw = "\x1b[2GStore\x1b[8Gthis\x1b[13Gtoken\x1b[19Gsecurely.";
  assert.equal(renderScreen(raw), " Store this token securely.");
});

test("token kendi satırında toplanır (asıl kırılma noktası)", () => {
  // Akışta token, BAŞLIK satırının baytlarının ARASINDA geliyor: önce imleç
  // aşağı inip token yazılıyor, sonra yukarı çıkıp başlık tamamlanıyor.
  const T = `sk-ant-oat01-${"V".repeat(92)}`;
  const raw = [
    "\x1b[1;1H Your\x1b[7GOAuth",            // başlığın başı
    "\x1b[3;2H", T,                            // token: 3. satır, 2. sütun
    "\x1b[1;13Htoken\x1b[19G(valid\x1b[26Gfor\x1b[30G1\x1b[32Gyear):", // başlığın kalanı
    "\x1b[5;2HStore\x1b[8Gthis\x1b[13Gtoken\x1b[19Gsecurely.",
  ].join("");
  const ekran = renderScreen(raw).split("\n");
  assert.equal(ekran[0], " Your OAuth token (valid for 1 year):");
  assert.equal(ekran[2].trim(), T, "token TEK PARÇA ve kendi satırında");
  assert.equal(ekran[4], " Store this token securely.");
});

test("ESC7/ESC8 imleci kaydeder ve geri yükler, rakam SIZDIRMAZ", () => {
  const raw = "abc\x1b7\x1b[5;5Hxyz\x1b8def";
  const ekran = renderScreen(raw);
  assert.equal(ekran.split("\n")[0], "abcdef", "ESC7/ESC8 metne 7/8 bırakmaz");
  assert.equal(ekran.split("\n")[4], "    xyz");
});

test("satır ve ekran silme uygulanır (eski kare kalıntısı kalmaz)", () => {
  assert.equal(renderScreen("eskiiii\rYENI\x1b[K"), "YENI");
  assert.equal(renderScreen("cop\ndaha cop\x1b[2J\x1b[1;1Htemiz"), "temiz");
});

test("özel modlar, SGR, OSC ve karakter kümesi seçimleri görünmez", () => {
  const raw = "\x1b[?25l\x1b[33mrenkli\x1b[39m\x1b]8;;https://x\x07bag\x1b]8;;\x07\x1b(B\x1b[?2004h son";
  assert.equal(renderScreen(raw), "renklibag son");
});

test("\\r ve \\n ayrı ayrı doğru davranır", () => {
  assert.equal(renderScreen("bir\r\niki"), "bir\niki");
  // \r sadece imleci başa alır; üzerine yazılan kadarı değişir, gerisi KALIR.
  assert.equal(renderScreen("uzun satir\rkisa"), "kisa satir");
});

test("aşırı parametreler sınırlanır (bellek patlamaz)", () => {
  const ekran = renderScreen("\x1b[999999;999999Hx");
  assert.ok(ekran.split("\n").length <= 500);
  assert.ok(ekran.length < 5_000_000);
});
