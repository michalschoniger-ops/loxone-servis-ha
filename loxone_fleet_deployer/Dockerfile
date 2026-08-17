FROM alpine:3.22

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

COPY payload.tar.gz /opt/evora/payload.tar.gz
COPY rollback-0.4.10.tar.gz /opt/evora/rollback-0.4.10.tar.gz
COPY run.sh /run.sh
RUN chmod 0755 /run.sh

CMD ["/run.sh"]
