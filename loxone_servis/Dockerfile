FROM golang:1.24-bookworm AS go2rtc-build

ARG GO2RTC_VERSION=1.9.14
ARG GO2RTC_SOURCE_SHA256=e3d59e553dfd0085889a2956281cfc0fd78bb7b4d6269d1c90c217d2ffcf2c7b

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/go2rtc
RUN set -eu; \
    curl --fail --silent --show-error --location \
      "https://github.com/AlexxIT/go2rtc/archive/refs/tags/v${GO2RTC_VERSION}.tar.gz" \
      --output /tmp/go2rtc.tar.gz; \
    echo "${GO2RTC_SOURCE_SHA256}  /tmp/go2rtc.tar.gz" | sha256sum --check --status; \
    tar --extract --gzip --strip-components=1 --file /tmp/go2rtc.tar.gz; \
    rm /tmp/go2rtc.tar.gz

COPY patches/go2rtc-hls-session-timeout.patch /tmp/go2rtc-hls-session-timeout.patch
RUN set -eu; \
    patch --batch --forward -p1 < /tmp/go2rtc-hls-session-timeout.patch; \
    test "$(grep -c 'const keepalive = 30 \* time.Second' internal/hls/hls.go)" -eq 1; \
    test "$(grep -c 'func (s \*Session) Segment()' internal/hls/session.go)" -eq 1; \
    test "$(grep -c 'ready = len(s.buffer) > len(s.init)' internal/hls/session.go)" -eq 1; \
    CGO_ENABLED=0 go build -ldflags "-s -w" -trimpath -o /out/go2rtc .

FROM node:22-bookworm-slim AS runtime

ARG BUILD_VERSION=3.0.52
ARG BUILD_ARCH
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DATA_DIRECTORY=/data \
    TRUST_PROXY=true \
    SECURE_COOKIES=auto \
    APP_VERSION=${BUILD_VERSION}

COPY --from=go2rtc-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

# Browsers cannot consume RTSP directly. This checksum-pinned go2rtc build
# remuxes H.264/H.265 without JPEG transcoding. The audited local patch extends
# the HLS deadline and prevents MPEG-TS header-only fragments. The Hub owns the
# bounded numbered cache and serializes pulls for all clients. Management and
# RTSP listeners remain loopback-only at runtime.
COPY --from=go2rtc-build /out/go2rtc /usr/local/bin/go2rtc

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
