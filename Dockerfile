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
RUN if [ "$WITH_BROWSERS" = "1" ]; then \
      npx playwright install --with-deps chrome chromium; \
    else \
      echo "WITH_BROWSERS=0 — tarayici kurulmadi, kosum tetikleme CALISMAZ"; \
    fi

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

ENV NODE_ENV=production \
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
