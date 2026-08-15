FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DATA_DIRECTORY=/data \
    TRUST_PROXY=true \
    SECURE_COOKIES=auto \
    APP_VERSION=0.4.6

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/loxone-servis
RUN chmod 0755 /usr/local/bin/loxone-servis && mkdir -p /data && chmod 0700 /data

EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl --fail --silent http://127.0.0.1:8099/healthz >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/usr/local/bin/loxone-servis"]
