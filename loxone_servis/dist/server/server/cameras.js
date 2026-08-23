import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
const CAMERA_INTEGRATION_ID = "primary";
const SNAPSHOT_CACHE_MS = 4_000;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const MAX_JPEG_BYTES = 4 * 1024 * 1024;
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
function cameraRequestError(response) {
    if (response.status === 401 || response.status === 403) {
        return new CameraIntegrationError("NVR odmítlo přihlášení.", "CAMERA_AUTH_FAILED");
    }
    return new CameraIntegrationError(`NVR odpovědělo chybou HTTP ${response.status}.`, "CAMERA_UNAVAILABLE");
}
async function milesightSdkRequest(access, action) {
    const target = new URL(`http://${access.host}:${access.httpPort}/sdk.cgi`);
    target.searchParams.set("action", action);
    target.searchParams.set("format", "json");
    const uri = `${target.pathname}${target.search}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
        let response = await fetch(target, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (response.status === 401) {
            let challenge = parseMilesightDigestChallenge(response.headers.get("www-authenticate"));
            const basicOffered = offersMilesightBasicAuthentication(response.headers.get("www-authenticate"));
            if (!challenge && !basicOffered) {
                throw new CameraIntegrationError("NVR nenabídlo podporované přihlášení.", "CAMERA_AUTH_FAILED");
            }
            await response.body?.cancel();
            response = await fetch(target, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: challenge
                        ? milesightDigestAuthorization(access.username, access.password, "GET", uri, challenge)
                        : milesightBasicAuthorization(access.username, access.password),
                },
                signal: controller.signal,
            });
            if (challenge && response.status === 401) {
                const refreshed = parseMilesightDigestChallenge(response.headers.get("www-authenticate"));
                if (refreshed?.stale) {
                    challenge = refreshed;
                    await response.body?.cancel();
                    response = await fetch(target, {
                        method: "GET",
                        headers: {
                            Accept: "application/json",
                            Authorization: milesightDigestAuthorization(access.username, access.password, "GET", uri, challenge),
                        },
                        signal: controller.signal,
                    });
                }
            }
        }
        if (!response.ok)
            throw cameraRequestError(response);
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
        };
    });
    return channels
        .filter((camera) => Number.isInteger(camera.id) && camera.id >= 0 && camera.id <= 99 && camera.online)
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
        if (!existing?.customName)
            return channel;
        return {
            ...channel,
            name: existing.name,
            sourceName: channel.sourceName ?? channel.name,
            customName: true,
        };
    });
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
        channels = JSON.parse(row.channels_json);
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
function encodeRtspCredential(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function cameraSnapshotInputScript(input, streamPath) {
    const access = normalizeCameraIntegrationInput(input);
    if (!/^ch_[14]\d{2}$/.test(streamPath)) {
        throw new CameraIntegrationError("Cesta obrazu kamery není platná.", "CAMERA_CONFIG_INVALID");
    }
    const username = encodeRtspCredential(access.username);
    const password = encodeRtspCredential(access.password);
    return [
        "ffconcat version 1.0",
        `file 'rtsp://${username}:${password}@${access.host}:${access.rtspPort}/${streamPath}'`,
        "option rtsp_transport tcp",
        "option timeout 8000000",
        "",
    ].join("\n");
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
