#!/bin/sh
set -eu

PAYLOAD_SHA256="f16d8a333225e4d4a5e4469fc1fb90b9911ae329812877c8ff087f0c9175557a"
ROLLBACK_PAYLOAD_SHA256="52ea6fc2bbe085cd429e6a78ecf1f51109f8b4e4514a7f0cd9496d8e27556e6d"
EXPECTED_SLUG="loxone_fleet"
EXPECTED_VERSION="3.0.50"
ROLLBACK_VERSION="1.0.3"

if [ "${EVORA_DEPLOY_TEST_MODE:-0}" = "1" ]; then
  : "${EVORA_TEST_ADDONS_ROOT:?Chybí testovací adresář add-onů.}"
  : "${EVORA_TEST_PAYLOAD_ARCHIVE:?Chybí testovací payload.}"
  : "${EVORA_TEST_DATA_ROOT:?Chybí testovací datový adresář.}"
  ADDONS_ROOT="$EVORA_TEST_ADDONS_ROOT"
  PAYLOAD_ARCHIVE="$EVORA_TEST_PAYLOAD_ARCHIVE"
  ROLLBACK_ARCHIVE="${EVORA_TEST_ROLLBACK_ARCHIVE:-}"
  DATA_ROOT="$EVORA_TEST_DATA_ROOT"
else
  ADDONS_ROOT="/addons"
  PAYLOAD_ARCHIVE="/opt/evora/payload.tar.gz"
  ROLLBACK_ARCHIVE="/opt/evora/rollback-1.0.3.tar.gz"
  DATA_ROOT="/data"
fi

log() {
  printf '%s\n' "[evora-deployer] $*"
}

fail() {
  log "CHYBA: $*"
  exit 1
}

prepare_verified_rollback() {
  DESTINATION="$1"
  TEMP_ROOT="$2"
  [ -n "$ROLLBACK_ARCHIVE" ] || fail "Chybí cesta obnovovacího payloadu."
  [ -f "$ROLLBACK_ARCHIVE" ] || fail "Chybí obnovovací payload ${ROLLBACK_VERSION}."
  ACTUAL_ROLLBACK_SHA256="$(sha256sum "$ROLLBACK_ARCHIVE" | awk '{print $1}')"
  [ "$ACTUAL_ROLLBACK_SHA256" = "$ROLLBACK_PAYLOAD_SHA256" ] || fail "Kontrolní součet obnovovacího payloadu nesouhlasí."
  if tar -tzf "$ROLLBACK_ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "Obnovovací payload obsahuje nepovolenou cestu."
  fi
  [ ! -e "$TEMP_ROOT" ] || fail "Dočasná složka obnovovacího payloadu už existuje."
  [ ! -e "$DESTINATION" ] || fail "Cíl obnovovacího payloadu už existuje."
  mkdir -p "$TEMP_ROOT"
  tar -xzf "$ROLLBACK_ARCHIVE" -C "$TEMP_ROOT"
  ROLLBACK_DIR="$TEMP_ROOT/loxone_servis"
  ROLLBACK_CONFIG="$ROLLBACK_DIR/config.yaml"
  [ -f "$ROLLBACK_CONFIG" ] || fail "Obnovovací payload nemá config.yaml."
  [ -f "$ROLLBACK_DIR/Dockerfile" ] || fail "Obnovovací payload nemá Dockerfile."
  [ -f "$ROLLBACK_DIR/docker-entrypoint.sh" ] || fail "Obnovovací payload nemá vstupní skript."
  [ -f "$ROLLBACK_DIR/dist/server/server/index.js" ] || fail "Obnovovací payload nemá serverový build."
  [ -f "$ROLLBACK_DIR/dist/client/index.html" ] || fail "Obnovovací payload nemá klientský build."
  RESTORED_SLUG="$(awk -F: '/^slug:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$ROLLBACK_CONFIG")"
  RESTORED_VERSION="$(awk -F: '/^version:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$ROLLBACK_CONFIG")"
  [ "$RESTORED_SLUG" = "$EXPECTED_SLUG" ] || fail "Obnovovací payload má neočekávaný slug."
  [ "$RESTORED_VERSION" = "$ROLLBACK_VERSION" ] || fail "Obnovovací payload má neočekávanou verzi."
  mv "$ROLLBACK_DIR" "$DESTINATION"
  rmdir "$TEMP_ROOT"
}

[ -d "$ADDONS_ROOT" ] || fail "Adresář /addons není připojen."
[ -d "$DATA_ROOT" ] || fail "Datový adresář helperu není připojen."
[ -f "$PAYLOAD_ARCHIVE" ] || fail "Chybí instalační payload."

OPERATION="deploy"
if [ -f "$DATA_ROOT/options.json" ]; then
  CONFIGURED_OPERATION="$(sed -n 's/.*"operation"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DATA_ROOT/options.json")"
  [ -z "$CONFIGURED_OPERATION" ] || OPERATION="$CONFIGURED_OPERATION"
fi
case "$OPERATION" in
  deploy|rollback) ;;
  *) fail "Nepovolená operace: $OPERATION." ;;
esac

if [ "$OPERATION" = "rollback" ]; then
  [ -f "$DATA_ROOT/last-target-name" ] || fail "Chybí identifikátor posledního cíle."
  [ -f "$DATA_ROOT/last-backup-dir" ] || fail "Chybí cesta poslední zálohy."
  TARGET_NAME="$(sed -n '1p' "$DATA_ROOT/last-target-name")"
  BACKUP_DIR="$(sed -n '1p' "$DATA_ROOT/last-backup-dir")"
  case "$TARGET_NAME" in
    ""|*/*|.*) fail "Neplatný název cíle pro rollback." ;;
  esac
  case "$BACKUP_DIR" in
    "$ADDONS_ROOT/.evora-smart-hub-rollback/$TARGET_NAME"-*) ;;
    *) fail "Neplatná cesta zálohy pro rollback." ;;
  esac
  TARGET_DIR="$ADDONS_ROOT/$TARGET_NAME"
  ORIGINAL_DIR="$BACKUP_DIR/original"
  [ -d "$TARGET_DIR" ] || fail "Aktuální cílový adresář neexistuje."
  [ -d "$ORIGINAL_DIR" ] || fail "Původní zdroj pro rollback neexistuje."
  [ ! -L "$TARGET_DIR" ] || fail "Aktuální cílový adresář je symbolický odkaz."
  [ ! -L "$ORIGINAL_DIR" ] || fail "Původní zdroj je symbolický odkaz."
  grep -Eq '^slug:[[:space:]]*"?loxone_fleet"?[[:space:]]*$' "$TARGET_DIR/config.yaml" || fail "Aktuální cíl nemá očekávaný slug."
  grep -Eq '^slug:[[:space:]]*"?loxone_fleet"?[[:space:]]*$' "$ORIGINAL_DIR/config.yaml" || fail "Záloha nemá očekávaný slug."
  CURRENT_VERSION="$(awk -F: '/^version:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$TARGET_DIR/config.yaml")"
  ORIGINAL_VERSION="$(awk -F: '/^version:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$ORIGINAL_DIR/config.yaml")"
  [ "$CURRENT_VERSION" = "$EXPECTED_VERSION" ] || fail "Rollback odmítnut: aktivní zdroj není ${EXPECTED_VERSION}."
  case "$ORIGINAL_VERSION" in
    0.4.8|0.4.9|0.4.10|0.4.11|0.4.12|0.4.13|0.4.14|0.4.15|0.5.0|0.5.1|0.5.2|1.0.0|1.0.1|1.0.2|1.0.3|2.0.0|2.0.1|2.0.2|2.0.3|2.0.4|2.0.5|2.0.6|2.0.7|2.0.8|2.0.9|2.0.10|2.1.0|2.1.1|2.1.2|2.2.0|2.2.1|2.2.2|2.2.3|2.2.4|2.2.5|3.0.0|3.0.1|3.0.2|3.0.3|3.0.4|3.0.5|3.0.6|3.0.7|3.0.8|3.0.9|3.0.10|3.0.11|3.0.12|3.0.13|3.0.14|3.0.15|3.0.16|3.0.17|3.0.18|3.0.19|3.0.20|3.0.21|3.0.22|3.0.23|3.0.24|3.0.25|3.0.26) ;;
    3.0.27|3.0.28|3.0.29|3.0.30|3.0.31|3.0.32|3.0.33|3.0.34|3.0.35|3.0.36|3.0.37|3.0.38|3.0.39|3.0.40|3.0.41|3.0.42|3.0.43|3.0.44|3.0.45|3.0.46|3.0.47|3.0.48|3.0.49) ;;
    *) fail "Rollback odmítnut: neočekávaná původní verze $ORIGINAL_VERSION." ;;
  esac
  TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  FAILED_ROOT="$ADDONS_ROOT/.evora-failed-deployment"
  FAILED_DIR="$FAILED_ROOT/${TARGET_NAME}-${CURRENT_VERSION}-${TIMESTAMP}"
  [ ! -e "$FAILED_DIR" ] || fail "Cílová složka neúspěšného zdroje už existuje."
  mkdir -p "$FAILED_DIR"
  log "Obnovuji ${TARGET_NAME}: ${CURRENT_VERSION} -> ${ORIGINAL_VERSION}."
  mv "$TARGET_DIR" "$FAILED_DIR/replaced-source"
  if ! mv "$ORIGINAL_DIR" "$TARGET_DIR"; then
    mv "$FAILED_DIR/replaced-source" "$TARGET_DIR"
    fail "Původní zdroj nešel obnovit; nový zdroj byl vrácen na místo."
  fi
  printf '%s\n' "rollback" > "$DATA_ROOT/last-result"
  printf '%s\n' "$ORIGINAL_VERSION" > "$DATA_ROOT/last-restored-version"
  log "HOTOVO: zdroj ${ORIGINAL_VERSION} byl obnoven."
  log "Nahrazený zdroj zůstal v: $FAILED_DIR/replaced-source"
  exit 0
fi

ACTUAL_SHA256="$(sha256sum "$PAYLOAD_ARCHIVE" | awk '{print $1}')"
[ "$ACTUAL_SHA256" = "$PAYLOAD_SHA256" ] || fail "Kontrolní součet payloadu nesouhlasí."

if tar -tzf "$PAYLOAD_ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  fail "Payload obsahuje nepovolenou cestu."
fi

MATCH_COUNT=0
TARGET_CONFIG=""
for CANDIDATE in "$ADDONS_ROOT"/*/config.yaml "$ADDONS_ROOT"/*/config.yml; do
  [ -f "$CANDIDATE" ] || continue
  [ ! -L "$CANDIDATE" ] || fail "Konfigurace lokální aplikace je symbolický odkaz."
  if grep -Eq '^slug:[[:space:]]*"?loxone_fleet"?[[:space:]]*$' "$CANDIDATE"; then
    MATCH_COUNT=$((MATCH_COUNT + 1))
    TARGET_CONFIG="$CANDIDATE"
  fi
done

[ "$MATCH_COUNT" -eq 1 ] || fail "Očekáván právě jeden lokální loxone_fleet, nalezeno: $MATCH_COUNT."

TARGET_DIR="${TARGET_CONFIG%/*}"
TARGET_NAME="${TARGET_DIR#${ADDONS_ROOT}/}"
case "$TARGET_NAME" in
  ""|*/*) fail "Cílová cesta není přímým potomkem /addons." ;;
esac
[ ! -L "$TARGET_DIR" ] || fail "Cílový adresář je symbolický odkaz."

CURRENT_VERSION="$(awk -F: '/^version:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$TARGET_CONFIG")"
case "$CURRENT_VERSION" in
  0.4.8|0.4.9|0.4.10|0.4.11|0.4.12|0.4.13|0.4.14|0.4.15|0.5.0|0.5.1|0.5.2|1.0.0|1.0.1|1.0.2|1.0.3|2.0.0|2.0.1|2.0.2|2.0.3|2.0.4|2.0.5|2.0.6|2.0.7|2.0.8|2.0.9|2.0.10|2.1.0|2.1.1|2.1.2|2.2.0|2.2.1|2.2.2|2.2.3|2.2.4|2.2.5|3.0.0|3.0.1|3.0.2|3.0.3|3.0.4|3.0.5|3.0.6|3.0.7|3.0.8|3.0.9|3.0.10|3.0.11|3.0.12|3.0.13|3.0.14|3.0.15|3.0.16|3.0.17|3.0.18|3.0.19|3.0.20|3.0.21|3.0.22|3.0.23|3.0.24|3.0.25|3.0.26) ;;
  3.0.27) ;;
  3.0.28|3.0.29|3.0.30|3.0.31|3.0.32) ;;
  3.0.33|3.0.34|3.0.35|3.0.36|3.0.37|3.0.38|3.0.39|3.0.40|3.0.41|3.0.42|3.0.43|3.0.44|3.0.45|3.0.46|3.0.47|3.0.48|3.0.49) ;;
  *) fail "Neočekávaná cílová verze: ${CURRENT_VERSION:-neznámá}. Nic nebylo změněno." ;;
esac

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE_ROOT="$ADDONS_ROOT/.evora-deploy-stage-$TIMESTAMP"
ROLLBACK_STAGE_ROOT="$ADDONS_ROOT/.evora-rollback-stage-$TIMESTAMP"
BACKUP_ROOT="$ADDONS_ROOT/.evora-smart-hub-rollback"
BACKUP_DIR="$BACKUP_ROOT/${TARGET_NAME}-${CURRENT_VERSION}-${TIMESTAMP}"
REPAIR_MODE=0
ROLLBACK_SOURCE="$BACKUP_DIR/original"

if [ "$CURRENT_VERSION" = "$EXPECTED_VERSION" ]; then
  [ -f "$DATA_ROOT/last-target-name" ] || fail "Opravné nasazení nemá identifikátor původního cíle."
  [ -f "$DATA_ROOT/last-backup-dir" ] || fail "Opravné nasazení nemá cestu původního rollbacku."
  PRIOR_TARGET_NAME="$(sed -n '1p' "$DATA_ROOT/last-target-name")"
  PRIOR_BACKUP_DIR="$(sed -n '1p' "$DATA_ROOT/last-backup-dir")"
  [ "$PRIOR_TARGET_NAME" = "$TARGET_NAME" ] || fail "Opravné nasazení má jiný původní cíl."
  case "$PRIOR_BACKUP_DIR" in
    "$BACKUP_ROOT/${TARGET_NAME}"-*) ;;
    *) fail "Opravné nasazení má neplatnou cestu původního rollbacku." ;;
  esac
  [ -d "$PRIOR_BACKUP_DIR/original" ] || fail "Opravné nasazení nenašlo původní rollback."
  [ ! -L "$PRIOR_BACKUP_DIR/original" ] || fail "Původní rollback je symbolický odkaz."
  ROLLBACK_SOURCE="$PRIOR_BACKUP_DIR/original"
  BACKUP_DIR="$BACKUP_ROOT/${TARGET_NAME}-${CURRENT_VERSION}-repair-${TIMESTAMP}"
  REPAIR_MODE=1
fi

[ ! -e "$STAGE_ROOT" ] || fail "Dočasná složka už existuje."
[ ! -e "$BACKUP_DIR" ] || fail "Záložní složka už existuje."

mkdir -p "$STAGE_ROOT" "$BACKUP_DIR"
tar -xzf "$PAYLOAD_ARCHIVE" -C "$STAGE_ROOT"

STAGED_DIR="$STAGE_ROOT/loxone_servis"
STAGED_CONFIG="$STAGED_DIR/config.yaml"
[ -f "$STAGED_CONFIG" ] || fail "Payload nemá config.yaml."
[ -f "$STAGED_DIR/dist/server/server/index.js" ] || fail "Payload nemá serverový build."
[ -f "$STAGED_DIR/dist/client/index.html" ] || fail "Payload nemá klientský build."

STAGED_SLUG="$(awk -F: '/^slug:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$STAGED_CONFIG")"
STAGED_VERSION="$(awk -F: '/^version:/ {gsub(/[[:space:]\"]/, "", $2); print $2; exit}' "$STAGED_CONFIG")"
[ "$STAGED_SLUG" = "$EXPECTED_SLUG" ] || fail "Payload má neočekávaný slug."
[ "$STAGED_VERSION" = "$EXPECTED_VERSION" ] || fail "Payload má neočekávanou verzi."

log "Připravuji vratnou výměnu ${TARGET_NAME}: ${CURRENT_VERSION} -> ${EXPECTED_VERSION}."
if [ "$REPAIR_MODE" -eq 1 ]; then
  mv "$TARGET_DIR" "$BACKUP_DIR/displaced-source"
  SOURCE_TO_RESTORE="$BACKUP_DIR/displaced-source"
elif [ "$CURRENT_VERSION" = "$ROLLBACK_VERSION" ]; then
  prepare_verified_rollback "$BACKUP_DIR/original" "$ROLLBACK_STAGE_ROOT"
  mv "$TARGET_DIR" "$BACKUP_DIR/displaced-source"
  SOURCE_TO_RESTORE="$BACKUP_DIR/displaced-source"
else
  mv "$TARGET_DIR" "$BACKUP_DIR/original"
  SOURCE_TO_RESTORE="$BACKUP_DIR/original"
fi
if ! mv "$STAGED_DIR" "$TARGET_DIR"; then
  mv "$SOURCE_TO_RESTORE" "$TARGET_DIR"
  fail "Nový zdroj nešel přesunout; původní zdroj byl obnoven."
fi
if ! rmdir "$STAGE_ROOT"; then
  log "UPOZORNĚNÍ: Supervisor během výměny použil dočasnou složku; nasazený zdroj je už bezpečně na místě a zbytek zůstává izolovaný v $STAGE_ROOT."
fi

cat > "$BACKUP_DIR/receipt.txt" <<EOF
target=$TARGET_DIR
previous_version=$CURRENT_VERSION
prepared_version=$EXPECTED_VERSION
payload_sha256=$PAYLOAD_SHA256
prepared_at_utc=$TIMESTAMP
rollback_source=$ROLLBACK_SOURCE
EOF

log "HOTOVO: zdroj ${EXPECTED_VERSION} je připraven k Supervisor rebuild."
log "Původní zdroj zůstal v: $ROLLBACK_SOURCE"
if [ "$REPAIR_MODE" -eq 0 ]; then
  printf '%s\n' "$TARGET_NAME" > "$DATA_ROOT/last-target-name"
  printf '%s\n' "$BACKUP_DIR" > "$DATA_ROOT/last-backup-dir"
fi
printf '%s\n' "deploy" > "$DATA_ROOT/last-result"
