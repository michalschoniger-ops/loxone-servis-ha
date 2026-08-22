import { isIP } from "node:net";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { listHomeAssistantMonitorMap, listHomeAssistantMonitors } from "./ha-service-monitors.js";
function notificationTarget() {
    if (!config.haNotifyService)
        return null;
    const match = config.haNotifyService.match(/^([a-z0-9_]+)\.([a-z0-9_]+)$/i);
    return match ? { domain: match[1], service: match[2] } : null;
}
export async function notifyHomeAssistant(options) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (!supervisorToken)
        return false;
    const target = notificationTarget();
    const url = options.path && config.publicBaseUrl
        ? new URL(options.path.replace(/^\//, ""), `${config.publicBaseUrl.replace(/\/$/, "")}/`).toString()
        : config.publicBaseUrl || undefined;
    const endpoint = target
        ? `http://supervisor/core/api/services/${target.domain}/${target.service}`
        : "http://supervisor/core/api/services/persistent_notification/create";
    const payload = target
        ? {
            title: options.title,
            message: options.message,
            data: url ? { url, clickAction: url } : {},
        }
        : {
            title: options.title,
            message: url ? `${options.message}\n\n${url}` : options.message,
            notification_id: `loxone_servis_${options.id.replace(/[^a-z0-9_]/gi, "_")}`,
        };
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${supervisorToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
export class HomeAssistantServiceError extends Error {
    code;
    statusCode;
    reason;
    constructor(message, code, statusCode, reason) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.reason = reason;
        this.name = "HomeAssistantServiceError";
    }
}
function parseUpdates(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [];
        return parsed.flatMap((item) => {
            if (!item || typeof item !== "object" || typeof item.entityId !== "string")
                return [];
            const update = item;
            const supportedFeatures = Number.isInteger(update.supportedFeatures) && Number(update.supportedFeatures) >= 0
                ? Number(update.supportedFeatures)
                : 0;
            return [{
                    entityId: update.entityId,
                    title: typeof update.title === "string" ? update.title : update.entityId,
                    installedVersion: typeof update.installedVersion === "string" ? update.installedVersion : null,
                    latestVersion: typeof update.latestVersion === "string" ? update.latestVersion : null,
                    category: update.category ?? updateCategory(update.entityId),
                    supportedFeatures,
                    backupSupported: update.backupSupported === true || (supportedFeatures & 8) === 8,
                }];
        });
    }
    catch {
        return [];
    }
}
function updateCategory(entityId) {
    if (entityId === "update.home_assistant_core_update")
        return "core";
    if (entityId === "update.home_assistant_supervisor_update")
        return "supervisor";
    if (entityId === "update.home_assistant_operating_system_update")
        return "os";
    if (entityId.includes("addon"))
        return "addon";
    if (entityId.includes("integration"))
        return "integration";
    return "other";
}
function isPrivateIpv4(hostname) {
    if (isIP(hostname) !== 4)
        return false;
    const octets = hostname.split(".").map(Number);
    return octets[0] === 10
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168)
        || octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
export function normalizeHomeAssistantUrl(value) {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("Adresa Home Assistantu musí být čistá HTTP(S) URL bez přihlašovacích údajů a parametrů.");
    }
    if (parsed.pathname !== "/")
        throw new Error("Adresa Home Assistantu nesmí obsahovat cestu.");
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const allowedHost = hostname.endsWith(".ts.net")
        || hostname.endsWith(".ui.nabu.casa")
        || isPrivateIpv4(hostname)
        || (isIP(hostname) === 6 && (hostname.startsWith("fc") || hostname.startsWith("fd")));
    if (!allowedHost)
        throw new Error("Povolena je Tailscale, Nabu Casa nebo privátní LAN adresa.");
    if (parsed.protocol === "http:" && !hostname.endsWith(".ts.net") && !isPrivateIpv4(hostname)) {
        throw new Error("Nešifrované HTTP je povoleno jen v Tailscale nebo privátní LAN síti.");
    }
    if (parsed.port && !["443", "8123", "8443"].includes(parsed.port)) {
        throw new Error("Povolené porty jsou 443, 8123 a 8443.");
    }
    parsed.pathname = "";
    return parsed.toString().replace(/\/$/, "");
}
function mapRow(row, monitors = []) {
    const updates = parseUpdates(row.updates_json);
    return {
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        hasCredentials: Boolean(row.username_encrypted && row.password_encrypted),
        hasAccessToken: Boolean(row.access_token_encrypted),
        monitoringEnabled: row.monitoring_enabled === 1,
        connectionState: row.connection_state,
        authState: row.auth_state,
        version: row.version,
        locationName: row.location_name,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastLatencyMs: row.last_latency_ms,
        lastErrorCode: row.last_error,
        updates,
        pendingUpdates: updates.length,
        updatesCheckedAt: row.updates_checked_at,
        monitors,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listHomeAssistantInstances(db) {
    const monitors = listHomeAssistantMonitorMap(db);
    return db.prepare("SELECT * FROM home_assistant_instances ORDER BY name COLLATE NOCASE,id").all()
        .map((row) => mapRow(row, monitors.get(row.id) ?? []));
}
export function getHomeAssistantInstance(db, id) {
    const row = db.prepare("SELECT * FROM home_assistant_instances WHERE id=?").get(id);
    return row ? mapRow(row, listHomeAssistantMonitors(db, id)) : null;
}
function decryptOptional(value, id, field) {
    return value ? decryptSecret(value, config.masterKey, `home-assistant:${id}:${field}`) : null;
}
export function getHomeAssistantCredentials(db, id) {
    const row = db.prepare("SELECT username_encrypted,password_encrypted FROM home_assistant_instances WHERE id=?").get(id);
    if (!row?.username_encrypted || !row.password_encrypted)
        return null;
    return {
        username: decryptOptional(row.username_encrypted, id, "username"),
        password: decryptOptional(row.password_encrypted, id, "password"),
    };
}
export function getHomeAssistantAccessToken(db, id) {
    const row = db.prepare("SELECT base_url,access_token_encrypted FROM home_assistant_instances WHERE id=?").get(id);
    if (!row?.access_token_encrypted)
        return null;
    return { baseUrl: row.base_url, token: decryptOptional(row.access_token_encrypted, id, "access-token") };
}
export async function callHomeAssistantService(db, id, domain, service, data = {}) {
    const allowed = (domain === "homeassistant" && service === "restart") || (domain === "update" && service === "install");
    if (!allowed)
        throw new Error("Tato služba Home Assistantu není povolena.");
    const access = getHomeAssistantAccessToken(db, id);
    if (!access) {
        throw new HomeAssistantServiceError("Home Assistant nemá uložený dlouhodobý API token.", "HOME_ASSISTANT_TOKEN_NOT_CONFIGURED", 409, "not_configured");
    }
    let response;
    try {
        response = await fetch(`${access.baseUrl}/api/services/${domain}/${service}`, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 20_000)),
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${access.token}`,
                "Content-Type": "application/json",
                "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}`,
            },
            body: JSON.stringify(data),
        });
    }
    catch {
        throw new HomeAssistantServiceError("Home Assistant není dostupný. Zkontrolujte síťové spojení a zkuste akci znovu.", "HOME_ASSISTANT_UNAVAILABLE", 502, "unavailable");
    }
    if (response.ok)
        return;
    const responseText = (await response.text().catch(() => "")).slice(0, 2_000).toLocaleLowerCase("en");
    if (response.status === 401 || response.status === 403) {
        throw new HomeAssistantServiceError("Home Assistant odmítl API token nebo token nepatří správci.", "HOME_ASSISTANT_AUTH_REJECTED", 403, "authentication_rejected");
    }
    if (response.status === 400 && responseText.includes("backup") && responseText.includes("not supported")) {
        throw new HomeAssistantServiceError("Tato aktualizace nepodporuje automatickou zálohu.", "HOME_ASSISTANT_BACKUP_NOT_SUPPORTED", 409, "backup_not_supported");
    }
    if (response.status === 404) {
        throw new HomeAssistantServiceError("Aktualizační služba není na tomto Home Assistantu dostupná.", "HOME_ASSISTANT_SERVICE_NOT_FOUND", 502, "service_not_found");
    }
    throw new HomeAssistantServiceError("Home Assistant aktualizaci odmítl. Obnovte kontrolu a ověřte stav cílové aktualizace.", "HOME_ASSISTANT_SERVICE_REJECTED", 502, "request_rejected");
}
export async function installHomeAssistantUpdate(db, id, update) {
    const data = { entity_id: update.entityId };
    if (update.backupSupported)
        data.backup = true;
    try {
        await callHomeAssistantService(db, id, "update", "install", data);
        return { backupRequested: update.backupSupported, backupFallback: false };
    }
    catch (error) {
        if (!(error instanceof HomeAssistantServiceError) || error.reason !== "backup_not_supported" || !update.backupSupported)
            throw error;
        await callHomeAssistantService(db, id, "update", "install", { entity_id: update.entityId });
        return { backupRequested: true, backupFallback: true };
    }
}
export function saveHomeAssistantSecrets(db, id, secrets) {
    const fields = [];
    const values = [];
    if (secrets.username !== undefined || secrets.password !== undefined) {
        if (!secrets.username || !secrets.password)
            throw new Error("Uživatelské jméno a heslo musí být vyplněné společně.");
        fields.push("username_encrypted=?", "password_encrypted=?");
        values.push(encryptSecret(secrets.username, config.masterKey, `home-assistant:${id}:username`), encryptSecret(secrets.password, config.masterKey, `home-assistant:${id}:password`));
    }
    if (secrets.accessToken !== undefined) {
        fields.push("access_token_encrypted=?", "auth_state='unknown'");
        values.push(encryptSecret(secrets.accessToken, config.masterKey, `home-assistant:${id}:access-token`));
    }
    if (!fields.length)
        return;
    fields.push("updated_at=?");
    values.push(new Date().toISOString(), id);
    db.prepare(`UPDATE home_assistant_instances SET ${fields.join(",")} WHERE id=?`).run(...values);
}
export function clearHomeAssistantSecrets(db, id, selection) {
    const fields = [];
    if (selection.credentials)
        fields.push("username_encrypted=NULL", "password_encrypted=NULL");
    if (selection.accessToken)
        fields.push("access_token_encrypted=NULL", "auth_state='not_configured'");
    if (!fields.length)
        return;
    fields.push("updated_at=?");
    db.prepare(`UPDATE home_assistant_instances SET ${fields.join(",")} WHERE id=?`).run(new Date().toISOString(), id);
}
function classifyFetchError(error) {
    const value = error;
    if (value.name === "TimeoutError" || value.name === "AbortError")
        return "connection_timeout";
    const code = value.cause?.code ?? value.code ?? "";
    return ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)
        ? "connection_refused"
        : "connection_error";
}
export async function checkHomeAssistant(db, id) {
    const row = db.prepare("SELECT * FROM home_assistant_instances WHERE id=?").get(id);
    if (!row)
        throw new Error("Home Assistant nebyl nalezen.");
    const started = Date.now();
    let token = null;
    try {
        const response = await fetch(`${row.base_url}/`, {
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 12_000)),
            headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` },
        });
        if (response.status < 200 || response.status >= 400) {
            return { connectionState: "unavailable", authState: row.auth_state, version: null, locationName: null, latencyMs: Date.now() - started, errorCode: `http_${response.status}`, updates: [] };
        }
        if (!row.access_token_encrypted) {
            return { connectionState: "online", authState: "not_configured", version: null, locationName: null, latencyMs: Date.now() - started, errorCode: null, updates: [] };
        }
        token = decryptOptional(row.access_token_encrypted, id, "access-token");
        const configResponse = await fetch(`${row.base_url}/api/config`, {
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 12_000)),
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
                "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}`,
            },
        });
        if (configResponse.status === 401 || configResponse.status === 403) {
            return { connectionState: "online", authState: "invalid", version: null, locationName: null, latencyMs: Date.now() - started, errorCode: "token_rejected", updates: [] };
        }
        if (!configResponse.ok) {
            return { connectionState: "online", authState: "unknown", version: null, locationName: null, latencyMs: Date.now() - started, errorCode: `api_http_${configResponse.status}`, updates: [] };
        }
        const payload = await configResponse.json();
        let updates = parseUpdates(row.updates_json);
        try {
            const statesResponse = await fetch(`${row.base_url}/api/states`, {
                redirect: "manual",
                signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 15_000)),
                headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` },
            });
            if (statesResponse.ok) {
                const states = await statesResponse.json();
                updates = states.filter((state) => typeof state.entity_id === "string" && state.entity_id.startsWith("update.") && state.state === "on")
                    .map((state) => {
                    const supportedFeatures = typeof state.attributes?.supported_features === "number" && Number.isInteger(state.attributes.supported_features)
                        ? state.attributes.supported_features
                        : 0;
                    return {
                        entityId: String(state.entity_id),
                        title: String(state.attributes?.friendly_name ?? state.attributes?.title ?? state.entity_id),
                        installedVersion: typeof state.attributes?.installed_version === "string" ? state.attributes.installed_version : null,
                        latestVersion: typeof state.attributes?.latest_version === "string" ? state.attributes.latest_version : null,
                        category: updateCategory(String(state.entity_id)),
                        supportedFeatures,
                        backupSupported: (supportedFeatures & 8) === 8,
                    };
                });
            }
        }
        catch {
            // Krátký výpadek stavového API nesmí smazat naposledy ověřený seznam aktualizací.
        }
        return {
            connectionState: "online",
            authState: "valid",
            version: typeof payload.version === "string" ? payload.version : null,
            locationName: typeof payload.location_name === "string" ? payload.location_name : null,
            latencyMs: Date.now() - started,
            errorCode: null,
            updates,
        };
    }
    catch (error) {
        return {
            connectionState: "unavailable",
            authState: token ? "unknown" : row.auth_state,
            version: null,
            locationName: null,
            latencyMs: Date.now() - started,
            errorCode: classifyFetchError(error),
            updates: parseUpdates(row.updates_json),
        };
    }
}
export function persistHomeAssistantCheck(db, id, result) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE home_assistant_instances SET connection_state=?,auth_state=?,version=COALESCE(?,version),
      location_name=COALESCE(?,location_name),last_checked_at=?,last_success_at=CASE WHEN ?='online' THEN ? ELSE last_success_at END,
      last_latency_ms=?,last_error=?,updates_json=?,updates_checked_at=?,updated_at=? WHERE id=?`).run(result.connectionState, result.authState, result.version, result.locationName, now, result.connectionState, now, result.latencyMs, result.errorCode, JSON.stringify(result.updates), now, now, id);
}
