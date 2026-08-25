import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "./env.mjs";

// dotenv yerine sifir bagimlilikli yukleyici (bkz. env.mjs)
loadEnv();

const env = (process.env.HOMEE_ENV ?? "test").toLowerCase();
const validEnvs = ["test", "staging", "prod", "local"] as const;
type Env = (typeof validEnvs)[number];

if (!validEnvs.includes(env as Env)) {
  throw new Error(
    `Geçersiz HOMEE_ENV='${env}'. Geçerli değerler: ${validEnvs.join(", ")}`,
  );
}

const baseURLKey = `BASE_URL_${env.toUpperCase()}`;
const baseURL = process.env[baseURLKey];

if (!baseURL) {
  throw new Error(
    `${baseURLKey} .env içinde tanımlı değil. Şu anki env='${env}'. ` +
      `.env dosyana ${baseURLKey}=https://... ekle.`,
  );
}

export default defineConfig({
  testDir: "./tests",
  workers: 1,

  // Homee tamamen client-render Next.js — ilk boyama yavaş. 45s makul taban.
  timeout: Number(process.env.TEST_TIMEOUT ?? 45_000),

  globalSetup: require.resolve("./global-setup"),

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  use: {
    baseURL,
    // Varsayılan: MİSAFİR oturumu (sadece "Geçici Erişim" kapısı geçilmiş).
    // Üye testleri (20+) kendi içinde member state'e geçer — bkz. pages/authState.ts
    storageState: `playwright/.auth/${env}-gate.json`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
      },
    },
    {
      // Mobil viewport — sistemdeki Chrome ile koşar (webkit indirmesi gerekmez)
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        channel: "chrome",
      },
    },
  ],
});
