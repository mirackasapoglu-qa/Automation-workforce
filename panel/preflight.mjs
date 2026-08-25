/**
 * Önkoşul kontrolleri — panelin dışa bağımlı her şeyi tek yerde.
 *
 * NEDEN: 20–21 Ağustos'ta üç kez aynı döngüye girdik — bir şey çalışmadı,
 * sebebini bulmak dakikalar aldı. Anthropic anahtarı yok, Figma'nın iki
 * kotasından biri tükenmiş, kapı cookie'si dolmuş, MobAI cihazı kopmuş.
 * Hepsi görünür olsaydı hiçbiri sürpriz olmayacaktı.
 *
 * MALİYET DİSİPLİNİ: pahalı kontroller önbellekli.
 *  - Figma REST: HİÇ ÇAĞRI YAPILMAZ. Üç uç da Tier 1 ve View/Collab koltuğunda
 *    limit ayda 6 istek — yoklamanın kendisi kotayı bitiriyordu. Durum gerçek
 *    çağrıların bıraktığı nottan okunur (`figma-quota.mjs`).
 *  - Figma MCP: View seat'te ayda 6 çağrı; kontrol etmek kotadan yer.
 *    O yüzden HİÇ çağrı yapmıyoruz, elle tutulan nottan okuyoruz.
 *  - Jira whoami: kota yok ama ağ var, 10 dakika önbellek.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasCredentials } from "./scenario-suggest.mjs";
import { PROJECT } from "./project.mjs";
import { noteResponse, quotaCheck } from "./figma-quota.mjs";

const CACHE_FILE = path.join(process.cwd(), "panel-data", ".preflight-cache.json");
const NOTES_FILE = path.join(process.cwd(), "panel-data", "quota-notes.json");

const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(v, null, 1));
  } catch { /* yazilamazsa onbelleksiz devam */ }
};

async function cached(key, ttlMs, fn) {
  const c = readJson(CACHE_FILE, {});
  const hit = c[key];
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cachedAgeSec: Math.round((Date.now() - hit.at) / 1000) };
  const value = await fn();
  c[key] = { at: Date.now(), value };
  writeJson(CACHE_FILE, c);
  return { ...value, cachedAgeSec: 0 };
}

/**
 * Anthropic API kimligi — yerel, bedava.
 *
 * `fix`: "Bağlantılar" panelinde gösterilen çözüm adımları. Bu bilgi eskiden
 * yalnızca Senaryo öner kutusundaki uyarı metninde duruyordu; bağlantı kapalıysa
 * çözümün durumun yanında olması gerekiyor.
 */
function checkAnthropic() {
  const ok = hasCredentials();
  return {
    key: "anthropic",
    label: "Anthropic",
    state: ok ? "ok" : "off",
    detail: ok ? "kimlik var" : "anahtar yok — senaryo öner ve AI yorumu kapalı",
    credential: "ANTHROPIC_API_KEY ortam değişkeni ya da `ant auth login` profili",
    note: "Kimlik panele değil ORTAMA verilir; panel yeniden başlatılmalı.",
    fix: ok ? [] : ["export ANTHROPIC_API_KEY=sk-...", "npm i -g @anthropic-ai/ant && ant auth login"],
  };
}

/** `~/.figma-credentials` var mı — yerel, bedava. */
function figmaTokenExists() {
  try {
    return /FIGMA_TOKEN\s*=\s*\S/.test(
      fs.readFileSync(path.join(os.homedir(), ".figma-credentials"), "utf8"),
    );
  } catch {
    return false;
  }
}

/** Figma MCP — çağrı YAPMAZ, elle tutulan nottan okur. */
function figmaMcpPart() {
  const n = readJson(NOTES_FILE, {}).figmaMcp;
  if (!n) return { label: "MCP", state: "unknown", detail: "not yok" };
  // Dev/Full koltukta gunluk limit var, aylik tukenme yok — ayri anlatilir.
  if (n.dailyLimit) {
    return {
      label: "MCP", state: "ok",
      detail: `${n.dailyLimit}/gün${n.perMinute ? `, ${n.perMinute}/dk` : ""} (${n.seat} seat)`,
    };
  }
  const resets = n.resetsAt ? new Date(n.resetsAt) : null;
  const open = resets ? Date.now() > resets.getTime() : false;
  return {
    label: "MCP",
    state: open ? "unknown" : "blocked",
    detail: open
      ? `kota yenilenmiş olabilir (${n.monthlyLimit}/ay, ${n.seat} seat) — teyit edilmedi`
      : `${n.monthlyLimit}/ay tükendi (${n.seat} seat) — ${resets ? resets.toISOString().slice(0, 10) : "?"} sonrası`,
  };
}

/**
 * Figma — TEK SATIR, hiç çağrı yapmaz.
 *
 * Üç ayrı pill (files / images / MCP) üst şeridi şişiriyordu ve üçü de aynı
 * soruyu cevaplıyor: "Figma'ya bağlı mıyız?". En kötü durum pill'e, ayrıntı
 * tooltip'e. `parts` API'de kalıyor ki teşhis lazım olunca elde olsun.
 *
 * REST tarafı yoklanmıyor: üç uç da Tier 1 ve View/Collab koltuğunda limit ayda
 * 6 istek — yoklamanın kendisi kotayı bitiriyordu. Durum gerçek çağrıların
 * `figma-quota.mjs`'e bıraktığı nottan okunuyor.
 */
const WORST = ["off", "blocked", "warn", "unknown", "ok"];
const worstOf = (states) => WORST.find((w) => states.includes(w)) ?? "unknown";

const FIGMA_CRED = "~/.figma-credentials → FIGMA_TOKEN";

function checkFigma() {
  if (!figmaTokenExists()) {
    return {
      key: "figma", label: "Figma yok", icon: "figma", state: "off",
      detail: "~/.figma-credentials yok — tasarım diff'i kapalı",
      credential: FIGMA_CRED, parts: [],
      fix: ["Figma > Settings > Personal access tokens ile token üret",
            "echo 'FIGMA_TOKEN=figd_...' > ~/.figma-credentials && chmod 600 ~/.figma-credentials"],
    };
  }
  const parts = [
    { label: "/files", ...quotaCheck("files", { key: "figmaFiles", label: "/files" }) },
    { label: "/images", ...quotaCheck("images", { key: "figmaImages", label: "/images" }) },
    figmaMcpPart(),
  ];
  const state = worstOf(parts.map((p) => p.state));
  const word = { ok: "bağlandı", blocked: "bloke", warn: "sorunlu", off: "yok", unknown: "?" }[state];
  return {
    key: "figma",
    label: `Figma ${word}`,
    icon: "figma",
    state,
    detail: parts.map((p) => `${p.label}: ${p.detail}`).join(" · "),
    parts,
    credential: FIGMA_CRED,
    note: "Üç uç da Tier 1, TEK sayaç. Limit koltuğa bağlı: View/Collab 6/ay, Dev/Full 10-20/dk. Panel yoklama YAPMAZ — durum gerçek çağrıların notundan.",
    fix: state === "blocked"
      ? ["Kota penceresi dolana kadar bekle (tarih yukarıda)",
         "Koltuğu Dev/Full'e yükselt — Tier 1 6/ay yerine 10-20/dk olur",
         "Kota kapalıyken: node scripts/figma-offline-diff.mjs (API çağrısı yapmaz)"]
      : [],
  };
}

/**
 * Jira erişimi. Figma satırıyla aynı biçim: marka ikonu + durum kelimesi,
 * ayrıntı (kim / hangi proje) tooltip'te.
 */
async function checkJira() {
  return cached("jira", 10 * 60 * 1000, async () => {
    const base = {
      key: "jira",
      icon: "jira",
      credential: "~/.jira-credentials → JIRA_EMAIL / JIRA_TOKEN",
    };
    try {
      const { whoami, JIRA } = await import("./jira.mjs");
      if (!JIRA.available) {
        return {
          ...base, label: "Jira yok", state: "off", detail: "~/.jira-credentials yok",
          fix: ["Atlassian > Security > API tokens ile token üret",
                "printf 'JIRA_EMAIL=...\\nJIRA_TOKEN=...\\nJIRA_HOST=https://...atlassian.net\\n' > ~/.jira-credentials"],
        };
      }
      const me = await whoami();
      return {
        ...base, label: "Jira bağlandı", state: "ok",
        detail: `${me.name} · ${JIRA.project}`,
        note: `proje ${JIRA.project} · epic ${JIRA.epic} · ${JIRA.host}`,
        fix: [],
      };
    } catch (e) {
      return {
        ...base, label: "Jira sorunlu", state: "warn",
        detail: String(e.message).slice(0, 50),
        fix: ["Token süresi dolmuş olabilir — Atlassian'da yeniden üret",
              "Ağ/VPN kontrolü: JIRA_HOST erişilebilir mi"],
      };
    }
  });
}

/** MobAI — MCP degil HTTP API'sinden okur, bedava ve anlik. */
const MOBAI_BRIDGE = "http://127.0.0.1:8686";
async function checkMobai() {
  const base = { key: "mobai", label: "MobAI", credential: `köprü ${MOBAI_BRIDGE}` };
  const bridgeFix = [
    "MobAI uygulamasını açık tut — köprüyü o sağlıyor",
    "Cihaz USB ile bağlı ve yetkilendirilmiş mi (adb devices)",
  ];
  try {
    const res = await fetch(`${MOBAI_BRIDGE}/api/v1/devices`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ...base, state: "off", detail: `HTTP ${res.status}`, fix: bridgeFix };
    const list = await res.json();
    const real = list.filter((d) => !d.cloud);
    const ready = real.filter((d) => d.connectionState === "ready");
    return {
      ...base,
      state: ready.length ? "ok" : real.length ? "warn" : "off",
      detail: ready.length
        ? `${ready.length} fiziksel cihaz hazır (+${list.length - real.length} bulut)`
        : real.length ? `${real.length} cihaz bağlı ama hazır değil` : `fiziksel cihaz yok (+${list.length} bulut)`,
      note: `${list.length} cihaz görünüyor (${real.length} fiziksel, ${list.length - real.length} bulut)`,
      fix: ready.length ? [] : bridgeFix,
    };
  } catch {
    return { ...base, state: "off", detail: `köprü kapalı (${MOBAI_BRIDGE})`, fix: bridgeFix };
  }
}

/**
 * Slack ve Linear — GÖSTERİM SATIRLARI, ağ çağrısı YOK.
 *
 * NEDEN böyle: panel bağımsız bir Node sunucusu, Claude Code'un MCP
 * oturumuna erişemez. Linear MCP uzak + OAuth'lu (token Keychain'de),
 * Slack bot token istiyor. İkisi de bugün panelin hiçbir işinde
 * kullanılmıyor; satırlar yalnızca "kurulu mu" görünürlüğü için var.
 *
 * Gerçekten bağlanmak gerekirse doğru yol MCP değil, Jira satırının
 * aynısı: düz API + ~/.<servis>-credentials (Linear GraphQL `viewer`,
 * Slack `auth.test`). O zaman `passive` bayrağı da kalkar.
 *
 * `passive: true`: bu satırlar connectors düğmesinin rengini ETKİLEMEZ.
 * Panelin çalışması bunlara bağlı olmadığı için eksik token'ın düğmeyi
 * sürekli amber yakması gürültü olurdu.
 */
function credLine(file, varName) {
  try {
    return new RegExp(`${varName}\\s*=\\s*\\S`).test(
      fs.readFileSync(path.join(os.homedir(), file), "utf8"),
    );
  } catch {
    return false;
  }
}

function passiveCheck({ key, label, icon, file, varName, useDetail, fix }) {
  const has = credLine(file, varName);
  return {
    key,
    label,
    icon,
    passive: true,
    // Token varsa bile "ok" DEMİYORUZ: doğrulama çağrısı yapılmadı.
    // Panelin bağlantı durumu konusunda yalan söylememesi kuralı.
    state: has ? "unknown" : "off",
    detail: has
      ? "token var — doğrulanmadı (panel çağrı yapmıyor)"
      : `kurulu değil — ${useDetail}`,
    credential: `~/${file} → ${varName}`,
    note: "Gösterim satırı: panel bu servisi henüz kullanmıyor, durum yalnızca kimlik dosyasından okunuyor.",
    fix: has ? [] : fix,
  };
}

const checkSlack = () =>
  passiveCheck({
    key: "slack",
    label: "Slack",
    icon: "slack",
    file: ".slack-credentials",
    varName: "SLACK_BOT_TOKEN",
    useDetail: "koşum/bulgu bildirimi kapalı",
    fix: [
      "api.slack.com/apps > OAuth & Permissions ile bot token üret",
      "echo 'SLACK_BOT_TOKEN=xoxb-...' > ~/.slack-credentials && chmod 600 ~/.slack-credentials",
    ],
  });

const checkLinear = () =>
  passiveCheck({
    key: "linear",
    label: "Linear",
    icon: "linear",
    file: ".linear-credentials",
    varName: "LINEAR_API_KEY",
    useDetail: "kart okuma/yazma Jira üzerinden",
    fix: [
      "Linear > Settings > Security & access > Personal API keys",
      "echo 'LINEAR_API_KEY=lin_api_...' > ~/.linear-credentials && chmod 600 ~/.linear-credentials",
    ],
  });

export async function preflight(extra = []) {
  // Figma satırı senkron ve bedava; yalnız Jira + MobAI ağ istiyor.
  const [jira, mobai] = await Promise.all([checkJira(), checkMobai()]);
  return [checkAnthropic(), checkFigma(), jira, mobai, checkSlack(), checkLinear(), ...extra];
}
