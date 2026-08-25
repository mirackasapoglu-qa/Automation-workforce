/**
 * MobAI connector — "device" yeteneği (fiziksel cihaz).
 *
 * MCP'den değil HTTP köprüsünden okur: bedava, anlık ve panel bağımsız kalır.
 */
export const key = "mobai";
export const label = "MobAI";
export const icon = null;
export const capabilities = ["device"];
export const credential = { bridge: "http://127.0.0.1:8686" };
export const credentialLabel = `köprü ${"http://127.0.0.1:8686"}`;

export const setupFix = [
  "MobAI uygulamasını açık tut — köprüyü o sağlıyor",
  "Cihaz USB ile bağlı ve yetkilendirilmiş mi (adb devices)",
];

const BRIDGE = "http://127.0.0.1:8686";

export async function configured() {
  try {
    const r = await fetch(`${BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

export async function check() {
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
    const r = await fetch(`${BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(2500) });
    return r.json();
  },
};
