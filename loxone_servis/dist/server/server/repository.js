import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { firmwareRelation } from "./version.js";
function mapMiniServer(row) {
    return {
        serial: row.serial,
        type: row.type,
        project: row.project,
        registered: row.registered,
        hasCredentials: Boolean(row.username_encrypted && row.password_encrypted),
        accessPolicy: row.access_policy,
        targetFirmware: row.target_firmware,
        currentFirmware: row.current_firmware,
        firmwareRelation: firmwareRelation(row.current_firmware, row.target_firmware),
        connectionState: row.connection_state,
        lastCheckedAt: row.last_checked_at,
        lastErrorCode: row.last_error,
        elementsOnline: row.elements_online,
        elementsTotal: row.elements_total,
        updateStatus: row.update_status,
        excluded: row.excluded === 1,
        notes: row.notes,
        gatewaySerial: row.gateway_serial,
        localUrl: row.local_url,
        connectionUrl: row.connection_url,
        lastLatencyMs: row.last_latency_ms,
        healthVerdict: row.health_verdict,
        offlineDevices: Number(row.offline_devices ?? 0),
        loxAppVersion: row.loxapp_version,
        updatedAt: row.updated_at,
    };
}
const miniserverSelect = `
  SELECT m.*,
    (SELECT COUNT(*) FROM device_inventory d WHERE d.serial=m.serial AND d.online=0) AS offline_devices
  FROM miniservers m`;
export function listMiniservers(db) {
    return db.prepare(`${miniserverSelect} ORDER BY project COLLATE NOCASE, serial`).all().map(mapMiniServer);
}
export function getMiniserver(db, serial) {
    const row = db.prepare(`${miniserverSelect} WHERE m.serial=?`).get(serial.toUpperCase());
    return row ? mapMiniServer(row) : null;
}
export function getStoredCredentials(db, serial) {
    const row = db
        .prepare("SELECT username_encrypted,password_encrypted FROM miniservers WHERE serial=?")
        .get(serial.toUpperCase());
    if (!row?.username_encrypted || !row.password_encrypted)
        return null;
    return {
        username: decryptSecret(row.username_encrypted, config.masterKey, `${serial.toUpperCase()}:username`),
        password: decryptSecret(row.password_encrypted, config.masterKey, `${serial.toUpperCase()}:password`),
    };
}
export function saveCredentials(db, serial, username, password) {
    const normalized = serial.toUpperCase();
    db.prepare(`UPDATE miniservers SET username_encrypted=?,password_encrypted=?,credential_source='manual',updated_at=? WHERE serial=?`).run(encryptSecret(username, config.masterKey, `${normalized}:username`), encryptSecret(password, config.masterKey, `${normalized}:password`), new Date().toISOString(), normalized);
}
export function listReleases(db) {
    const rows = db
        .prepare("SELECT channel,version,config_url,published_at,source_url FROM firmware_releases ORDER BY CASE channel WHEN 'stable' THEN 1 WHEN 'beta' THEN 2 ELSE 3 END")
        .all();
    const channels = ["stable", "beta", "alpha"];
    return channels.map((channel) => {
        const row = rows.find((candidate) => candidate.channel === channel);
        return {
            channel,
            version: row?.version ?? null,
            configUrl: row?.config_url ?? null,
            publishedAt: row?.published_at ?? null,
            source: row?.source_url ?? "https://update.loxone.com/updatecheck.xml",
        };
    });
}
export function fleetOverview(db) {
    const servers = listMiniservers(db);
    const counts = {
        current: 0,
        newer: 0,
        older: 0,
        unavailable: 0,
        noAccess: 0,
        unknown: 0,
    };
    for (const server of servers) {
        if (server.connectionState === "unavailable" || server.connectionState === "error")
            counts.unavailable += 1;
        else if (server.connectionState === "no_access")
            counts.noAccess += 1;
        else if (server.firmwareRelation === "current")
            counts.current += 1;
        else if (server.firmwareRelation === "newer")
            counts.newer += 1;
        else if (server.firmwareRelation === "older")
            counts.older += 1;
        else
            counts.unknown += 1;
    }
    const lastFullCheckAt = db.prepare("SELECT value FROM settings WHERE key='last_full_check_at'").get()?.value ?? null;
    const nextFullCheckAt = lastFullCheckAt
        ? new Date(new Date(lastFullCheckAt).getTime() + config.fullCheckIntervalMinutes * 60_000).toISOString()
        : null;
    return {
        total: servers.length,
        ...counts,
        updating: servers.filter((server) => !["idle", "done", "failed"].includes(server.updateStatus)).length,
        officialReleases: listReleases(db),
        lastFullCheckAt,
        nextFullCheckAt,
    };
}
//# sourceMappingURL=repository.js.map