import { chromium, FullConfig, BrowserContext, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

/**
 * Homee iki katmanlı kimlik doğrulama arkasında:
 *   1) Machinarium "Geçici Erişim" kapısı  → cookie: temporary_auth_verified=true
 *   2) Tepe Home üye girişi (/giris)       → uygulama oturumu
 *
 * Bu yüzden İKİ storage state üretiyoruz:
 *   playwright/.auth/<env>-gate.json  → sadece kapı (MİSAFİR testleri: 01–09)
 *   playwright/.auth/<env>-user.json  → kapı + üye (ÜYE testleri: 20–25)
 *
 * Böylece login/negatif testleri oturum açık bir state'le çakışmaz.
 */

/** Siparişi GERÇEKTEN tamamlayan spec'ler. ALLOW_HOMEE_ORDERS=1 olmadan koşmaz. */
const ORDER_COMPLETING_SPECS = ["25-checkout-to-payment"];

async function passAccessGate(page: Page, baseURL: string) {
  const user = process.env.GATE_USER ?? "admin";
  const pass = process.env.GATE_PASSWORD ?? "";

  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);

  const gateButton = page.getByRole("button", { name: /^Giriş Yap$/ });
  const onGate = await page
    .getByText("Geçici Erişim")
    .isVisible({ timeout: 4000 })
    .catch(() => false);

  if (!onGate) {
    console.log("  ℹ️  Geçici Erişim kapısı görünmedi (zaten geçilmiş olabilir)");
    return;
  }

  const inputs = page.locator("form input, input");
  await inputs.nth(0).fill(user);
  await inputs.nth(1).fill(pass);
  await gateButton.first().click();
  await page.waitForTimeout(5000);

  const stillGated = await page
    .getByText("Geçici Erişim")
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (stillGated) {
    throw new Error(
      "🚫 Geçici Erişim kapısı geçilemedi. .env içindeki GATE_USER / GATE_PASSWORD'ü kontrol et.",
    );
  }
  console.log("  ✓ Geçici Erişim kapısı geçildi");
}

async function memberLogin(page: Page, baseURL: string) {
  const email = process.env.TEST_EMAIL ?? "";
  const password = process.env.TEST_PASSWORD ?? "";

  await page.goto(`${baseURL}/giris?redirect=%2Fhesabim`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3500);

  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: /^GİRİŞ YAP$/i }).first().click();
  await page.waitForTimeout(7000);
}

/**
 * GERÇEK oturum doğrulaması.
 * Sadece "/hesabim login'e yönlenmedi mi" bakmak YETMEZ — FE hesap iskeletini
 * cookie varlığına göre render ediyor, iptal edilmiş bir oturum bu kontrolü geçer.
 * Bu yüzden sayfada kullanıcının e-postasının göründüğünü de assert ediyoruz.
 */
async function verifyMemberSession(page: Page, baseURL: string): Promise<boolean> {
  const email = (process.env.TEST_EMAIL ?? "").toLowerCase();
  if (!email) return false;

  await page.goto(`${baseURL}/hesabim`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(4000);

  if (page.url().includes("/giris")) return false;

  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return body.includes(email);
}

async function verifyGateSession(page: Page, baseURL: string): Promise<boolean> {
  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  const gated = await page
    .getByText("Geçici Erişim")
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  return !gated;
}

async function globalSetup(_config: FullConfig) {
  const env = (process.env.HOMEE_ENV ?? "test").toLowerCase();
  const baseURL = process.env[`BASE_URL_${env.toUpperCase()}`];

  if (!baseURL) {
    throw new Error(`BASE_URL_${env.toUpperCase()} .env içinde yok (env=${env})`);
  }

  // --- Sipariş guard'ı: gerçek sipariş açan spec'ler açıkça izin istemeli
  if (!process.env.ALLOW_HOMEE_ORDERS || process.env.ALLOW_HOMEE_ORDERS !== "1") {
    const argv = process.argv.join(" ");
    if (ORDER_COMPLETING_SPECS.some((s) => argv.includes(s))) {
      console.log(
        "\n⚠️  ALLOW_HOMEE_ORDERS=1 verilmedi — checkout spec'i ödeme adımında duracak,\n" +
          "    sipariş TAMAMLANMAYACAK. Tam sipariş için: ALLOW_HOMEE_ORDERS=1 npm run test:odeme\n",
      );
    }
  }

  const authDir = path.join(process.cwd(), "playwright", ".auth");
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const gateFile = path.join(authDir, `${env}-gate.json`);
  const memberFile = path.join(authDir, `${env}-user.json`);

  const browser = await chromium.launch({ channel: "chrome" });

  console.log(`\n🔐 Homee auth kurulumu — env=${env} → ${baseURL}`);

  // ---------- 1) MİSAFİR state (kapı) ----------
  let gateOk = false;
  if (fs.existsSync(gateFile)) {
    const ctx = await browser.newContext({ storageState: gateFile });
    const page = await ctx.newPage();
    gateOk = await verifyGateSession(page, baseURL).catch(() => false);
    await ctx.close();
    console.log(gateOk ? "  ✓ Mevcut kapı state'i geçerli" : "  ↻ Kapı state'i geçersiz, yenileniyor");
  }
  if (!gateOk) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await passAccessGate(page, baseURL);
    await ctx.storageState({ path: gateFile });
    await ctx.close();
    console.log(`  ✓ Misafir state yazıldı → ${path.relative(process.cwd(), gateFile)}`);
  }

  // ---------- 2) ÜYE state (kapı + login) ----------
  if (!process.env.TEST_EMAIL || !process.env.TEST_PASSWORD) {
    console.log("  ⏭️  TEST_EMAIL/TEST_PASSWORD yok — üye state'i atlandı (20–25 spec'leri skip olur)");
    await browser.close();
    return;
  }

  let memberOk = false;
  if (fs.existsSync(memberFile)) {
    const ctx = await browser.newContext({ storageState: memberFile });
    const page = await ctx.newPage();
    memberOk = await verifyMemberSession(page, baseURL).catch(() => false);
    await ctx.close();
    console.log(memberOk ? "  ✓ Mevcut üye oturumu geçerli (e-posta doğrulandı)" : "  ↻ Üye oturumu geçersiz, yeniden login");
  }
  if (!memberOk) {
    const ctx: BrowserContext = await browser.newContext({ storageState: gateFile });
    const page = await ctx.newPage();
    await memberLogin(page, baseURL);
    const ok = await verifyMemberSession(page, baseURL);
    if (!ok) {
      await page.screenshot({ path: "test-results/global-setup-login-fail.png" }).catch(() => {});
      await browser.close();
      throw new Error(
        "🚫 Üye girişi doğrulanamadı. .env içindeki TEST_EMAIL / TEST_PASSWORD'ü kontrol et.\n" +
          "   Ekran görüntüsü: test-results/global-setup-login-fail.png",
      );
    }
    await ctx.storageState({ path: memberFile });
    await ctx.close();
    console.log(`  ✓ Üye state yazıldı → ${path.relative(process.cwd(), memberFile)}`);
  }

  await browser.close();
  console.log("");
}

export default globalSetup;
