import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
const CAMERA_INTEGRATION_ID = "primary";
const SNAPSHOT_CACHE_MS = 4_000;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const MAX_JPEG_BYTES = 4 * 1024 * 1024;
const LIVE_FRAME_TIMEOUT_MS = 15_000;
const LIVE_PREVIEW_PROBE_TIMEOUT_MS = 5_000;
const LIVE_SUBSCRIBER_BACKPRESSURE_TIMEOUT_MS = 5_000;
const MAX_LIVE_PRODUCERS = 12;
const LIVE_BOUNDARY = "evora-camera-frame";
const LIVE_WARMUP_MIN_FRAMES = {
    preview: 6,
    main: 8,
};
const LIVE_MIN_JPEG_BYTES = {
    preview: 4_096,
    main: 8_192,
};
export class CameraIntegrationError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
function md5(value) {
    return createHash("md5").update(value, "utf8").digest("hex");
}
function unescapeDigestValue(value) {
    return value.replace(/\\(.)/g, "$1");
}
function quoteDigestValue(value) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
export function parseMilesightDigestChallenge(header) {
    if (!header)
        return null;
    const scheme = /(?:^|,\s*)Digest\s+/i.exec(header);
    if (!scheme)
        return null;
    const parameters = new Map();
    const source = header.slice(scheme.index + scheme[0].length);
    const pattern = /(?:^|,)\s*([a-z][a-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/gi;
    for (const match of source.matchAll(pattern)) {
        parameters.set(match[1].toLowerCase(), unescapeDigestValue(match[2] ?? match[3] ?? ""));
    }
    const realm = parameters.get("realm")?.trim() ?? "";
    const nonce = parameters.get("nonce")?.trim() ?? "";
    if (!realm || !nonce)
        return null;
    const algorithmValue = (parameters.get("algorithm") ?? "MD5").trim().toLowerCase();
    const algorithm = algorithmValue === "md5" ? "MD5" : algorithmValue === "md5-sess" ? "MD5-sess" : null;
    if (!algorithm)
        return null;
    const offeredQop = (parameters.get("qop") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    const qop = offeredQop.length === 0 ? null : offeredQop.includes("auth") ? "auth" : undefined;
    if (qop === undefined)
        return null;
    return {
        realm,
        nonce,
        opaque: parameters.get("opaque") ?? null,
        algorithm,
        qop,
        stale: parameters.get("stale")?.toLowerCase() === "true",
    };
}
export function offersMilesightBasicAuthentication(header) {
    return Boolean(header && /(?:^|,\s*)Basic(?:\s|$)/i.test(header));
}
export function milesightBasicAuthorization(username, password) {
    return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function firstString(object, keys) {
    for (const key of keys) {
        const value = object[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return "";
}
function firstInteger(object, keys) {
    for (const key of keys) {
        const value = Number(object[key]);
        if (Number.isInteger(value))
            return value;
    }
    return null;
}
function findCameraArray(value) {
    if (Array.isArray(value)) {
        if (value.some((item) => {
            const object = asObject(item);
            return ["chnid", "chnId", "channel", "channelId", "cameraName", "name", "connectState"].some((key) => key in object);
        }))
            return value;
        for (const item of value) {
            const nested = findCameraArray(item);
            if (nested.length)
                return nested;
        }
        return [];
    }
    for (const nestedValue of Object.values(asObject(value))) {
        const nested = findCameraArray(nestedValue);
        if (nested.length)
            return nested;
    }
    return [];
}
export function isPrivateCameraHost(value) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
        return false;
    const octets = value.split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
        return false;
    return octets[0] === 10
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168);
}
function normalizedPort(value, fallback) {
    const port = value ?? fallback;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new CameraIntegrationError("Port NVR není platný.", "CAMERA_CONFIG_INVALID");
    }
    return port;
}
export function normalizeCameraIntegrationInput(input) {
    const host = input.host.trim();
    const username = input.username.trim();
    if (!isPrivateCameraHost(host)) {
        throw new CameraIntegrationError("NVR musí mít privátní IPv4 adresu v místní síti.", "CAMERA_CONFIG_INVALID");
    }
    if (!username || username.length > 64 || !input.password || input.password.length > 256) {
        throw new CameraIntegrationError("Uživatelské jméno nebo heslo NVR není platné.", "CAMERA_CONFIG_INVALID");
    }
    return {
        name: input.name?.trim().slice(0, 100) || "Kamery · HA Práce",
        host,
        httpPort: normalizedPort(input.httpPort, 80),
        rtspPort: normalizedPort(input.rtspPort, 554),
        username,
        password: input.password,
    };
}
export function milesightDigestAuthorization(username, password, method, uri, challenge, cnonce = randomBytes(16).toString("hex"), nonceCount = 1) {
    const nc = nonceCount.toString(16).padStart(8, "0");
    const initialHa1 = md5(`${username}:${challenge.realm}:${password}`);
    const ha1 = challenge.algorithm === "MD5-sess"
        ? md5(`${initialHa1}:${challenge.nonce}:${cnonce}`)
        : initialHa1;
    const ha2 = md5(`${method}:${uri}`);
    const response = challenge.qop === "auth"
        ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
        : md5(`${ha1}:${challenge.nonce}:${ha2}`);
    const parameters = [
        `username=${quoteDigestValue(username)}`,
        `realm=${quoteDigestValue(challenge.realm)}`,
        `nonce=${quoteDigestValue(challenge.nonce)}`,
        `uri=${quoteDigestValue(uri)}`,
        `response=${quoteDigestValue(response)}`,
        `algorithm=${challenge.algorithm}`,
    ];
    if (challenge.opaque)
        parameters.push(`opaque=${quoteDigestValue(challenge.opaque)}`);
    if (challenge.qop === "auth") {
        parameters.push("qop=auth", `nc=${nc}`, `cnonce=${quoteDigestValue(cnonce)}`);
    }
    return `Digest ${parameters.join(", ")}`;
}
function cameraRequestError(response, deviceLabel) {
    if (response.status === 401 || response.status === 403) {
        return new CameraIntegrationError(deviceLabel === "NVR" ? "NVR odmítlo přihlášení." : "Kamera odmítla přihlášení.", "CAMERA_AUTH_FAILED");
    }
    return new CameraIntegrationError(deviceLabel === "NVR"
        ? `NVR odpovědělo chybou HTTP ${response.status}.`
        : `Kamera odpověděla chybou HTTP ${response.status}.`, "CAMERA_UNAVAILABLE");
}
async function milesightAuthenticatedFetch(target, access, deviceLabel, signal, accept) {
    const uri = `${target.pathname}${target.search}`;
    let response = await fetch(target, {
        method: "GET",
        headers: { Accept: accept },
        signal,
    });
    if (response.status === 401) {
        let challenge = parseMilesightDigestChallenge(response.headers.get("www-authenticate"));
        const basicOffered = offersMilesightBasicAuthentication(response.headers.get("www-authenticate"));
        if (!challenge && !basicOffered) {
            throw new CameraIntegrationError(deviceLabel === "NVR"
                ? "NVR nenabídlo podporované přihlášení."
                : "Kamera nenabídla podporované přihlášení.", "CAMERA_AUTH_FAILED");
        }
        await response.body?.cancel();
        response = await fetch(target, {
            method: "GET",
            headers: {
                Accept: accept,
                Authorization: challenge
                    ? milesightDigestAuthorization(access.username, access.password, "GET", uri, challenge)
                    : milesightBasicAuthorization(access.username, access.password),
            },
            signal,
        });
        if (challenge && response.status === 401) {
            const refreshed = parseMilesightDigestChallenge(response.headers.get("www-authenticate"));
            if (refreshed?.stale) {
                challenge = refreshed;
                await response.body?.cancel();
                response = await fetch(target, {
                    method: "GET",
                    headers: {
                        Accept: accept,
                        Authorization: milesightDigestAuthorization(access.username, access.password, "GET", uri, challenge),
                    },
                    signal,
                });
            }
        }
    }
    if (!response.ok)
        throw cameraRequestError(response, deviceLabel);
    return response;
}
async function milesightSdkRequest(access, action) {
    const target = new URL(`http://${access.host}:${access.httpPort}/sdk.cgi`);
    target.searchParams.set("action", action);
    target.searchParams.set("format", "json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await milesightAuthenticatedFetch(target, access, "NVR", controller.signal, "application/json");
        const text = await response.text();
        try {
            return JSON.parse(text);
        }
        catch {
            throw new CameraIntegrationError("NVR vrátilo nečitelnou odpověď.", "CAMERA_UNAVAILABLE");
        }
    }
    catch (error) {
        if (error instanceof CameraIntegrationError)
            throw error;
        throw new CameraIntegrationError("NVR není z Hubu dostupné.", "CAMERA_UNAVAILABLE");
    }
    finally {
        clearTimeout(timer);
    }
}
export function parseMilesightCameraList(payload) {
    const channels = findCameraArray(payload).map((value, index) => {
        const item = asObject(value);
        const id = firstInteger(item, ["chnid", "chnId", "channelId", "channel", "id"]) ?? index;
        const state = firstInteger(item, ["state"]);
        const connectState = firstInteger(item, ["connectState", "connect_state", "connected"]);
        const reportedAccessPort = firstInteger(item, [
            "channelAccessPort", "channel_access_port", "accessPort", "access_port",
            "virtualPort", "virtual_port", "webPort", "web_port", "httpPort", "http_port", "port",
        ]);
        const channelAccessPort = reportedAccessPort !== null && reportedAccessPort >= 1 && reportedAccessPort <= 65_535
            ? reportedAccessPort
            : null;
        const name = firstString(item, ["name", "cameraName", "camera_name", "channelName", "chan_name"]) || `Kamera ${id + 1}`;
        return {
            id,
            name,
            sourceName: name,
            customName: false,
            online: connectState === 1 || state === 2 || item.online === true,
            model: firstString(item, ["model", "modelName", "model_name", "productModel"]) || null,
            firmware: firstString(item, ["firmware", "firmwareVersion", "fwversion", "softVersion"]) || null,
            streamPath: `ch_1${String(id).padStart(2, "0")}`,
            channelAccessPort,
            channelAccessState: channelAccessPort === null ? "not_configured" : "unknown",
            channelAccessError: null,
            thirdStream: null,
        };
    });
    return channels
        .filter((camera) => Number.isInteger(camera.id) && camera.id >= 0 && camera.id <= 99)
        .sort((left, right) => left.id - right.id);
}
export async function discoverMilesightNvr(input) {
    const access = normalizeCameraIntegrationInput(input);
    // Older Milesight firmware exposes the camera list but rejects the newer
    // get.system.nvr action with HTTP 400. Device metadata is optional for the
    // requested image-only integration, so discovery intentionally performs the
    // single endpoint that the NVR web client itself uses.
    const cameras = await milesightSdkRequest(access, "get.camera.ipclist");
    const channels = parseMilesightCameraList(cameras);
    if (!channels.length) {
        throw new CameraIntegrationError("NVR nevrátilo žádnou připojenou kameru.", "CAMERA_UNAVAILABLE");
    }
    return { vendor: "Milesight", model: "", firmware: "", channels };
}
function preserveCustomCameraNames(previous, discovered) {
    const byId = new Map(previous.map((channel) => [channel.id, channel]));
    return discovered.map((channel) => {
        const existing = byId.get(channel.id);
        if (!existing)
            return channel;
        return {
            ...channel,
            name: existing.customName ? existing.name : channel.name,
            sourceName: channel.sourceName ?? channel.name,
            customName: Boolean(existing.customName),
            channelAccessState: existing.channelAccessPort === channel.channelAccessPort
                ? existing.channelAccessState
                : channel.channelAccessState,
            channelAccessError: existing.channelAccessPort === channel.channelAccessPort
                ? existing.channelAccessError ?? null
                : null,
            thirdStream: existing.channelAccessPort === channel.channelAccessPort
                ? existing.thirdStream ?? null
                : null,
        };
    });
}
function normalizeStoredCameraChannel(channel) {
    return {
        ...channel,
        channelAccessPort: Number.isInteger(channel.channelAccessPort) ? channel.channelAccessPort : null,
        channelAccessState: channel.channelAccessState
            ?? (Number.isInteger(channel.channelAccessPort) ? "unknown" : "not_configured"),
        channelAccessError: channel.channelAccessError ?? null,
        thirdStream: channel.thirdStream ?? null,
    };
}
function rowToOverview(row) {
    if (!row) {
        return {
            configured: false,
            name: "Kamery · HA Práce",
            host: null,
            vendor: null,
            model: null,
            firmware: null,
            connectionState: "unknown",
            lastCheckedAt: null,
            lastSuccessAt: null,
            lastError: null,
            channels: [],
        };
    }
    let channels = [];
    try {
        channels = JSON.parse(row.channels_json).map(normalizeStoredCameraChannel);
    }
    catch {
        channels = [];
    }
    return {
        configured: true,
        name: row.name,
        host: row.host,
        vendor: row.vendor || null,
        model: row.model || null,
        firmware: row.firmware || null,
        connectionState: row.connection_state,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
        channels,
    };
}
function cameraRow(db) {
    return db.prepare("SELECT * FROM camera_integrations WHERE id=?").get(CAMERA_INTEGRATION_ID);
}
export function getCameraOverview(db) {
    return rowToOverview(cameraRow(db));
}
function storedCameraAccess(row) {
    return {
        name: row.name,
        host: row.host,
        httpPort: row.http_port,
        rtspPort: row.rtsp_port,
        username: decryptSecret(row.username_encrypted, config.masterKey, `camera-nvr:${row.id}:username`),
        password: decryptSecret(row.password_encrypted, config.masterKey, `camera-nvr:${row.id}:password`),
    };
}
export async function saveCameraIntegration(db, input) {
    const access = normalizeCameraIntegrationInput(input);
    const discovery = await discoverMilesightNvr(access);
    const previous = cameraRow(db);
    const previousOverview = previous && previous.host === access.host ? rowToOverview(previous) : null;
    const channels = previousOverview
        ? preserveCustomCameraNames(previousOverview.channels, discovery.channels)
        : discovery.channels;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO camera_integrations(
       id,name,host,http_port,rtsp_port,username_encrypted,password_encrypted,vendor,model,firmware,
       connection_state,channels_json,last_checked_at,last_success_at,last_error,created_at,updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,'online',?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,host=excluded.host,http_port=excluded.http_port,rtsp_port=excluded.rtsp_port,
       username_encrypted=excluded.username_encrypted,password_encrypted=excluded.password_encrypted,
       vendor=excluded.vendor,model=excluded.model,firmware=excluded.firmware,connection_state='online',
       channels_json=excluded.channels_json,last_checked_at=excluded.last_checked_at,
       last_success_at=excluded.last_success_at,last_error=NULL,updated_at=excluded.updated_at`).run(CAMERA_INTEGRATION_ID, access.name, access.host, access.httpPort, access.rtspPort, encryptSecret(access.username, config.masterKey, `camera-nvr:${CAMERA_INTEGRATION_ID}:username`), encryptSecret(access.password, config.masterKey, `camera-nvr:${CAMERA_INTEGRATION_ID}:password`), discovery.vendor, discovery.model, discovery.firmware, JSON.stringify(channels), now, now, null, cameraRow(db)?.created_at ?? now, now);
    clearSnapshotCache();
    return getCameraOverview(db);
}
export async function refreshCameraIntegration(db) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const now = new Date().toISOString();
    try {
        const discovery = await discoverMilesightNvr(storedCameraAccess(row));
        const channels = preserveCustomCameraNames(rowToOverview(row).channels, discovery.channels);
        db.prepare(`UPDATE camera_integrations SET vendor=?,model=?,firmware=?,connection_state='online',channels_json=?,
       last_checked_at=?,last_success_at=?,last_error=NULL,updated_at=? WHERE id=?`).run(discovery.vendor, discovery.model, discovery.firmware, JSON.stringify(channels), now, now, now, row.id);
        clearSnapshotCache();
    }
    catch (error) {
        const state = error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED"
            ? "auth_error"
            : "unavailable";
        const message = error instanceof CameraIntegrationError ? error.message : "NVR není dostupné.";
        db.prepare("UPDATE camera_integrations SET connection_state=?,last_checked_at=?,last_error=?,updated_at=? WHERE id=?").run(state, now, message, now, row.id);
        throw error;
    }
    return getCameraOverview(db);
}
export function renameCameraChannel(db, channelId, requestedName) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const name = requestedName.trim();
    if (!name || name.length > 80) {
        throw new CameraIntegrationError("Název kamery musí mít 1 až 80 znaků.", "CAMERA_CONFIG_INVALID");
    }
    const overview = rowToOverview(row);
    const index = overview.channels.findIndex((channel) => channel.id === channelId);
    if (index < 0)
        throw new CameraIntegrationError("Kamera nebyla nalezena.", "CAMERA_CONFIG_INVALID");
    overview.channels[index] = {
        ...overview.channels[index],
        name,
        sourceName: overview.channels[index].sourceName ?? overview.channels[index].name,
        customName: true,
    };
    db.prepare("UPDATE camera_integrations SET channels_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(overview.channels), new Date().toISOString(), row.id);
    return getCameraOverview(db);
}
export function deleteCameraIntegration(db) {
    const removed = Number(db.prepare("DELETE FROM camera_integrations WHERE id=?").run(CAMERA_INTEGRATION_ID).changes) > 0;
    if (removed)
        clearSnapshotCache();
    return removed;
}
const MAX_CAMERA_CGI_BYTES = 2 * 1024 * 1024;
export const CAMERA_HTTP_EVENTS = {
    region_entrance: { index: 9, label: "VCA · vstup do oblasti" },
    region_exit: { index: 10, label: "VCA · opuštění oblasti" },
    loitering: { index: 11, label: "VCA · setrvání v oblasti" },
    advanced_motion: { index: 12, label: "VCA · pokročilý pohyb" },
    line_crossing_1: { index: 13, label: "VCA · překročení čáry 1" },
    people_counting: { index: 14, label: "VCA · počítání osob" },
    human_detection: { index: 15, label: "Detekce člověka" },
    tamper_detection: { index: 16, label: "VCA · zakrytí / sabotáž" },
    line_crossing_2: { index: 20, label: "VCA · překročení čáry 2" },
    line_crossing_3: { index: 21, label: "VCA · překročení čáry 3" },
    line_crossing_4: { index: 22, label: "VCA · překročení čáry 4" },
    object_left_removed: { index: 23, label: "VCA · ponechaný / odebraný předmět" },
};
function unescapeMilesightAssignment(value) {
    return value.replace(/\\([\\'"nrt])/g, (_match, escaped) => {
        if (escaped === "n")
            return "\n";
        if (escaped === "r")
            return "\r";
        if (escaped === "t")
            return "\t";
        return escaped;
    });
}
export function parseMilesightCgiAssignments(payload) {
    const values = {};
    const pattern = /(?:^|[;\r\n])\s*(?:var\s+)?([A-Za-z][A-Za-z0-9_.-]*(?:\[\d+\])?)\s*=\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|([^;\r\n]*))/g;
    for (const match of payload.matchAll(pattern)) {
        const normalizedKey = match[1].replace(/\[(\d+)\]$/, "_$1").toLowerCase();
        values[normalizedKey] = unescapeMilesightAssignment((match[2] ?? match[3] ?? match[4] ?? "").trim());
    }
    return values;
}
function cgiValue(values, ...keys) {
    for (const key of keys) {
        const value = values[key.toLowerCase()];
        if (value !== undefined)
            return value;
    }
    return "";
}
function cgiInteger(values, ...keys) {
    const value = Number(cgiValue(values, ...keys));
    return Number.isFinite(value) && Number.isInteger(value) ? value : null;
}
function cgiBoolean(values, ...keys) {
    return cgiValue(values, ...keys) === "1";
}
function cameraChannelAccess(db, channelId) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const channel = rowToOverview(row).channels.find((item) => item.id === channelId);
    if (!channel)
        throw new CameraIntegrationError("Kamera nebyla nalezena.", "CAMERA_CONFIG_INVALID");
    if (!channel.online)
        throw new CameraIntegrationError("Kamera je podle NVR offline.", "CAMERA_UNAVAILABLE");
    const port = channel.channelAccessPort;
    if (!Number.isInteger(port) || port === null || port < 1 || port > 65_535 || port === row.http_port) {
        throw new CameraIntegrationError("NVR pro tento kanál neposkytlo samostatný Channel Access port. Zapněte Channel Access v Network → More a použijte HTTP transport kamery.", "CAMERA_CAPABILITY_UNSUPPORTED");
    }
    return { row, channel, credentials: storedCameraAccess(row), port };
}
function updateStoredCameraChannel(db, channelId, update) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const overview = rowToOverview(row);
    const index = overview.channels.findIndex((channel) => channel.id === channelId);
    if (index < 0)
        throw new CameraIntegrationError("Kamera nebyla nalezena.", "CAMERA_CONFIG_INVALID");
    overview.channels[index] = update(overview.channels[index]);
    db.prepare("UPDATE camera_integrations SET channels_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(overview.channels), new Date().toISOString(), row.id);
    return overview.channels[index];
}
async function milesightCameraCgiRequest(access, endpoint, action, parameters = {}) {
    const path = endpoint === "admin" ? "/cgi-bin/admin/admin.cgi" : "/cgi-bin/operator/operator.cgi";
    const target = new URL(`http://${access.row.host}:${access.port}${path}`);
    target.searchParams.set("action", action);
    for (const [key, value] of Object.entries(parameters))
        target.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await milesightAuthenticatedFetch(target, access.credentials, "Kamera", controller.signal, "application/json, text/plain, */*;q=0.1");
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > MAX_CAMERA_CGI_BYTES) {
            throw new CameraIntegrationError("Odpověď kamerového API je příliš velká.", "CAMERA_UNAVAILABLE");
        }
        const text = data.toString("utf8");
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch { /* Starší firmware vrací JS/INF přiřazení. */ }
        return { values: parseMilesightCgiAssignments(text), json };
    }
    catch (error) {
        if (error instanceof CameraIntegrationError)
            throw error;
        throw new CameraIntegrationError("Kamera není přes NVR Channel Access dostupná.", "CAMERA_UNAVAILABLE");
    }
    finally {
        clearTimeout(timer);
    }
}
function cameraCodecName(codec) {
    if (codec === 0)
        return "h264";
    if (codec === 1)
        return "mpeg4";
    if (codec === 2)
        return "mjpeg";
    if (codec === 3)
        return "h265";
    return "unknown";
}
function currentThirdStream(values, supported, verifiedAt) {
    const width = cgiInteger(values, "media_profile_resolution_width_2");
    const height = cgiInteger(values, "media_profile_resolution_height_2");
    const codec = cgiInteger(values, "media_profile_codec_2");
    const enabledValue = cgiValue(values, "media_profile_enabled_2");
    if (width === null && height === null && codec === null && !enabledValue)
        return null;
    return {
        supported,
        enabled: enabledValue === "1",
        codec: cameraCodecName(codec),
        width,
        height,
        frameRate: cgiInteger(values, "media_profile_framerate_2"),
        jpegQuality: cgiInteger(values, "media_profile_ratecontrol_quality_2"),
        verifiedAt,
    };
}
function jsonThirdMjpegResolutions(payload) {
    const stream = asObject(asObject(payload).stream_2);
    const mjpeg = asObject(stream.mjpeg);
    const resolutions = Array.isArray(mjpeg.resolution) ? mjpeg.resolution : [];
    return resolutions.flatMap((value) => {
        const item = asObject(value);
        const width = Number(item.width);
        const height = Number(item.height);
        const frameRate = Number(item.frame_rate ?? item.frameRate);
        return Number.isInteger(width) && width > 0
            && Number.isInteger(height) && height > 0
            && Number.isInteger(frameRate) && frameRate > 0
            ? [{ width, height, frameRate }]
            : [];
    });
}
function assignmentThirdMjpegResolutions(values) {
    const byIndex = new Map();
    for (const [key, rawValue] of Object.entries(values)) {
        const match = /^media_resolution_(width|height)_supported_2_(\d+)$/.exec(key);
        if (!match)
            continue;
        const value = Number(rawValue);
        if (!Number.isInteger(value) || value <= 0)
            continue;
        const index = Number(match[2]);
        const resolution = byIndex.get(index) ?? {};
        resolution[match[1]] = value;
        byIndex.set(index, resolution);
    }
    return [...byIndex.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([, value]) => value.width && value.height ? [{ width: value.width, height: value.height }] : []);
}
function uniqueSortedResolutions(resolutions) {
    const unique = new Map();
    for (const resolution of resolutions) {
        unique.set(`${resolution.width}x${resolution.height}`, resolution);
    }
    return [...unique.values()].sort((left, right) => (right.width * right.height) - (left.width * left.height)
        || right.frameRate - left.frameRate);
}
async function probeCameraCapabilities(access) {
    const verifiedAt = new Date().toISOString();
    const general = await milesightCameraCgiRequest(access, "operator", "get.video.general");
    let systemValues = {};
    try {
        systemValues = (await milesightCameraCgiRequest(access, "admin", "get.system.information")).values;
    }
    catch (error) {
        if (error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED")
            throw error;
    }
    let resolutions = [];
    try {
        const frameRates = await milesightCameraCgiRequest(access, "operator", "get.video.framerate");
        resolutions = jsonThirdMjpegResolutions(frameRates.json);
    }
    catch (error) {
        if (error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED")
            throw error;
    }
    if (!resolutions.length) {
        try {
            const options = await milesightCameraCgiRequest(access, "operator", "get.video.options", { codec: 1 });
            const codecMask = cgiInteger(options.values, "media_profile_video_codec_2") ?? 0;
            if ((codecMask & 4) === 4) {
                const supported = assignmentThirdMjpegResolutions(options.values);
                for (const resolution of supported.slice(0, 20)) {
                    let frameRate = 1;
                    try {
                        const parameter = await milesightCameraCgiRequest(access, "operator", "get.video.parameter", {
                            media_profile_resolution_width: resolution.width,
                            media_profile_resolution_height: resolution.height,
                            media_profile_video_codec: 2,
                        });
                        frameRate = cgiInteger(parameter.values, "media_max_framerate_supported") ?? frameRate;
                    }
                    catch (error) {
                        if (error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED")
                            throw error;
                    }
                    resolutions.push({ ...resolution, frameRate });
                }
            }
        }
        catch (error) {
            if (error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED")
                throw error;
        }
    }
    resolutions = uniqueSortedResolutions(resolutions);
    const thirdSupported = resolutions.length > 0;
    const current = currentThirdStream(general.values, thirdSupported, verifiedAt);
    return {
        channelId: access.channel.id,
        route: "nvr_channel_access",
        accessible: true,
        model: cgiValue(systemValues, "model") || cgiValue(general.values, "system_deviceinformation_model") || access.channel.model,
        firmware: cgiValue(systemValues, "system_deviceinformation_firmwareversion", "system_software_version") || access.channel.firmware,
        vcaSupported: cgiBoolean(systemValues, "system_vca_support"),
        humanVehicleSupported: cgiBoolean(systemValues, "system_human_vehicle_support"),
        humanDetectionSupported: cgiBoolean(systemValues, "system_human_detection_support"),
        thirdStream: {
            supported: thirdSupported,
            current,
            recommended: resolutions[0] ?? null,
            mjpegResolutions: resolutions,
        },
    };
}
function cameraAccessFailureState(error) {
    if (error instanceof CameraIntegrationError && error.code === "CAMERA_AUTH_FAILED")
        return "auth_error";
    if (error instanceof CameraIntegrationError && error.code === "CAMERA_CAPABILITY_UNSUPPORTED")
        return "not_configured";
    return "unavailable";
}
export async function getCameraChannelCapabilities(db, channelId) {
    try {
        const access = cameraChannelAccess(db, channelId);
        const capabilities = await probeCameraCapabilities(access);
        updateStoredCameraChannel(db, channelId, (channel) => ({
            ...channel,
            model: capabilities.model ?? channel.model,
            firmware: capabilities.firmware ?? channel.firmware,
            channelAccessState: "available",
            channelAccessError: null,
            thirdStream: capabilities.thirdStream.current,
        }));
        return capabilities;
    }
    catch (error) {
        try {
            updateStoredCameraChannel(db, channelId, (channel) => ({
                ...channel,
                channelAccessState: cameraAccessFailureState(error),
                channelAccessError: error instanceof CameraIntegrationError ? error.message : "Kamerové API není dostupné.",
            }));
        }
        catch { /* Původní chyba je pro volajícího přesnější. */ }
        throw error;
    }
}
export async function optimizeCameraThirdMjpegStream(db, channelId) {
    const access = cameraChannelAccess(db, channelId);
    const before = await probeCameraCapabilities(access);
    const recommended = before.thirdStream.recommended;
    if (!before.thirdStream.supported || !recommended) {
        throw new CameraIntegrationError("Tato kamera třetí MJPEG stream podle vlastního API nepodporuje.", "CAMERA_CAPABILITY_UNSUPPORTED");
    }
    await milesightCameraCgiRequest(access, "operator", "set.video.general", {
        media_profile_enabled_2: 1,
        media_profile_codec_2: 2,
        media_profile_resolution_width_2: recommended.width,
        media_profile_resolution_height_2: recommended.height,
        media_profile_framerate_2: recommended.frameRate,
        media_profile_ratecontrol_quality_2: 75,
    });
    const after = await probeCameraCapabilities(access);
    const current = after.thirdStream.current;
    if (!current?.enabled
        || current.codec !== "mjpeg"
        || current.width !== recommended.width
        || current.height !== recommended.height
        || current.frameRate !== recommended.frameRate
        || (current.jpegQuality ?? 0) < 75) {
        throw new CameraIntegrationError("Kamera po uložení nepotvrdila požadované parametry třetího MJPEG streamu.", "CAMERA_READBACK_FAILED");
    }
    updateStoredCameraChannel(db, channelId, (channel) => ({
        ...channel,
        model: after.model ?? channel.model,
        firmware: after.firmware ?? channel.firmware,
        channelAccessState: "available",
        channelAccessError: null,
        thirdStream: current,
    }));
    clearSnapshotCache();
    return after;
}
function notificationTarget(values, index) {
    const password = cgiValue(values, `notify_password${index}`);
    return {
        enabled: cgiValue(values, `notify_enable${index}`) === "1",
        triggerInterval: cgiInteger(values, `notify_trigger_interval${index}`) ?? 0,
        method: cgiValue(values, `notify_http_method${index}`) === "1" ? "POST" : "GET",
        url: cgiValue(values, `notify_url${index}`),
        username: cgiValue(values, `notify_user_name${index}`),
        hasPassword: password.length > 0,
    };
}
export async function getCameraHttpNotifications(db, channelId, event) {
    const definition = CAMERA_HTTP_EVENTS[event];
    if (!definition)
        throw new CameraIntegrationError("Událost kamery není podporovaná.", "CAMERA_CONFIG_INVALID");
    const access = cameraChannelAccess(db, channelId);
    const alarm = await milesightCameraCgiRequest(access, "operator", "get.alarm.param", { index: definition.index });
    const notify = await milesightCameraCgiRequest(access, "operator", "get.notify.param", { index: definition.index });
    return {
        channelId,
        event,
        eventLabel: definition.label,
        actionEnabled: cgiBoolean(alarm.values, "action_http_notify_enable"),
        targets: [0, 1, 2].map((index) => notificationTarget(notify.values, index)),
        verifiedAt: new Date().toISOString(),
    };
}
function validateNotificationTarget(target) {
    if (!Number.isInteger(target.triggerInterval) || target.triggerInterval < 0 || target.triggerInterval > 900) {
        throw new CameraIntegrationError("Interval HTTP notifikace musí být 0 až 900 sekund.", "CAMERA_CONFIG_INVALID");
    }
    if (target.url.length > 1_024 || target.username.length > 128 || (target.password?.length ?? 0) > 256) {
        throw new CameraIntegrationError("Některá hodnota HTTP notifikace je příliš dlouhá.", "CAMERA_CONFIG_INVALID");
    }
    if (target.enabled) {
        let url;
        try {
            url = new URL(target.url);
        }
        catch {
            throw new CameraIntegrationError("Zapnutá HTTP notifikace musí mít platnou URL.", "CAMERA_CONFIG_INVALID");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new CameraIntegrationError("HTTP notifikace podporuje jen URL http:// nebo https://.", "CAMERA_CONFIG_INVALID");
        }
    }
}
export async function saveCameraHttpNotifications(db, channelId, event, targets) {
    const definition = CAMERA_HTTP_EVENTS[event];
    if (!definition)
        throw new CameraIntegrationError("Událost kamery není podporovaná.", "CAMERA_CONFIG_INVALID");
    if (targets.length !== 3) {
        throw new CameraIntegrationError("Kamera vyžaduje přesně tři pozice HTTP notifikací.", "CAMERA_CONFIG_INVALID");
    }
    targets.forEach(validateNotificationTarget);
    const access = cameraChannelAccess(db, channelId);
    const existing = await milesightCameraCgiRequest(access, "operator", "get.notify.param", { index: definition.index });
    const parameters = { index: definition.index };
    const expectedPasswords = [];
    targets.forEach((target, index) => {
        const currentPassword = cgiValue(existing.values, `notify_password${index}`);
        const password = target.clearPassword ? "" : target.password !== undefined ? target.password : currentPassword;
        expectedPasswords[index] = password;
        parameters[`notify_enable${index}`] = target.enabled ? 1 : 0;
        parameters[`notify_trigger_interval${index}`] = target.triggerInterval;
        parameters[`notify_http_method${index}`] = target.method === "POST" ? 1 : 0;
        parameters[`notify_url${index}`] = target.url;
        parameters[`notify_user_name${index}`] = target.username;
        parameters[`notify_password${index}`] = password;
    });
    await milesightCameraCgiRequest(access, "operator", "set.notify.param", parameters);
    const actionEnabled = targets.some((target) => target.enabled);
    await milesightCameraCgiRequest(access, "operator", "set.alarm.param", {
        index: definition.index,
        action_http_notify_enable: actionEnabled ? 1 : 0,
    });
    const readback = await getCameraHttpNotifications(db, channelId, event);
    const rawReadback = await milesightCameraCgiRequest(access, "operator", "get.notify.param", { index: definition.index });
    const matches = readback.actionEnabled === actionEnabled && readback.targets.every((actual, index) => {
        const expected = targets[index];
        const actualPassword = cgiValue(rawReadback.values, `notify_password${index}`);
        const passwordMatches = !expectedPasswords[index]
            ? !actual.hasPassword
            : actualPassword === expectedPasswords[index] || (/^\*+$/.test(actualPassword) && actual.hasPassword);
        return actual.enabled === expected.enabled
            && actual.triggerInterval === expected.triggerInterval
            && actual.method === expected.method
            && actual.url === expected.url
            && actual.username === expected.username
            && passwordMatches;
    });
    if (!matches) {
        throw new CameraIntegrationError("Kamera po uložení nepotvrdila všechna nastavení HTTP notifikací.", "CAMERA_READBACK_FAILED");
    }
    return readback;
}
export function cameraSnapshotFfmpegArguments() {
    return [
        "-hide_banner", "-loglevel", "quiet", "-threads", "1",
        "-f", "concat", "-safe", "0",
        "-protocol_whitelist", "file,pipe,tcp,udp,rtp,rtsp",
        "-i", "pipe:0",
        "-map", "0:v:0",
        "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "5",
        "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ];
}
const CAMERA_LIVE_STREAM_PROFILES = {
    preview: { fps: 8, maxWidth: 640, jpegQuality: 8, threads: 2 },
    main: { fps: 10, maxWidth: 1_280, jpegQuality: 7, threads: 2 },
};
export function cameraLiveStreamPath(channelId, quality) {
    if (!Number.isInteger(channelId) || channelId < 0 || channelId > 99) {
        throw new CameraIntegrationError("Kamera nebyla nalezena.", "CAMERA_CONFIG_INVALID");
    }
    return `ch_${quality === "preview" ? "4" : "1"}${String(channelId).padStart(2, "0")}`;
}
export function cameraLiveFfmpegArguments(quality) {
    const profile = CAMERA_LIVE_STREAM_PROFILES[quality];
    return [
        "-hide_banner", "-loglevel", "quiet", "-threads", String(profile.threads),
        "-fflags", "+discardcorrupt", "-analyzeduration", "1000000", "-probesize", "2097152",
        "-f", "concat", "-safe", "0",
        "-protocol_whitelist", "file,pipe,tcp,udp,rtp,rtsp",
        "-i", "pipe:0",
        "-map", "0:v:0", "-an", "-sn", "-dn",
        "-vf", `fps=${profile.fps},scale='min(${profile.maxWidth},iw)':-2`,
        "-q:v", String(profile.jpegQuality),
        "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ];
}
export function cameraLiveStreamCandidates(channelId, quality) {
    const preferred = cameraLiveStreamPath(channelId, quality);
    return quality === "preview" ? [preferred, cameraLiveStreamPath(channelId, "main")] : [preferred];
}
export function cameraLiveInitialCandidateIndex(quality, previewPreference) {
    return quality === "preview" && previewPreference === "main" ? 1 : 0;
}
export function cameraLiveStreamSource(quality, streamCandidateIndex) {
    if (quality === "main")
        return "main";
    return streamCandidateIndex === 0 ? "substream" : "main-fallback";
}
export function cameraLiveFrameHeader(quality, streamCandidateIndex, jpegLength) {
    const source = cameraLiveStreamSource(quality, streamCandidateIndex);
    return Buffer.from(`--${LIVE_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegLength}\r\nX-Evora-Stream-Source: ${source}\r\n\r\n`, "ascii");
}
function encodeRtspCredential(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function cameraRtspUrl(input, streamPath) {
    const access = normalizeCameraIntegrationInput(input);
    if (!/^ch_[14]\d{2}$/.test(streamPath)) {
        throw new CameraIntegrationError("Cesta obrazu kamery není platná.", "CAMERA_CONFIG_INVALID");
    }
    const username = encodeRtspCredential(access.username);
    const password = encodeRtspCredential(access.password);
    return `rtsp://${username}:${password}@${access.host}:${access.rtspPort}/${streamPath}`;
}
export function cameraSnapshotInputScript(input, streamPath) {
    return [
        "ffconcat version 1.0",
        `file '${cameraRtspUrl(input, streamPath)}'`,
        "option rtsp_transport tcp",
        "option timeout 8000000",
        "",
    ].join("\n");
}
/**
 * Returns authenticated RTSP sources for the loopback-only video gateway.
 * Callers must keep the returned URLs in memory and must never log or persist
 * them. The URL fragment disables audio/backchannel negotiation so previews
 * carry only the video bytes needed by Hub and Menu.
 */
export function cameraGatewaySources(db, channelId, quality) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const channel = rowToOverview(row).channels.find((item) => item.id === channelId && item.online);
    if (!channel)
        throw new CameraIntegrationError("Kamera nebyla nalezena nebo není připojená.", "CAMERA_CONFIG_INVALID");
    const access = storedCameraAccess(row);
    return cameraLiveStreamCandidates(channelId, quality).map((streamPath, index) => ({
        url: `${cameraRtspUrl(access, streamPath)}#media=video#backchannel=0#timeout=20`,
        source: cameraLiveStreamSource(quality, index),
    }));
}
async function uncachedSnapshot(access, streamPath) {
    return await new Promise((resolve, reject) => {
        const decoder = spawn("ffmpeg", cameraSnapshotFfmpegArguments(), {
            stdio: ["pipe", "pipe", "ignore"],
        });
        let settled = false;
        let output = Buffer.alloc(0);
        const finish = (error, jpeg) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (!decoder.killed)
                decoder.kill("SIGKILL");
            if (error)
                reject(error);
            else if (jpeg)
                resolve(jpeg);
            else
                reject(new CameraIntegrationError("Náhled kamery se nepodařilo vytvořit.", "CAMERA_STREAM_FAILED"));
        };
        const timer = setTimeout(() => finish(new CameraIntegrationError("Kamera neodeslala náhled včas.", "CAMERA_STREAM_FAILED")), SNAPSHOT_TIMEOUT_MS);
        decoder.once("error", () => finish(new CameraIntegrationError("Převod obrazu kamery není dostupný.", "CAMERA_STREAM_FAILED")));
        decoder.stdin.on("error", () => undefined);
        // stderr may contain the authenticated RTSP URL on failures, so the child
        // process is created with stderr disabled instead of logging or retaining it.
        decoder.stdout.on("data", (chunk) => {
            if (settled)
                return;
            output = Buffer.concat([output, chunk]);
            if (output.length > MAX_JPEG_BYTES) {
                finish(new CameraIntegrationError("Náhled kamery je příliš velký.", "CAMERA_STREAM_FAILED"));
                return;
            }
            const end = output.indexOf(Buffer.from([0xff, 0xd9]));
            if (end >= 0)
                finish(undefined, output.subarray(0, end + 2));
        });
        decoder.once("exit", () => {
            if (!settled)
                finish(new CameraIntegrationError("Datový stream kamery není dostupný.", "CAMERA_STREAM_FAILED"));
        });
        decoder.stdin.end(cameraSnapshotInputScript(access, streamPath));
    });
}
const snapshotCache = new Map();
const snapshotInFlight = new Map();
const snapshotQueue = [];
const cameraPreviewStreamPreferences = new Map();
let activeSnapshots = 0;
function runSnapshotQueued(operation) {
    return new Promise((resolve, reject) => {
        const start = () => {
            activeSnapshots += 1;
            void operation().then(resolve, reject).finally(() => {
                activeSnapshots -= 1;
                snapshotQueue.shift()?.();
            });
        };
        if (activeSnapshots < 2)
            start();
        else if (snapshotQueue.length < 20)
            snapshotQueue.push(start);
        else
            reject(new CameraIntegrationError("Fronta náhledů je dočasně plná.", "CAMERA_STREAM_FAILED"));
    });
}
function clearSnapshotCache() {
    snapshotCache.clear();
    cameraPreviewStreamPreferences.clear();
    stopAllCameraLiveProducers();
}
export async function getCameraSnapshot(db, channelId) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const overview = rowToOverview(row);
    const channel = overview.channels.find((item) => item.id === channelId && item.online);
    if (!channel)
        throw new CameraIntegrationError("Kamera nebyla nalezena nebo není připojená.", "CAMERA_CONFIG_INVALID");
    const cached = snapshotCache.get(channelId);
    if (cached && Date.now() - cached.createdAt < SNAPSHOT_CACHE_MS)
        return cached.jpeg;
    const existing = snapshotInFlight.get(channelId);
    if (existing)
        return existing;
    const pending = runSnapshotQueued(() => uncachedSnapshot(storedCameraAccess(row), channel.streamPath))
        .then((jpeg) => {
        snapshotCache.set(channelId, { createdAt: Date.now(), jpeg });
        return jpeg;
    })
        .finally(() => snapshotInFlight.delete(channelId));
    snapshotInFlight.set(channelId, pending);
    return pending;
}
const cameraLiveProducers = new Map();
function stopCameraLiveProducer(producer) {
    if (producer.stopped)
        return;
    producer.stopped = true;
    if (producer.frameTimer)
        clearTimeout(producer.frameTimer);
    cameraLiveProducers.delete(producer.key);
    if (producer.decoder && !producer.decoder.killed)
        producer.decoder.kill("SIGKILL");
    for (const subscriber of producer.subscribers) {
        if (subscriber.drainTimer)
            clearTimeout(subscriber.drainTimer);
        subscriber.stream.end();
    }
    producer.subscribers.clear();
}
function stopAllCameraLiveProducers() {
    for (const producer of cameraLiveProducers.values())
        stopCameraLiveProducer(producer);
}
function armCameraLiveFrameTimeout(producer, decoder) {
    if (producer.frameTimer)
        clearTimeout(producer.frameTimer);
    const timeoutMs = producer.quality === "preview"
        && producer.streamCandidateIndex === 0
        && !producer.receivedFrame
        ? LIVE_PREVIEW_PROBE_TIMEOUT_MS
        : LIVE_FRAME_TIMEOUT_MS;
    producer.frameTimer = setTimeout(() => {
        handleCameraLiveDecoderFailure(producer, decoder);
    }, timeoutMs);
}
function removeCameraLiveSubscriber(producer, subscriber) {
    if (subscriber.drainTimer)
        clearTimeout(subscriber.drainTimer);
    subscriber.drainTimer = undefined;
    producer.subscribers.delete(subscriber);
    if (producer.subscribers.size === 0)
        stopCameraLiveProducer(producer);
}
function publishCameraLiveFrame(producer, jpeg) {
    const header = cameraLiveFrameHeader(producer.quality, producer.streamCandidateIndex, jpeg.length);
    const part = Buffer.concat([header, jpeg, Buffer.from("\r\n", "ascii")]);
    for (const subscriber of producer.subscribers) {
        if (subscriber.blocked || subscriber.stream.destroyed)
            continue;
        if (!subscriber.stream.write(part)) {
            subscriber.blocked = true;
            subscriber.drainTimer = setTimeout(() => {
                subscriber.stream.destroy();
                removeCameraLiveSubscriber(producer, subscriber);
            }, LIVE_SUBSCRIBER_BACKPRESSURE_TIMEOUT_MS);
            subscriber.stream.once("drain", () => {
                if (subscriber.drainTimer)
                    clearTimeout(subscriber.drainTimer);
                subscriber.drainTimer = undefined;
                subscriber.blocked = false;
            });
        }
    }
}
export function cameraLiveFrameIsUsable(quality, jpegLength, warmupFrames, warmupValidFrames) {
    if (jpegLength < LIVE_MIN_JPEG_BYTES[quality])
        return false;
    if (warmupFrames < LIVE_WARMUP_MIN_FRAMES[quality])
        return false;
    return warmupValidFrames >= 2;
}
export function extractCameraJpegFrames(input) {
    const frames = [];
    let remainder = input;
    while (remainder.length > 0) {
        const start = remainder.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
            return { frames, remainder: remainder.subarray(Math.max(0, remainder.length - 1)) };
        }
        if (start > 0)
            remainder = remainder.subarray(start);
        const end = remainder.indexOf(Buffer.from([0xff, 0xd9]), 2);
        if (end < 0)
            return { frames, remainder };
        frames.push(remainder.subarray(0, end + 2));
        remainder = remainder.subarray(end + 2);
    }
    return { frames, remainder };
}
function consumeCameraLiveBytes(producer, chunk) {
    const parsed = extractCameraJpegFrames(Buffer.concat([producer.buffer, chunk]));
    producer.buffer = parsed.remainder;
    if (producer.buffer.length > MAX_JPEG_BYTES) {
        stopCameraLiveProducer(producer);
        return;
    }
    for (const jpeg of parsed.frames) {
        const decoder = producer.decoder;
        if (!decoder)
            return;
        producer.warmupFrames += 1;
        if (jpeg.length < LIVE_MIN_JPEG_BYTES[producer.quality]) {
            producer.warmupValidFrames = 0;
            continue;
        }
        producer.warmupValidFrames += 1;
        if (!producer.receivedFrame && !cameraLiveFrameIsUsable(producer.quality, jpeg.length, producer.warmupFrames, producer.warmupValidFrames))
            continue;
        const firstFrame = !producer.receivedFrame;
        producer.receivedFrame = true;
        if (firstFrame && producer.quality === "preview") {
            cameraPreviewStreamPreferences.set(producer.channelId, producer.streamCandidateIndex === 0 ? "substream" : "main");
        }
        armCameraLiveFrameTimeout(producer, decoder);
        publishCameraLiveFrame(producer, jpeg);
    }
}
function handleCameraLiveDecoderFailure(producer, decoder) {
    if (producer.stopped || producer.decoder !== decoder)
        return;
    if (producer.streamCandidateIndex + 1 < producer.streamCandidates.length) {
        producer.streamCandidateIndex += 1;
        if (!decoder.killed)
            decoder.kill("SIGKILL");
        startCameraLiveDecoder(producer);
        return;
    }
    stopCameraLiveProducer(producer);
}
function startCameraLiveDecoder(producer) {
    const streamPath = producer.streamCandidates[producer.streamCandidateIndex];
    const decoder = spawn("ffmpeg", cameraLiveFfmpegArguments(producer.quality), {
        stdio: ["pipe", "pipe", "ignore"],
    });
    producer.decoder = decoder;
    producer.buffer = Buffer.alloc(0);
    producer.warmupFrames = 0;
    producer.warmupValidFrames = 0;
    producer.receivedFrame = false;
    armCameraLiveFrameTimeout(producer, decoder);
    decoder.once("error", () => handleCameraLiveDecoderFailure(producer, decoder));
    decoder.once("exit", () => handleCameraLiveDecoderFailure(producer, decoder));
    decoder.stdin?.on("error", () => undefined);
    // stderr is intentionally disabled because FFmpeg could repeat the
    // authenticated RTSP input in a diagnostic message.
    decoder.stdout?.on("data", (chunk) => consumeCameraLiveBytes(producer, chunk));
    decoder.stdin?.end(cameraSnapshotInputScript(producer.access, streamPath));
}
function startCameraLiveProducer(access, channelId, quality) {
    if (cameraLiveProducers.size >= MAX_LIVE_PRODUCERS) {
        throw new CameraIntegrationError("Je otevřeno příliš mnoho živých kamer.", "CAMERA_STREAM_LIMIT");
    }
    const key = `${channelId}:${quality}`;
    const producer = {
        key,
        channelId,
        decoder: null,
        subscribers: new Set(),
        buffer: Buffer.alloc(0),
        access,
        quality,
        streamCandidates: cameraLiveStreamCandidates(channelId, quality),
        streamCandidateIndex: cameraLiveInitialCandidateIndex(quality, cameraPreviewStreamPreferences.get(channelId)),
        warmupFrames: 0,
        warmupValidFrames: 0,
        receivedFrame: false,
        stopped: false,
    };
    cameraLiveProducers.set(key, producer);
    startCameraLiveDecoder(producer);
    return producer;
}
export function getCameraLiveStream(db, channelId, quality) {
    const row = cameraRow(db);
    if (!row)
        throw new CameraIntegrationError("NVR zatím není nastavené.", "CAMERA_CONFIG_INVALID");
    const channel = rowToOverview(row).channels.find((item) => item.id === channelId && item.online);
    if (!channel)
        throw new CameraIntegrationError("Kamera nebyla nalezena nebo není připojená.", "CAMERA_CONFIG_INVALID");
    const key = `${channelId}:${quality}`;
    const producer = cameraLiveProducers.get(key)
        ?? startCameraLiveProducer(storedCameraAccess(row), channelId, quality);
    const subscriber = {
        stream: new PassThrough({ highWaterMark: 64 * 1024 }),
        blocked: false,
    };
    producer.subscribers.add(subscriber);
    const remove = () => {
        removeCameraLiveSubscriber(producer, subscriber);
    };
    subscriber.stream.once("close", remove);
    subscriber.stream.once("error", remove);
    return subscriber.stream;
}
let activeCameraThirdStreams = 0;
async function getCameraThirdMjpegStream(db, channelId) {
    const access = cameraChannelAccess(db, channelId);
    const third = access.channel.thirdStream;
    if (!third?.supported || !third.enabled || third.codec !== "mjpeg") {
        throw new CameraIntegrationError("Třetí MJPEG stream kamery zatím není ověřený a zapnutý.", "CAMERA_CAPABILITY_UNSUPPORTED");
    }
    if (activeCameraThirdStreams >= MAX_LIVE_PRODUCERS) {
        throw new CameraIntegrationError("Je otevřeno příliš mnoho přímých živých kamer.", "CAMERA_STREAM_LIMIT");
    }
    const target = new URL(`http://${access.row.host}:${access.port}/ipcam/httpstream.cgi`);
    target.searchParams.set("streamtype", "third");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response;
    try {
        response = await milesightAuthenticatedFetch(target, access.credentials, "Kamera", controller.signal, "multipart/x-mixed-replace, image/jpeg;q=0.8, */*;q=0.1");
    }
    catch (error) {
        clearTimeout(timer);
        controller.abort();
        if (error instanceof CameraIntegrationError)
            throw error;
        throw new CameraIntegrationError("Třetí živý stream kamery není přes NVR dostupný.", "CAMERA_STREAM_FAILED");
    }
    clearTimeout(timer);
    const contentType = response.headers.get("content-type")?.trim() ?? "";
    if (!/^multipart\/x-mixed-replace(?:\s*;[^\r\n]+)?$/i.test(contentType) || !response.body) {
        await response.body?.cancel();
        controller.abort();
        throw new CameraIntegrationError("Kamera nevrátila souvislý MJPEG stream.", "CAMERA_STREAM_FAILED");
    }
    activeCameraThirdStreams += 1;
    const stream = Readable.fromWeb(response.body);
    let released = false;
    const release = () => {
        if (released)
            return;
        released = true;
        activeCameraThirdStreams = Math.max(0, activeCameraThirdStreams - 1);
        controller.abort();
    };
    stream.once("close", release);
    stream.once("end", release);
    stream.once("error", release);
    return { stream, contentType, source: "third-mjpeg" };
}
export async function getPreferredCameraLiveStream(db, channelId, quality) {
    if (quality === "preview") {
        try {
            return await getCameraThirdMjpegStream(db, channelId);
        }
        catch (error) {
            if (error instanceof CameraIntegrationError && error.code === "CAMERA_STREAM_LIMIT")
                throw error;
            // Neověřený nebo nedostupný třetí stream nesmí rozbít dosavadní
            // dlouhou relaci přes hlavní/druhý stream NVR.
        }
    }
    return {
        stream: getCameraLiveStream(db, channelId, quality),
        contentType: cameraLiveContentType(),
        source: "nvr-transcoded",
    };
}
export function cameraLiveContentType() {
    return `multipart/x-mixed-replace; boundary=${LIVE_BOUNDARY}`;
}
