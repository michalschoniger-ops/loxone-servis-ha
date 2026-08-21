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
        credentialSource: row.credential_source,
        accessPolicy: row.access_policy,
        targetFirmware: row.target_firmware,
        firmwarePolicy: row.firmware_policy === "pinned" ? "pinned" : "follow_stable",
        firmwareChannel: ["beta", "alpha"].includes(row.firmware_channel)
            ? row.firmware_channel
            : "stable",
        manualOnly: row.manual_only === 1,
        currentFirmware: row.current_firmware,
        firmwareRelation: firmwareRelation(row.current_firmware, row.target_firmware),
        connectionState: row.connection_state,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
        lastErrorCode: row.last_error,
        elementsOnline: row.inventory_total > 0 ? Number(row.inventory_online) : row.elements_online,
        elementsTotal: row.inventory_total > 0 ? Number(row.inventory_total) : row.elements_total,
        updateStatus: row.update_status,
        excluded: row.excluded === 1,
        notes: row.notes,
        folderId: row.folder_id,
        folderName: row.folder_name,
        gatewaySerial: row.gateway_serial,
        gatewayRole: row.gateway_role,
        gatewayRoleSource: row.gateway_role_source,
        gatewayDetectedRole: row.gateway_detected_role,
        gatewayDetectedAt: row.gateway_detected_at,
        localUrl: row.local_url,
        connectionUrl: row.connection_url,
        lastLatencyMs: row.last_latency_ms,
        healthVerdict: row.health_verdict,
        offlineDevices: Number(row.offline_devices ?? 0),
        loxAppVersion: row.loxapp_version,
        weatherServiceStatus: ["active", "inactive"].includes(row.weather_service_status)
            ? row.weather_service_status
            : "unknown",
        weatherServiceCheckedAt: row.weather_service_checked_at,
        updatedAt: row.updated_at,
    };
}
const miniserverSelect = `
  SELECT m.*,f.name AS folder_name,f.sort_order AS folder_sort_order,
    (SELECT COUNT(*) FROM device_inventory d
      WHERE d.serial=m.serial AND d.device_serial NOT GLOB '*[^0-9A-F]*' AND length(d.device_serial) BETWEEN 6 AND 16
        AND d.online=0) AS offline_devices,
    (SELECT COUNT(*) FROM device_inventory d
      WHERE d.serial=m.serial AND d.device_serial NOT GLOB '*[^0-9A-F]*' AND length(d.device_serial) BETWEEN 6 AND 16
        AND d.online=1) AS inventory_online,
    (SELECT COUNT(*) FROM device_inventory d
      WHERE d.serial=m.serial AND d.device_serial NOT GLOB '*[^0-9A-F]*' AND length(d.device_serial) BETWEEN 6 AND 16) AS inventory_total
  FROM miniservers m LEFT JOIN project_folders f ON f.id=m.folder_id`;
export function listMiniservers(db) {
    return db.prepare(`${miniserverSelect} ORDER BY
    CASE WHEN m.folder_id IS NULL THEN 1 ELSE 0 END,
    COALESCE(f.sort_order,2147483647),f.name COLLATE NOCASE,
    CASE m.gateway_role WHEN 'gateway' THEN 0 WHEN 'standalone' THEN 1 WHEN 'client' THEN 2 ELSE 3 END,
    COALESCE(m.gateway_serial,m.serial),m.project COLLATE NOCASE,m.serial`).all().map(mapMiniServer);
}
export function getMiniserver(db, serial) {
    const row = db.prepare(`${miniserverSelect} WHERE m.serial=?`).get(serial.toUpperCase());
    return row ? mapMiniServer(row) : null;
}
export function listProjectFolders(db) {
    return db.prepare(`
    SELECT f.id,f.name,f.description,f.color,f.parent_id,p.name AS parent_name,f.sort_order,f.created_at,f.updated_at,
      COUNT(m.serial) AS server_count,
      SUM(CASE WHEN m.gateway_role='gateway' THEN 1 ELSE 0 END) AS gateway_count,
      SUM(CASE WHEN m.gateway_role='client' THEN 1 ELSE 0 END) AS client_count
    FROM project_folders f
    LEFT JOIN project_folders p ON p.id=f.parent_id
    LEFT JOIN miniservers m ON m.folder_id=f.id
    GROUP BY f.id
    ORDER BY f.sort_order,f.name COLLATE NOCASE
  `).all().map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color || "#58D73A",
        parentId: row.parent_id,
        parentName: row.parent_name,
        sortOrder: row.sort_order,
        serverCount: Number(row.server_count ?? 0),
        gatewayCount: Number(row.gateway_count ?? 0),
        clientCount: Number(row.client_count ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
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
export function listReleaseArchive(db, limit = 300) {
    const rows = db.prepare(`SELECT h.id,h.channel,h.version,h.config_url,h.first_seen_at,h.last_seen_at,h.source_url
     FROM firmware_release_history h
     LEFT JOIN firmware_releases current ON current.channel=h.channel
     WHERE current.version IS NULL
        OR h.version<>current.version
        OR h.config_url<>COALESCE(current.config_url,'')
     ORDER BY CASE h.channel WHEN 'stable' THEN 1 WHEN 'beta' THEN 2 ELSE 3 END,
              h.first_seen_at DESC,h.id DESC
     LIMIT ?`).all(Math.max(1, Math.min(limit, 1_000)));
    return rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        version: row.version,
        configUrl: row.config_url || null,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        source: row.source_url,
    }));
}
export function fleetOverview(db) {
    const servers = listMiniservers(db);
    const availability = connectionAvailabilityCounts(servers);
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
        ...availability,
        ...counts,
        updateEligible: servers.filter((server) => server.connectionState === "online"
            && server.firmwareRelation === "older"
            && server.firmwarePolicy === "follow_stable"
            && server.firmwareChannel === "stable"
            && !server.excluded
            && !server.manualOnly).length,
        updating: servers.filter((server) => !["idle", "done", "failed"].includes(server.updateStatus)).length,
        officialReleases: listReleases(db),
        lastFullCheckAt,
        nextFullCheckAt,
    };
}
export function connectionAvailabilityCounts(servers) {
    let responding = 0;
    let notResponding = 0;
    let availabilityUnknown = 0;
    for (const server of servers) {
        if (server.connectionState === "online" || server.connectionState === "no_access")
            responding += 1;
        else if (server.connectionState === "unavailable" || server.connectionState === "error")
            notResponding += 1;
        else
            availabilityUnknown += 1;
    }
    return { responding, notResponding, availabilityUnknown };
}
