FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG BUILD_VERSION=3.0.6
ARG BUILD_ARCH
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DATA_DIRECTORY=/data \
    TRUST_PROXY=true \
    SECURE_COOKIES=auto \
    APP_VERSION=${BUILD_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
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

EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl --fail --silent http://127.0.0.1:8099/healthz >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/usr/local/bin/loxone-servis"]
