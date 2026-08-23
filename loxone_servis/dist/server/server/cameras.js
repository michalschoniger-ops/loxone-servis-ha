import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
const CAMERA_INTEGRATION_ID = "primary";
const SNAPSHOT_CACHE_MS = 4_000;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const MAX_FRAME_BYTES = 12 * 1024 * 1024;
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
            if (!challenge) {
                throw new CameraIntegrationError("NVR nenabídlo podporované Digest přihlášení.", "CAMERA_AUTH_FAILED");
            }
            await response.body?.cancel();
            response = await fetch(target, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: milesightDigestAuthorization(access.username, access.password, "GET", uri, challenge),
                },
                signal: controller.signal,
            });
            if (response.status === 401) {
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
        return {
            id,
            name: firstString(item, ["name", "cameraName", "camera_name", "channelName", "chan_name"]) || `Kamera ${id + 1}`,
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
function deviceDetails(payload) {
    const root = asObject(payload);
    const nested = asObject(root.system ?? root.nvr ?? root.info ?? root.device);
    const value = { ...root, ...nested };
    return {
        vendor: firstString(value, ["company", "vendor", "manufacturer"]) || "Milesight",
        model: firstString(value, ["deviceName", "model", "modelName", "productModel"]),
        firmware: firstString(value, ["firmware", "firmwareVersion", "softVersion", "softwareVersion"]),
    };
}
export async function discoverMilesightNvr(input) {
    const access = normalizeCameraIntegrationInput(input);
    const [system, cameras] = await Promise.all([
        milesightSdkRequest(access, "get.system.nvr"),
        milesightSdkRequest(access, "get.camera.ipclist"),
    ]);
    const channels = parseMilesightCameraList(cameras);
    if (!channels.length) {
        throw new CameraIntegrationError("NVR nevrátilo žádnou připojenou kameru.", "CAMERA_UNAVAILABLE");
    }
    return { ...deviceDetails(system), channels };
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
       last_success_at=excluded.last_success_at,last_error=NULL,updated_at=excluded.updated_at`).run(CAMERA_INTEGRATION_ID, access.name, access.host, access.httpPort, access.rtspPort, encryptSecret(access.username, config.masterKey, `camera-nvr:${CAMERA_INTEGRATION_ID}:username`), encryptSecret(access.password, config.masterKey, `camera-nvr:${CAMERA_INTEGRATION_ID}:password`), discovery.vendor, discovery.model, discovery.firmware, JSON.stringify(discovery.channels), now, now, null, cameraRow(db)?.created_at ?? now, now);
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
        db.prepare(`UPDATE camera_integrations SET vendor=?,model=?,firmware=?,connection_state='online',channels_json=?,
       last_checked_at=?,last_success_at=?,last_error=NULL,updated_at=? WHERE id=?`).run(discovery.vendor, discovery.model, discovery.firmware, JSON.stringify(discovery.channels), now, now, now, row.id);
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
export function deleteCameraIntegration(db) {
    const removed = Number(db.prepare("DELETE FROM camera_integrations WHERE id=?").run(CAMERA_INTEGRATION_ID).changes) > 0;
    if (removed)
        clearSnapshotCache();
    return removed;
}
export function parseMilesightVideoFrame(data) {
    if (data.length < 88)
        return null;
    const streamType = data.readInt32LE(48);
    const payloadBytes = data.readUInt32LE(52);
    const codec = data.readInt32LE(56);
    const frameType = data.readInt32LE(60);
    if (streamType !== 1 || payloadBytes < 1 || payloadBytes > MAX_FRAME_BYTES || 88 + payloadBytes > data.length)
        return null;
    if (codec !== 0 && codec !== 3)
        return null;
    return {
        codec: codec === 3 ? "hevc" : "h264",
        keyframe: frameType === 0,
        payload: data.subarray(88, 88 + payloadBytes),
    };
}
function rawDataBuffer(data) {
    if (Buffer.isBuffer(data))
        return data;
    if (Array.isArray(data))
        return Buffer.concat(data);
    return Buffer.from(data);
}
function ffmpegProcess(codec) {
    return spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-threads", "1",
        "-analyzeduration", "750000", "-probesize", "2097152",
        "-f", codec, "-i", "pipe:0",
        "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "5",
        "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
}
async function uncachedSnapshot(host, rtspPort, streamPath) {
    return await new Promise((resolve, reject) => {
        const websocket = new WebSocket(`ws://${host}:${rtspPort}/ms/webstream/${streamPath}`, { handshakeTimeout: 5_000 });
        let decoder = null;
        let settled = false;
        let output = Buffer.alloc(0);
        const finish = (error, jpeg) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            websocket.terminate();
            if (decoder && !decoder.killed)
                decoder.kill("SIGKILL");
            if (error)
                reject(error);
            else if (jpeg)
                resolve(jpeg);
            else
                reject(new CameraIntegrationError("Náhled kamery se nepodařilo vytvořit.", "CAMERA_STREAM_FAILED"));
        };
        const timer = setTimeout(() => finish(new CameraIntegrationError("Kamera neodeslala náhled včas.", "CAMERA_STREAM_FAILED")), SNAPSHOT_TIMEOUT_MS);
        websocket.on("open", () => websocket.send(`/ms/webstream/${streamPath}`));
        websocket.on("error", () => finish(new CameraIntegrationError("Datový stream kamery není dostupný.", "CAMERA_STREAM_FAILED")));
        websocket.on("close", () => {
            if (settled)
                return;
            if (decoder && !decoder.stdin.destroyed)
                decoder.stdin.end();
            else
                finish(new CameraIntegrationError("Datový stream kamery byl ukončen.", "CAMERA_STREAM_FAILED"));
        });
        websocket.on("message", (raw) => {
            const frame = parseMilesightVideoFrame(rawDataBuffer(raw));
            if (!frame)
                return;
            if (!decoder) {
                if (!frame.keyframe)
                    return;
                decoder = ffmpegProcess(frame.codec);
                decoder.once("error", () => finish(new CameraIntegrationError("Převod obrazu kamery není dostupný.", "CAMERA_STREAM_FAILED")));
                decoder.stdin.on("error", () => undefined);
                decoder.stderr.on("data", () => undefined);
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
                        finish(new CameraIntegrationError("Převod obrazu kamery selhal.", "CAMERA_STREAM_FAILED"));
                });
            }
            if (decoder && !decoder.stdin.destroyed)
                decoder.stdin.write(frame.payload);
        });
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
    const pending = runSnapshotQueued(() => uncachedSnapshot(row.host, row.rtsp_port, channel.streamPath))
        .then((jpeg) => {
        snapshotCache.set(channelId, { createdAt: Date.now(), jpeg });
        return jpeg;
    })
        .finally(() => snapshotInFlight.delete(channelId));
    snapshotInFlight.set(channelId, pending);
    return pending;
}
