# QA Paneli + landing — Dokploy imajı.
#
# İlk hâli (node:22-alpine) paneli açıyordu ama koşum tetikleme sessizce
# çalışmıyordu: tarayıcı binary'si yoktu. Bu dosyada düzeltilen dört şey:
#   1) TABAN İMAJ. Playwright tarayıcıları glibc istiyor; Alpine (musl) resmî
#      olarak desteklenmiyor. Debian slim + `playwright install --with-deps`.
#   2) TARAYICI. playwright.config.ts `channel: "chrome"` diyor — chromium
#      yetmez, GERÇEK Chrome kurulmalı. `WITH_BROWSERS=0` ile atlanabilir
#      (yalnız-arayüz imajı; koşum düğmeleri hata verir, panel çalışır).
#   3) PORTLAR. up.mjs proxy'yi PANEL_PORT+1'de, landing'i LANDING_PORT'ta
#      açıyor. Yalnızca 3000 EXPOSE edilmişti; "Site (canlı)" sekmesi ve
#      landing dışarıdan erişilemezdi.
#   4) SİNYAL. up.mjs iki çocuk süreç doğuruyor; PID 1 olarak node sinyalleri
#      iletmiyor ve container durdurulunca zombi kalıyordu → tini.
#
# ⚠️ ÇALIŞMA ZAMANI GEREKSİNİMLERİ (image'a GİRMEZ, Dokploy'dan verilmeli):
#   - PANEL_TOKEN: verilmezse panel her açılışta yeni token üretir; iki replika
#     ya da yeniden başlatma sonrası arayüzdeki eski token 403 yer.
#   - PANEL_ORIGIN: ZORUNLU. Verilmezse origin whitelist'i localhost'ta kalır ve
#     domain'den gelen TÜM yazma uçları 403 döner (arayüz bunu yanıltıcı biçimde
#     "token eskimiş" diye gösterir). Örnek: PANEL_ORIGIN=https://panel.example
#   - Connector kimlikleri: JIRA_EMAIL / JIRA_TOKEN / JIRA_HOST / FIGMA_TOKEN.
#     Container'ın home dizini boş; `~/.<servis>-credentials` dosyaları YOK,
#     tek yol ortam değişkeni (connectors/credentials.mjs env'i dosyadan önce dener).
#     Tak-çalıştır: bu değişkenler verildiği anda Jira/Figma/AI bağlanır, başka
#     kurulum adımı yok. (figma-render / figma-diff / figma-prewarm 2026-09-08'e
#     kadar dosyayı DOĞRUDAN okuyordu; sunucuda preflight "Figma ok" derken
#     render "dosya yok" ile düşüyordu — artık hepsi resolveCreds.)
#   - Claude hesapları (ANTHROPIC_API_KEY'e ALTERNATİF): kişi kendi aboneliğiyle
#     bağlanır — Bağlantılar → Claude → "Hesap ekle". Sunucuda relay açık
#     (`script` + CLI imajda hazır). Hesap kayıtları ve her hesabın kendi
#     yapılandırma dizini /app/panel-data altında: VOLUME BAĞLI DEĞİLSE deploy'da
#     uçar ve herkes yeniden bağlanır. Otomatik hesap değiştirme YOK.
#   - ANTHROPIC_API_KEY: AI tek tık üretim (senaryo · perf yorumu · test case).
#     Verilmezse üç özellik "istem üret + yapıştır" ile çalışmaya devam eder.
#     İsteğe bağlı: AI_MODEL (varsayılan claude-opus-5), AI_EFFORT (high),
#     AI_DAILY_USD (günlük tavan; aşınca 429), AI_MAX_CONCURRENCY (2),
#     AI_TIMEOUT_MS (180000). Harcama defteri /app/panel-data/ai-usage.jsonl.
#     Yerel Claude Code CLI imajda YOK ve olmamalı — sunucu yolu API anahtarı.
#   - RAG indeksi (panel-data/rag/index.json) ilk istekte ~100 ms'de kurulur;
#     imaj build'inde kurmanın anlamı yok (panel-data volume, üstüne binerdi).
#   - PANEL_PROJECT: hangi proje profili (panel/projects/<ad>.mjs). İmajda
#     varsayılanı `homee`; birden fazla profil varken verilmezse panel açılmaz.
#   - MOBAI_BRIDGE=off: sunucuda cihaz köprüsü yok; verilmezse her preflight
#     127.0.0.1:8686'yı yoklayıp timeout bekler.
#   - HOMEE_ENV + BASE_URL_<ENV>: env.mjs mevcut ortam değişkenini EZMEZ, yani
#     .env dosyası olmadan doğrudan ortam değişkeni vermek yeterli.
#   - Kapı/üye oturumu (playwright/.auth) ve panel-data BİLİNÇLİ olarak imajın
#     dışında (bkz. .dockerignore). Koşum tetiklenecekse volume ile bağlanmalı:
#       /app/panel-data        (verdict, kanıt, token, koşum günlüğü)
#       /app/playwright/.auth  (kapı + üye oturumu)
#       /app/test-results      (video/trace/sonuç)
#   - Panelin yazma uçları TEK paylaşılan token'la korunuyor; internete açık bir
#     domain'e konacaksa önüne kimlik doğrulama (SSO/proxy auth) gerekir.

FROM node:22-bookworm-slim

# Koşum gerekmiyorsa: --build-arg WITH_BROWSERS=0 (imaj ~1.5 GB küçülür)
ARG WITH_BROWSERS=1

ENV NODE_ENV=development \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    npm_config_update_notifier=false

WORKDIR /app

# tini: PID 1 sinyal iletimi (up.mjs'in çocuk süreçleri için)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- bağımlılıklar: lockfile'lar önce, katman önbelleği kaynak değişiminde bozulmasın
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY site/package.json site/package-lock.json ./site/
RUN npm ci --include=dev --prefix site

# ---- tarayıcı: config `channel: "chrome"` istiyor
#
# ⚠️ GOOGLE CHROME'UN LINUX ARM64 YAPISI YOK. `playwright install chrome`
# arm64'te "ERROR: not supported on Linux Arm64 / Failed to install chrome"
# ile HATA verir ve TUM BUILD duser (olculdu 2026-09-02, Apple Silicon).
# Dokploy sunucusu arm64 ise imaj hic kurulamaz; Dokploy de basarisiz build'de
# ESKI container'i calisir birakir — yani "deploy oldu ama yansimadi" tablosu.
# Bu yuzden mimariye gore ayriliyor: amd64'te gercek Chrome, arm64'te chromium.
# arm64'te kosum tetiklemek icin PW_CHANNEL=chromium gerekir (playwright.config.ts).
RUN if [ "$WITH_BROWSERS" = "1" ]; then \
      arch="$(dpkg --print-architecture)"; \
      if [ "$arch" = "amd64" ]; then \
        npx playwright install --with-deps chrome chromium; \
      else \
        echo "$arch: Google Chrome'un Linux arm64 yapisi yok — yalniz chromium kuruluyor (PW_CHANNEL=chromium ver)"; \
        npx playwright install --with-deps chromium; \
      fi; \
    else \
      echo "WITH_BROWSERS=0 — tarayici kurulmadi, kosum tetikleme CALISMAZ"; \
    fi

# ---- Claude Code CLI: abonelik hesabiyla tek tik uretim + "panelden giris"
#
# Panel modeli iki yoldan cagirabiliyor: ANTHROPIC_API_KEY (Messages API) ya da
# kullanicinin kendi Claude ABONELIGI. Ikincisi bu CLI'yi gerektiriyor: panel
# `claude -p` komutunu hesabin token'i (CLAUDE_CODE_OAUTH_TOKEN) ve kendi
# yapilandirma diziniyle (CLAUDE_CONFIG_DIR) calistirir.
#
# "Panelden giris" (kullanici kendi makinesine hicbir sey kurmadan hesap ekler)
# `claude setup-token`'i sozde terminalde kosturur; bunun icin `script(1)` sart
# ve Debian taban imajinda bsdutils ile HAZIR gelir (olculdu 2026-09-10:
# /usr/bin/script mevcut). macOS'un BSD `script`i borulu stdin ile pty acamiyor,
# bu yuzden panelden giris YALNIZ sunucuda (Linux) acik.
#
# Surum SABIT: CLI'nin cikti bicimi (JSON zarfi, setup-token ekrani) degisince
# panelin ayristirmasi kirilabilir. Yukseltirken `npm run test:panel` yeterli
# degil — panel/auth/claude-accounts.test.mjs'i LINUX'ta kos (relay testleri).
RUN npm i -g @anthropic-ai/claude-code@2.1.267 \
 && claude --version

# ---- kaynak + landing build'i
COPY . .
RUN npm run build --prefix site

# Panel yazacağı dizinleri kendisi oluşturur ama volume bağlanmazsa da
# yazılabilir olmalı; root olmayan kullanıcı için sahiplik burada verilir.
# ⚠️ `$PLAYWRIGHT_BROWSERS_PATH` de mkdir'leniyor: WITH_BROWSERS=0 ile tarayici
# kurulmayinca /ms-playwright HIC OLUSMUYOR ve chown "No such file or directory"
# ile build'i dusuruyordu (olculdu 2026-09-02) — yani dokumante edilmis
# yalniz-arayuz imaji hic kurulamiyordu.
RUN mkdir -p panel-data test-results playwright/.auth "$PLAYWRIGHT_BROWSERS_PATH" \
 && useradd -m -u 10001 qa \
 && chown -R qa:qa /app "$PLAYWRIGHT_BROWSERS_PATH"

# PANEL_PROJECT imajda SABİTLENİR. `panel/project.mjs` profil dizininde birden
# fazla dosya görünce bilerek HATA atar (tahmin etmez) — `projects/mto.mjs`
# eklendiği anda sunucudaki container her açılışta bu hatayla düştü ve Dokploy
# yeni container'ı ayağa kaldıramadı (ölçüldü 2026-09-04). Yerelde `npm run panel`
# aynı varsayılanı package.json'dan alıyor; imajda CMD doğrudan `node scripts/up.mjs`
# olduğu için burada verilmesi şart. Başka profil için deploy'da ezilir
# (ör. -e PANEL_PROJECT=mto).
ENV NODE_ENV=production \
    PANEL_PROJECT=homee \
    PANEL_PORT=3000 \
    LANDING_PORT=4321

# 3000 panel · 3001 site proxy (PANEL_PORT+1, iframe'li "Site (canlı)" sekmesi)
# 4321 landing + onboarding
EXPOSE 3000 3001 4321

USER qa

# Panelin kendi tazelik ucu: süreç ayakta ve dosyalar okunabiliyor mu?
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PANEL_PORT||3000)+'/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/up.mjs"]
