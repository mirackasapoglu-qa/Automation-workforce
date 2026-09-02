/**
 * MobAI connector — "device" yeteneği (fiziksel cihaz).
 *
 * MCP'den değil HTTP köprüsünden okur: bedava, anlık ve panel bağımsız kalır.
 */
export const key = "mobai";
export const label = "MobAI";
export const icon = null;
export const capabilities = ["device"];

/*
 * Köprü adresi MOBAI_BRIDGE ile değişir; `off` (ya da boş) "bu makinede cihaz
 * yok" demektir.
 *
 * ⚠️ Adres eskiden SABİT 127.0.0.1:8686'ydı. Sunucuda (Dokploy) ne MobAI
 * uygulaması ne cihaz var; connector her preflight'ta 2,5 sn timeout'a kadar
 * bekleyip "köprü kapalı" diyordu — hiçbir ayarla açılamayan, ölçümü de
 * yavaşlatan bir satır (ölçüldü 2026-09-02: testing-ideal.machinarium.dev →
 * /api/preflight `mobai: off "köprü kapalı (http://127.0.0.1:8686)"`).
 * Sunucuda `MOBAI_BRIDGE=off` ver: yoklama YAPILMAZ, satır "bu makinede yok"
 * der. Cihaz gerçekten uzaktaysa adresi yaz (tünel/host.docker.internal).
 */
const RAW = (process.env.MOBAI_BRIDGE ?? "http://127.0.0.1:8686").trim();
const DISABLED = RAW === "" || RAW.toLowerCase() === "off" || RAW.toLowerCase() === "none";
const BRIDGE = DISABLED ? null : RAW.replace(/\/+$/, "");

/** Yerel değil: ağa çıkar. Registry kullanılmayan connector'ı bu yüzden yoklamaz. */
export const local = false;

export const credential = { bridge: BRIDGE ?? "kapalı (MOBAI_BRIDGE=off)" };
export const credentialLabel = BRIDGE ? `köprü ${BRIDGE}` : "MOBAI_BRIDGE=off — cihaz köprüsü kapalı";

export const setupFix = [
  "MobAI uygulamasını açık tut — köprüyü o sağlıyor",
  "Cihaz USB ile bağlı ve yetkilendirilmiş mi (adb devices)",
  "Başka makinedeyse: MOBAI_BRIDGE=http://<host>:8686 · cihaz hiç yoksa MOBAI_BRIDGE=off",
];

export async function configured() {
  if (DISABLED) return false;
  try {
    const r = await fetch(`${BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

export async function check() {
  if (DISABLED) {
    return {
      state: "off",
      detail: "bu makinede cihaz köprüsü yok (MOBAI_BRIDGE=off)",
      note: "Cihaz otomasyonu MobAI'nin kurulu olduğu makinede çalışır; sunucuda kapalı.",
      fix: ["Cihaz uzaktaysa: MOBAI_BRIDGE=http://<host>:8686",
            "Bu projede cihaz hiç kullanılmıyorsa profilde device: null"],
    };
  }
  try {
    const res = await fetch(`${BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { state: "off", detail: `HTTP ${res.status}`, fix: setupFix };
    const list = await res.json();
    const real = list.filter((d) => !d.cloud);
    const ready = real.filter((d) => d.connectionState === "ready");
    return {
      state: ready.length ? "ok" : real.length ? "warn" : "off",
      detail: ready.length
        ? `${ready.length} fiziksel cihaz hazır (+${list.length - real.length} bulut)`
        : real.length ? `${real.length} cihaz bağlı ama hazır değil` : `fiziksel cihaz yok (+${list.length} bulut)`,
      note: `${list.length} cihaz görünüyor (${real.length} fiziksel, ${list.length - real.length} bulut)`,
      fix: ready.length ? [] : setupFix,
    };
  } catch {
    return { state: "off", detail: `köprü kapalı (${BRIDGE})`, fix: setupFix };
  }
}

export const device = {
  async list() {
    if (DISABLED) throw new Error("MOBAI_BRIDGE=off — cihaz köprüsü kapalı");
    const r = await fetch(`${BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(2500) });
    return r.json();
  },
};
