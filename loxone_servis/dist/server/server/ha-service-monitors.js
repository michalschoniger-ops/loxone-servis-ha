import { isIP } from "node:net";
import WebSocket from "ws";
import { config } from "./config.js";
import { decryptSecret } from "./crypto.js";
function safeObject(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function monitorTableExists(db) {
    return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='home_assistant_monitors'").get()?.ok);
}
function mapMonitor(row) {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        enabled: row.enabled === 1,
        state: row.state,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastLatencyMs: row.last_latency_ms,
        lastErrorCode: row.last_error,
        details: safeObject(row.payload_json),
    };
}
export function listHomeAssistantMonitors(db, homeAssistantId) {
    if (!monitorTableExists(db))
        return [];
    const rows = homeAssistantId
        ? db.prepare("SELECT * FROM home_assistant_monitors WHERE home_assistant_id=? ORDER BY kind,id").all(homeAssistantId)
        : db.prepare("SELECT * FROM home_assistant_monitors ORDER BY home_assistant_id,kind,id").all();
    return rows.map(mapMonitor);
}
export function listHomeAssistantMonitorMap(db) {
    const result = new Map();
    if (!monitorTableExists(db))
        return result;
    for (const row of db.prepare("SELECT * FROM home_assistant_monitors ORDER BY home_assistant_id,kind,id").all()) {
        result.set(row.home_assistant_id, [...(result.get(row.home_assistant_id) ?? []), mapMonitor(row)]);
    }
    return result;
}
function classifyFetchError(error) {
    const value = error;
    if (value.name === "TimeoutError" || value.name === "AbortError")
        return "monitor_timeout";
    const code = value.cause?.code ?? value.code;
    return code ? `monitor_${String(code).toLowerCase()}` : "monitor_connection_error";
}
async function fetchHaStates(baseUrl, token) {
    const response = await fetch(`${baseUrl}/api/states`, {
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 12_000)),
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}`,
        },
    });
    if (response.status === 401 || response.status === 403)
        throw Object.assign(new Error("HA API token byl odmítnut."), { code: "token_rejected" });
    if (!response.ok)
        throw Object.assign(new Error(`HA API odpovědělo HTTP ${response.status}.`), { code: `http_${response.status}` });
    const payload = await response.json();
    if (!Array.isArray(payload))
        throw Object.assign(new Error("HA API vrátilo neplatný seznam stavů."), { code: "invalid_states" });
    return payload;
}
async function readConfigEntries(baseUrl, token) {
    const wsUrl = new URL("/api/websocket", baseUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    return await new Promise((resolve, reject) => {
        const socket = new WebSocket(wsUrl, { handshakeTimeout: 8_000, headers: { "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` } });
        const timeout = setTimeout(() => {
            socket.terminate();
            reject(Object.assign(new Error("Vypršel časový limit HA WebSocketu."), { code: "websocket_timeout" }));
        }, 10_000);
        const done = (callback) => {
            clearTimeout(timeout);
            socket.removeAllListeners();
            socket.close();
            callback();
        };
        socket.on("error", (error) => done(() => reject(error)));
        socket.on("message", (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (message.type === "auth_required") {
                socket.send(JSON.stringify({ type: "auth", access_token: token }));
                return;
            }
            if (message.type === "auth_invalid") {
                done(() => reject(Object.assign(new Error("HA WebSocket token byl odmítnut."), { code: "token_rejected" })));
                return;
            }
            if (message.type === "auth_ok") {
                socket.send(JSON.stringify({ id: 1, type: "config_entries/get" }));
                return;
            }
            if (message.type === "result" && message.id === 1) {
                if (message.success !== true || !Array.isArray(message.result)) {
                    done(() => reject(Object.assign(new Error("HA nepovolilo načtení integrací."), { code: "config_entries_unavailable" })));
                    return;
                }
                done(() => resolve(message.result));
            }
        });
    });
}
function stateMap(states) {
    return new Map(states
        .filter((state) => typeof state.entity_id === "string")
        .map((state) => [state.entity_id, state]));
}
export function evaluateMelCloud(states, configValue, integrationEntry, checkedAt = Date.now()) {
    const units = Array.isArray(configValue.units)
        ? configValue.units.filter((unit) => typeof unit === "string")
        : [];
    const values = stateMap(states);
    const details = units.map((unit) => {
        const climate = values.get(`climate.${unit}`);
        const ping = values.get(`binary_sensor.melcloud_${unit}_ping`);
        const pending = values.get(`input_boolean.melcloud_${unit}_write_pending`);
        const pendingSince = typeof pending?.last_changed === "string" ? Date.parse(pending.last_changed) : NaN;
        const pendingSeconds = pending?.state === "on" && Number.isFinite(pendingSince)
            ? Math.max(0, Math.round((checkedAt - pendingSince) / 1_000))
            : 0;
        return {
            id: unit,
            name: typeof climate?.attributes?.friendly_name === "string" ? climate.attributes.friendly_name : unit,
            entityId: `climate.${unit}`,
            climateState: typeof climate?.state === "string" ? climate.state : "missing",
            currentTemperature: typeof climate?.attributes?.current_temperature === "number" ? climate.attributes.current_temperature : null,
            targetTemperature: typeof climate?.attributes?.temperature === "number" ? climate.attributes.temperature : null,
            fanMode: typeof climate?.attributes?.fan_mode === "string" ? climate.attributes.fan_mode : null,
            verticalVane: typeof climate?.attributes?.vane_vertical === "string"
                ? climate.attributes.vane_vertical
                : typeof climate?.attributes?.swing_mode === "string" ? climate.attributes.swing_mode : null,
            horizontalVane: typeof climate?.attributes?.vane_horizontal === "string"
                ? climate.attributes.vane_horizontal
                : typeof climate?.attributes?.swing_horizontal_mode === "string" ? climate.attributes.swing_horizontal_mode : null,
            hvacAction: typeof climate?.attributes?.hvac_action === "string" ? climate.attributes.hvac_action : null,
            available: Boolean(climate && climate.state !== "unavailable" && climate.state !== "unknown"),
            ping: typeof ping?.state === "string" ? ping.state : "missing",
            writePending: pending?.state === "on",
            pendingSeconds,
        };
    });
    const integrationState = typeof integrationEntry?.state === "string" ? integrationEntry.state : "unknown";
    const missing = details.filter((unit) => !unit.available).length;
    const pingProblems = details.filter((unit) => unit.ping !== "on").length;
    const staleWrites = details.filter((unit) => unit.writePending && unit.pendingSeconds >= 120).length;
    let state = "online";
    let errorCode = null;
    if (!details.length || missing === details.length) {
        state = "unavailable";
        errorCode = "melcloud_units_unavailable";
    }
    else if (integrationState !== "loaded" || missing || pingProblems || staleWrites) {
        state = "warning";
        errorCode = integrationState !== "loaded" ? "melcloud_integration_not_loaded"
            : missing ? "melcloud_unit_unavailable"
                : pingProblems ? "melcloud_unit_unreachable"
                    : "melcloud_write_pending";
    }
    return {
        state,
        errorCode,
        details: {
            integration: {
                id: typeof integrationEntry?.entry_id === "string" ? integrationEntry.entry_id : configValue.configEntryId ?? null,
                title: typeof integrationEntry?.title === "string" ? integrationEntry.title : "MELCloud",
                state: integrationState,
            },
            units: details,
            summary: { total: details.length, available: details.length - missing, pingProblems, staleWrites },
        },
    };
}
async function checkMelCloud(row, access) {
    const started = Date.now();
    if (!access.access_token_encrypted) {
        return { id: row.id, state: "unavailable", latencyMs: 0, errorCode: "access_token_missing", details: { message: "Chybí dlouhodobý HA token." } };
    }
    try {
        const token = decryptSecret(access.access_token_encrypted, config.masterKey, `home-assistant:${access.id}:access-token`);
        const configValue = safeObject(row.config_json);
        const [states, entries] = await Promise.all([
            fetchHaStates(access.base_url, token),
            readConfigEntries(access.base_url, token).catch(() => []),
        ]);
        const configuredId = typeof configValue.configEntryId === "string" ? configValue.configEntryId : "";
        const integrationEntry = entries.find((entry) => entry.entry_id === configuredId)
            ?? entries.find((entry) => entry.domain === "melcloud")
            ?? null;
        const evaluated = evaluateMelCloud(states, configValue, integrationEntry);
        return { id: row.id, latencyMs: Date.now() - started, ...evaluated };
    }
    catch (error) {
        return {
            id: row.id,
            state: "unavailable",
            latencyMs: Date.now() - started,
            errorCode: error.code ?? classifyFetchError(error),
            details: { message: error.message },
        };
    }
}
export function normalizeSolarInvertUrl(value) {
    if (typeof value !== "string")
        throw Object.assign(new Error("Chybí adresa SolarInvert Loggeru."), { code: "solarinvert_url_missing" });
    const parsed = new URL(value);
    const host = parsed.hostname;
    const privateTailnet = isIP(host) === 4 && host.startsWith("100.") && Number(host.split(".")[1]) >= 64 && Number(host.split(".")[1]) <= 127;
    const herskovicTailnetHost = host === "homeassistant-herskovic.skunk-atria.ts.net";
    if (parsed.protocol !== "http:" || (!privateTailnet && !herskovicTailnetHost) || parsed.port !== "8765" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw Object.assign(new Error("SolarInvert Logger musí používat schválenou Tailscale adresu na portu 8765."), { code: "solarinvert_url_invalid" });
    }
    return parsed.toString().replace(/\/$/, "");
}
async function fetchJson(url, headers = {}) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 10_000)),
        headers: { Accept: "application/json", "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}`, ...headers },
    });
    let payload = {};
    try {
        const value = await response.json();
        if (value && typeof value === "object" && !Array.isArray(value))
            payload = value;
    }
    catch {
        // HTTP stav zůstává použitelný i při neplatném těle.
    }
    return { ok: response.ok, status: response.status, payload };
}
async function supervisorApi(baseUrl, token, endpoint, method = "get", data) {
    const wsUrl = new URL("/api/websocket", baseUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    return await new Promise((resolve, reject) => {
        const socket = new WebSocket(wsUrl, { handshakeTimeout: 8_000, headers: { "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` } });
        const timeout = setTimeout(() => {
            socket.terminate();
            reject(Object.assign(new Error("Vypršel časový limit Supervisor API."), { code: "supervisor_timeout" }));
        }, 12_000);
        const finish = (callback) => {
            clearTimeout(timeout);
            socket.removeAllListeners();
            socket.close();
            callback();
        };
        socket.on("error", (error) => finish(() => reject(error)));
        socket.on("message", (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (message.type === "auth_required") {
                socket.send(JSON.stringify({ type: "auth", access_token: token }));
                return;
            }
            if (message.type === "auth_invalid") {
                finish(() => reject(Object.assign(new Error("HA Supervisor token byl odmítnut."), { code: "token_rejected" })));
                return;
            }
            if (message.type === "auth_ok") {
                socket.send(JSON.stringify({ id: 1, type: "supervisor/api", endpoint, method, ...(data === undefined ? {} : { data }) }));
                return;
            }
            if (message.type === "result" && message.id === 1) {
                if (message.success !== true || !message.result || typeof message.result !== "object") {
                    const error = message.error && typeof message.error === "object" ? message.error : {};
                    finish(() => reject(Object.assign(new Error(String(error.message ?? "Supervisor API požadavek selhal.")), { code: String(error.code ?? "supervisor_error") })));
                    return;
                }
                const result = message.result;
                const body = result.data && typeof result.data === "object" ? result.data : result;
                finish(() => resolve(body));
            }
        });
    });
}
export function normalizeIngressUrl(baseUrl, value) {
    if (typeof value !== "string" || !/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+\/?$/.test(value)) {
        throw Object.assign(new Error("SolarInvert doplněk neposkytl platnou Ingress adresu."), { code: "solarinvert_ingress_url_invalid" });
    }
    const normalizedPath = value.endsWith("/") ? value : `${value}/`;
    return new URL(normalizedPath, baseUrl).toString();
}
async function fetchSolarEndpoints(baseUrl, headers = {}) {
    return await Promise.all([
        fetchJson(new URL("healthz", baseUrl).toString(), headers),
        fetchJson(new URL("readyz", baseUrl).toString(), headers),
        fetchJson(new URL("api/v1/status", baseUrl).toString(), headers),
    ]);
}
async function fetchSolarViaIngress(access, configValue) {
    if (!access.access_token_encrypted)
        throw Object.assign(new Error("Chybí dlouhodobý HA token."), { code: "access_token_missing" });
    const token = decryptSecret(access.access_token_encrypted, config.masterKey, `home-assistant:${access.id}:access-token`);
    const addonSlug = typeof configValue.addonSlug === "string" ? configValue.addonSlug : "local_solarinvert_logger";
    if (!/^local_[a-z0-9_]+$/.test(addonSlug))
        throw Object.assign(new Error("Neplatný identifikátor SolarInvert doplňku."), { code: "solarinvert_addon_invalid" });
    const addon = await supervisorApi(access.base_url, token, `/addons/${addonSlug}/info`);
    if (addon.state !== "started" || addon.ingress !== true) {
        throw Object.assign(new Error("SolarInvert doplněk neběží nebo nemá zapnutý Ingress."), { code: "solarinvert_addon_unavailable" });
    }
    const ingressBaseUrl = normalizeIngressUrl(access.base_url, addon.ingress_url);
    const ingress = await supervisorApi(access.base_url, token, "/ingress/session", "post", {});
    if (typeof ingress.session !== "string" || !/^[A-Za-z0-9_-]+$/.test(ingress.session)) {
        throw Object.assign(new Error("Supervisor nevytvořil platné Ingress spojení."), { code: "solarinvert_ingress_session_invalid" });
    }
    return await fetchSolarEndpoints(ingressBaseUrl, {
        Authorization: `Bearer ${token}`,
        Cookie: `ingress_session=${ingress.session}`,
    });
}
export function evaluateSolarInvert(health, readiness, status, checkedAt = Date.now()) {
    const logger = status.payload.logger && typeof status.payload.logger === "object"
        ? status.payload.logger
        : {};
    const rawDevices = status.payload.devices && typeof status.payload.devices === "object"
        ? status.payload.devices
        : {};
    const devices = Object.values(rawDevices).filter((value) => Boolean(value && typeof value === "object" && !Array.isArray(value))).map((device) => ({
        slaveId: typeof device.slave_id === "number" ? device.slave_id : null,
        serial: typeof device.serial === "string" ? device.serial : null,
        model: typeof device.model === "string" ? device.model : null,
        online: device.online === true,
        lastSeen: typeof device.last_seen === "string" ? device.last_seen : null,
        lastError: typeof device.last_error === "string" ? device.last_error : null,
    }));
    const updatedAt = typeof logger.updated_at === "string" ? Date.parse(logger.updated_at) : NaN;
    const staleSeconds = Number.isFinite(updatedAt) ? Math.max(0, Math.round((checkedAt - updatedAt) / 1_000)) : null;
    const ready = readiness.ok && readiness.payload.ready === true;
    const onlineDevices = devices.filter((device) => device.online).length;
    const loxoneOk = logger.loxone_enabled !== true || logger.loxone_connected === true;
    const queue = typeof logger.cloud_queue === "number" ? logger.cloud_queue : 0;
    const hardFailure = !health.ok || !readiness.ok || !status.ok || !ready || logger.status !== "online" || !devices.length || onlineDevices === 0;
    const warning = !hardFailure && (onlineDevices !== devices.length
        || logger.usb_online !== true
        || logger.cloud_reporting !== "online"
        || logger.cloud_online !== true
        || logger.cloud_worker_alive !== true
        || !loxoneOk
        || queue > 0
        || staleSeconds === null
        || staleSeconds > 60);
    return {
        state: hardFailure ? "unavailable" : warning ? "warning" : "online",
        errorCode: hardFailure ? "solarinvert_unavailable" : warning ? "solarinvert_degraded" : null,
        details: {
            endpoints: { health: health.ok, ready, status: status.ok },
            logger: {
                state: logger.status ?? "unknown",
                updatedAt: typeof logger.updated_at === "string" ? logger.updated_at : null,
                staleSeconds,
                usbOnline: logger.usb_online === true,
                cloudReporting: logger.cloud_reporting ?? "unknown",
                cloudOnline: logger.cloud_online === true,
                cloudWorkerAlive: logger.cloud_worker_alive === true,
                cloudQueue: queue,
                loxoneEnabled: logger.loxone_enabled === true,
                loxoneConnected: logger.loxone_connected === true,
            },
            devices,
            summary: { total: devices.length, online: onlineDevices },
        },
    };
}
async function checkSolarInvert(row, access) {
    const started = Date.now();
    try {
        const configValue = safeObject(row.config_json);
        const [health, readiness, status] = configValue.transport === "ha_ingress"
            ? await fetchSolarViaIngress(access, configValue)
            : await fetchSolarEndpoints(`${normalizeSolarInvertUrl(configValue.baseUrl)}/`);
        const evaluated = evaluateSolarInvert(health, readiness, status);
        return { id: row.id, latencyMs: Date.now() - started, ...evaluated };
    }
    catch (error) {
        return {
            id: row.id,
            state: "unavailable",
            latencyMs: Date.now() - started,
            errorCode: error.code ?? classifyFetchError(error),
            details: { message: error.message },
        };
    }
}
export async function checkHomeAssistantMonitors(db, homeAssistantId) {
    if (!monitorTableExists(db))
        return [];
    const access = db.prepare("SELECT id,base_url,access_token_encrypted FROM home_assistant_instances WHERE id=?").get(homeAssistantId);
    if (!access)
        return [];
    const rows = db.prepare("SELECT * FROM home_assistant_monitors WHERE home_assistant_id=? AND enabled=1 ORDER BY kind,id").all(homeAssistantId);
    return await Promise.all(rows.map((row) => row.kind === "melcloud" ? checkMelCloud(row, access) : checkSolarInvert(row, access)));
}
export function persistHomeAssistantMonitorCheck(db, result) {
    const now = new Date().toISOString();
    const previous = db.prepare("SELECT state FROM home_assistant_monitors WHERE id=?").get(result.id);
    db.prepare(`UPDATE home_assistant_monitors SET state=?,last_checked_at=?,
       last_success_at=CASE WHEN ?!='unavailable' THEN ? ELSE last_success_at END,
       last_latency_ms=?,last_error=?,payload_json=?,updated_at=? WHERE id=?`).run(result.state, now, result.state, now, result.latencyMs, result.errorCode, JSON.stringify(result.details), now, result.id);
    if (previous?.state !== result.state) {
        db.prepare("INSERT INTO home_assistant_monitor_events(monitor_id,state,error_code,payload_json,created_at) VALUES(?,?,?,?,?)").run(result.id, result.state, result.errorCode, JSON.stringify(result.details), now);
    }
}
export function purgeHomeAssistantMonitorEvents(db) {
    if (!monitorTableExists(db))
        return 0;
    return Number(db.prepare("DELETE FROM home_assistant_monitor_events WHERE created_at < datetime('now','-13 months')").run().changes);
}
