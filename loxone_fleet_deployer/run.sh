#!/bin/sh
set -eu

PAYLOAD_SHA256="fc41b70bdb1d2e6f6e643bda7b122d9ff0da80a2ab4a7a0e5a30b4cbf7864f0c"
EXPECTED_SLUG="loxone_fleet"
EXPECTED_VERSION="0.4.12"

if [ "${EVORA_DEPLOY_TEST_MODE:-0}" = "1" ]; then
  : "${EVORA_TEST_ADDONS_ROOT:?Chybí testovací adresář add-onů.}"
  : "${EVORA_TEST_PAYLOAD_ARCHIVE:?Chybí testovací payload.}"
  ADDONS_ROOT="$EVORA_TEST_ADDONS_ROOT"
  PAYLOAD_ARCHIVE="$EVORA_TEST_PAYLOAD_ARCHIVE"
else
  ADDONS_ROOT="/addons"
  PAYLOAD_ARCHIVE="/opt/evora/payload.tar.gz"
fi

log() {
  printf '%s\n' "[evora-deployer] $*"
}

fail() {
  log "CHYBA: $*"
  exit 1
}

[ -d "$ADDONS_ROOT" ] || fail "Adresář /addons není připojen."
[ -f "$PAYLOAD_ARCHIVE" ] || fail "Chybí instalační payload."

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
  0.4.8|0.4.9|0.4.10|0.4.11|0.4.12) ;;
  *) fail "Neočekávaná cílová verze: ${CURRENT_VERSION:-neznámá}. Nic nebylo změněno." ;;
esac

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE_ROOT="$ADDONS_ROOT/.evora-deploy-stage-$TIMESTAMP"
BACKUP_ROOT="$ADDONS_ROOT/.evora-smart-hub-rollback"
BACKUP_DIR="$BACKUP_ROOT/${TARGET_NAME}-${CURRENT_VERSION}-${TIMESTAMP}"

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
mv "$TARGET_DIR" "$BACKUP_DIR/original"
if ! mv "$STAGED_DIR" "$TARGET_DIR"; then
  mv "$BACKUP_DIR/original" "$TARGET_DIR"
  fail "Nový zdroj nešel přesunout; původní zdroj byl obnoven."
fi
rmdir "$STAGE_ROOT"

cat > "$BACKUP_DIR/receipt.txt" <<EOF
target=$TARGET_DIR
previous_version=$CURRENT_VERSION
prepared_version=$EXPECTED_VERSION
payload_sha256=$PAYLOAD_SHA256
prepared_at_utc=$TIMESTAMP
rollback_source=$BACKUP_DIR/original
EOF

log "HOTOVO: zdroj ${EXPECTED_VERSION} je připraven k Supervisor rebuild."
log "Původní zdroj zůstal v: $BACKUP_DIR/original"
