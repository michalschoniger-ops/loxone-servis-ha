FROM node:22-bookworm-slim

ARG BUILD_VERSION=3.0.22
ARG BUILD_ARCH
ARG GO2RTC_VERSION=1.9.14
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DATA_DIRECTORY=/data \
    TRUST_PROXY=true \
    SECURE_COOKIES=auto \
    APP_VERSION=${BUILD_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

# Browsers cannot consume RTSP directly. The pinned, checksum-verified go2rtc
# binary remuxes H.264/H.265 without JPEG transcoding; its management API and
# RTSP listener remain loopback-only at runtime.
RUN set -eu; \
    evora_arch="$(dpkg --print-architecture)"; \
    case "$evora_arch" in \
      amd64) evora_asset="go2rtc_linux_amd64"; evora_sha="32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6" ;; \
      arm64) evora_asset="go2rtc_linux_arm64"; evora_sha="359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50" ;; \
      *) echo "Nepodporovaná architektura video brány: $evora_arch" >&2; exit 1 ;; \
    esac; \
    curl --fail --silent --show-error --location \
      "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/${evora_asset}" \
      --output /usr/local/bin/go2rtc; \
    echo "${evora_sha}  /usr/local/bin/go2rtc" | sha256sum --check --status; \
    chmod 0755 /usr/local/bin/go2rtc

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY THIRD_PARTY_NOTICES.md ./
COPY docker-entrypoint.sh /usr/local/bin/loxone-servis
RUN chmod 0755 /usr/local/bin/loxone-servis && mkdir -p /data && chmod 0700 /data

LABEL io.hass.name="Evora Smart Hub" \
      io.hass.description="Bezpečný servisní a monitorovací hub pro Loxone a Home Assistant" \
      io.hass.type="addon" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.title="Evora Smart Hub" \
      org.opencontainers.image.source="https://github.com/michalschoniger-ops/loxone-servis" \
      org.opencontainers.image.version="${BUILD_VERSION}"

EXPOSE 8099 28555/tcp 28555/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl --fail --silent http://127.0.0.1:8099/healthz >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/usr/local/bin/loxone-servis"]
