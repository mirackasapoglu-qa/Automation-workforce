import dotenv from "dotenv";
dotenv.config();

export const ENV = (process.env.HOMEE_ENV ?? "test").toLowerCase();

/** Sadece "Geçici Erişim" kapısı geçilmiş — üye girişi YOK. */
export const GUEST_STATE = `playwright/.auth/${ENV}-gate.json`;

/** Kapı + üye oturumu. */
export const MEMBER_STATE = `playwright/.auth/${ENV}-user.json`;

export const BASE_URL = process.env[`BASE_URL_${ENV.toUpperCase()}`] ?? "";
export const TEST_EMAIL = process.env.TEST_EMAIL ?? "";
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "";
export const ORDERS_ALLOWED = process.env.ALLOW_HOMEE_ORDERS === "1";
