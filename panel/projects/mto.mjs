/**
 * MTO — Machinarium Test Otomasyonu (Jira projesi).
 *
 * Bu profil, panelin TEST EDİLEN BİR SİTE olmadan da çalışabildiği hâli:
 * amaç otomasyon işinin kendisini Jira'da yürütmek (kart açma, yorum, statü),
 * bir web sitesini koşmak değil. Bu yüzden `routes` boş — koşum tetikleme,
 * rota eşlemesi, perf ve tasarım diff'i bu profilde kapalı kalır (panel
 * bunları rota/spec olmadan zaten göstermiyor).
 *
 * ÖLÇÜLDÜ (2026-08-27):
 *  - MTO şu an BOŞ: 0 kart. Sıfırdan yazılacak.
 *  - Kart açmak için `customfield_10072` ("Project") ZORUNLU ve 5 seçeneği var:
 *    GENCALLAR(10133) · AKGIDA(10096) · KRIDES(10134) · MYMAGAZACILIK(10135) ·
 *    TEPEHOME(10136). Varsayılanı TEPEHOME bıraktım çünkü eldeki iş bu müşteri;
 *    başka müşteriye kart açılacaksa `JIRA_PROJECT_FIELD_VALUE` ile ezilir
 *    (panel/jira.mjs profil değerlerini aynı adlı ortam değişkeniyle ezdiriyor).
 *  - Issue tipleri: Epik(10000) · Hikaye(10006) · Görev(10007) · Alt görev(10008)
 *    · Hata(10009). Panelin "bug kartı aç" akışı `bugTypeId`yi kullanıyor.
 *  - EPİK YOK. MAC profilinde görünümler `parent = <epic>` ile süzülüyordu;
 *    burada epik oluşana kadar süzgeç proje bazlı. Epik açılınca `epic` alanını
 *    doldur, görünümler kendiliğinden daralır.
 *
 * ⚠️ İKİNCİ PROFİL TUZAĞI: `panel/project.mjs → pick()` iki profil bulur ve
 * `PANEL_PROJECT` verilmezse HATA atar. Bu dosya eklendiği için `npm run panel`
 * ve `npm run up` artık `PANEL_PROJECT=homee` ile çağrılıyor (package.json).
 * MTO panelini ayrı portta açmak için:
 *   PANEL_PROJECT=mto PANEL_PORT=4656 npm run panel
 */
export const id = "mto";
export const title = "Machinarium Test Otomasyonu";
export const product = "Test Otomasyonu";

/** Site yok: koşum/rota/perf kapalı. Tracker ve AI açık. */
export const connectors = {
  tracker: "jira",
  ai: "claude-code",
  design: null,
  device: null,
  chat: null,
};

export const env = { var: null, default: "test", ordersVar: null };

/** MTO kart anahtarları — panelin metin içinde kart tanıması için. */
export const issuePrefixes = ["MTO"];

export const jira = {
  host: "https://machinarium.atlassian.net",
  project: "MTO",
  /** Epik açılınca doldur: görünümler `parent = <epic>` ile daralır. */
  epic: null,
  bugTypeId: "10009",
  taskTypeId: "10007",
  projectFieldId: "customfield_10072",
  projectFieldValueId: "10136", // TEPEHOME
  sprintFieldId: "customfield_10020",
  views: (J) => ({
    acik: {
      label: "Açık kartlar (bende bekleyen)",
      jql: `project = ${J.project} AND statusCategory != Done ORDER BY created DESC`,
    },
    bana: {
      label: "Bana atanmış",
      jql: `project = ${J.project} AND assignee = currentUser() AND statusCategory != Done ORDER BY status, key`,
    },
    tumu: {
      label: "Tümü",
      jql: `project = ${J.project} ORDER BY created DESC`,
    },
  }),
};

/**
 * Site olmadığı için boş. Panel bunu görünce koşum/rota/perf bölümlerini
 * doldurmuyor — hata vermiyor, sessizce boş kalıyor (ölçüldü: /api/specs boş
 * dizi, rota eşlemesi yok).
 */
export const routes = { rules: [], specRuns: {}, cardSpecs: {} };
