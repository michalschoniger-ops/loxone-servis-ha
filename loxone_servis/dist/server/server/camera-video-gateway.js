import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.js";
import { cameraGatewaySources, CameraIntegrationError, } from "./cameras.js";
const GO2RTC_API = "http://127.0.0.1:1984";
const GO2RTC_WEBRTC_PORT = 28_555;
const GATEWAY_READY_TIMEOUT_MS = 6_000;
const GATEWAY_REQUEST_TIMEOUT_MS = 12_000;
const MAX_SDP_BYTES = 512 * 1024;
const MAX_HLS_MANIFEST_BYTES = 64 * 1024;
const MAX_HLS_INIT_BYTES = 4 * 1024 * 1024;
const MAX_HLS_SEGMENT_BYTES = 12 * 1024 * 1024;
const HLS_SESSION_PATTERN = /^[A-Za-z0-9]{8}$/;
const HLS_SESSION_VALIDATE_AFTER_MS = 20_000;
const HLS_PLAYLIST_CACHE_MS = 350;
const HLS_PLAYLIST_CACHE_KEY = "playlist.m3u8:";
const HLS_MAX_CACHED_SEGMENTS = 12;
const HLS_SEGMENT_MIN_PULL_INTERVAL_MS = 500;
const HLS_SEGMENT_READY_RETRY_DELAYS_MS = [250, 500];
const HLS_INITIAL_READY_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 3_000];
export async function waitForCameraHlsSegment(loader, delaysMs = HLS_SEGMENT_READY_RETRY_DELAYS_MS, pause = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))) {
    let lastResult;
    let lastError;
    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
        if (attempt > 0)
            await pause(delaysMs[attempt - 1]);
        try {
            lastResult = await loader();
            lastError = undefined;
            if (lastResult.ok)
                return lastResult;
        }
        catch (error) {
            lastError = error;
        }
    }
    if (lastError)
        throw lastError;
    return lastResult;
}
export class CameraHlsResourceCache {
    values = new Map();
    pending = new Map();
    segmentOrder = [];
    async load(key, loader, options = {}) {
        const now = Date.now();
        const cached = this.values.get(key);
        if (cached && (cached.expiresAt === null || cached.expiresAt > now))
            return cached.response;
        if (cached)
            this.values.delete(key);
        const inFlight = this.pending.get(key);
        if (inFlight)
            return inFlight;
        const request = loader().then((response) => {
            const expiresAt = options.ttlMs === undefined ? null : Date.now() + options.ttlMs;
            this.values.set(key, { response, expiresAt });
            if (options.segment) {
                this.segmentOrder.push(key);
                while (this.segmentOrder.length > HLS_MAX_CACHED_SEGMENTS) {
                    const oldest = this.segmentOrder.shift();
                    if (oldest)
                        this.values.delete(oldest);
                }
            }
            return response;
        });
        this.pending.set(key, request);
        try {
            return await request;
        }
        finally {
            if (this.pending.get(key) === request)
                this.pending.delete(key);
        }
    }
    clear() {
        this.values.clear();
        this.pending.clear();
        this.segmentOrder.splice(0);
    }
}
export class CameraHlsSegmentPullQueue {
    minimumIntervalMs;
    pause;
    now;
    tail = Promise.resolve();
    lastPullAt = 0;
    constructor(minimumIntervalMs = HLS_SEGMENT_MIN_PULL_INTERVAL_MS, pause = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)), now = Date.now) {
        this.minimumIntervalMs = minimumIntervalMs;
        this.pause = pause;
        this.now = now;
    }
    run(loader) {
        let result;
        const pull = this.tail
            .catch(() => undefined)
            .then(async () => {
            const elapsed = this.now() - this.lastPullAt;
            const remaining = this.minimumIntervalMs - elapsed;
            if (this.lastPullAt > 0 && remaining > 0)
                await this.pause(remaining);
            result = await loader();
            this.lastPullAt = this.now();
        });
        this.tail = pull.then(() => undefined, () => undefined);
        return pull.then(() => result);
    }
}
function streamName(channelId, quality, candidateIndex) {
    return `evora_primary_${quality}_${String(channelId).padStart(2, "0")}_${candidateIndex}`;
}
function sdpCodec(answer) {
    if (/^a=rtpmap:\d+\s+H264\/90000/im.test(answer))
        return "h264";
    if (/^a=rtpmap:\d+\s+H265\/90000/im.test(answer))
        return "h265";
    return "unknown";
}
async function readLimited(response, maximumBytes) {
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > maximumBytes) {
        await response.body?.cancel();
        throw new CameraIntegrationError("Video brána vrátila příliš velkou odpověď.", "CAMERA_STREAM_FAILED");
    }
    if (!response.body)
        return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maximumBytes) {
                await reader.cancel();
                throw new CameraIntegrationError("Video brána vrátila příliš velkou odpověď.", "CAMERA_STREAM_FAILED");
            }
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
}
function parseHlsRelativeUrl(line, expectedResource) {
    const parsed = new URL(line, "http://evora.invalid/api/");
    if (parsed.origin !== "http://evora.invalid" || !parsed.pathname.endsWith(`/${expectedResource}`)) {
        throw new CameraIntegrationError("Video brána vrátila neplatný HLS manifest.", "CAMERA_STREAM_FAILED");
    }
    const id = parsed.searchParams.get("id") ?? "";
    if (!HLS_SESSION_PATTERN.test(id)) {
        throw new CameraIntegrationError("Video brána vrátila neplatnou HLS relaci.", "CAMERA_STREAM_FAILED");
    }
    return parsed;
}
export function rewriteCameraHlsMasterPlaylist(input) {
    const lines = input.trim().split(/\r?\n/);
    if (lines[0] !== "#EXTM3U") {
        throw new CameraIntegrationError("Video brána nevrátila HLS manifest.", "CAMERA_STREAM_FAILED");
    }
    let playlistFound = false;
    const output = lines.map((line) => {
        if (!line || line.startsWith("#"))
            return line;
        const parsed = parseHlsRelativeUrl(line, "playlist.m3u8");
        playlistFound = true;
        return `playlist.m3u8?id=${encodeURIComponent(parsed.searchParams.get("id") ?? "")}`;
    });
    if (!playlistFound) {
        throw new CameraIntegrationError("Video brána nevrátila HLS playlist.", "CAMERA_STREAM_FAILED");
    }
    return `${output.join("\n")}\n`;
}
export function cameraHlsSessionId(input) {
    const playlistLine = input.trim().split(/\r?\n/).find((line) => line && !line.startsWith("#"));
    if (!playlistLine) {
        throw new CameraIntegrationError("Video brána nevrátila HLS relaci.", "CAMERA_STREAM_FAILED");
    }
    return parseHlsRelativeUrl(playlistLine, "playlist.m3u8").searchParams.get("id") ?? "";
}
export function cameraHlsSegments(input, expectedSessionId) {
    if (!HLS_SESSION_PATTERN.test(expectedSessionId)) {
        throw new CameraIntegrationError("HLS relace není platná.", "CAMERA_CONFIG_INVALID");
    }
    const references = [];
    const lines = input.trim().split(/\r?\n/);
    for (const line of lines) {
        const resource = line.startsWith("segment.m4s?")
            ? "segment.m4s"
            : line.startsWith("segment.ts?")
                ? "segment.ts"
                : null;
        if (!resource)
            continue;
        const parsed = parseHlsRelativeUrl(line, resource);
        const sequence = parsed.searchParams.get("n") ?? "";
        if (parsed.searchParams.get("id") !== expectedSessionId || !/^\d{1,12}$/.test(sequence)) {
            throw new CameraIntegrationError("HLS segment nepatří do očekávané relace.", "CAMERA_STREAM_FAILED");
        }
        references.push({ resource, sequence });
    }
    return references;
}
export function cameraHlsLatestSegment(input, expectedSessionId) {
    return cameraHlsSegments(input, expectedSessionId).at(-1) ?? null;
}
export function rewriteCameraHlsMediaPlaylist(input, expectedSessionId) {
    if (!HLS_SESSION_PATTERN.test(expectedSessionId)) {
        throw new CameraIntegrationError("HLS relace není platná.", "CAMERA_CONFIG_INVALID");
    }
    const lines = input.trim().split(/\r?\n/);
    if (lines[0] !== "#EXTM3U") {
        throw new CameraIntegrationError("Video brána nevrátila HLS playlist.", "CAMERA_STREAM_FAILED");
    }
    const output = lines.map((line) => {
        if (!line)
            return line;
        const mapMatch = line.match(/^#EXT-X-MAP:URI="([^"]+)"$/);
        if (mapMatch) {
            const parsed = parseHlsRelativeUrl(mapMatch[1], "init.mp4");
            if (parsed.searchParams.get("id") !== expectedSessionId) {
                throw new CameraIntegrationError("HLS inicializace odkazuje na jinou relaci.", "CAMERA_STREAM_FAILED");
            }
            return `#EXT-X-MAP:URI="init.mp4?id=${expectedSessionId}"`;
        }
        if (line.startsWith("#"))
            return line;
        const resource = line.startsWith("init.mp4")
            ? "init.mp4"
            : line.startsWith("segment.m4s")
                ? "segment.m4s"
                : line.startsWith("segment.ts")
                    ? "segment.ts"
                    : "";
        if (!resource) {
            throw new CameraIntegrationError("Video brána vrátila neplatný HLS segment.", "CAMERA_STREAM_FAILED");
        }
        const parsed = parseHlsRelativeUrl(line, resource);
        if (parsed.searchParams.get("id") !== expectedSessionId) {
            throw new CameraIntegrationError("HLS playlist odkazuje na jinou relaci.", "CAMERA_STREAM_FAILED");
        }
        const n = parsed.searchParams.get("n");
        if (resource !== "init.mp4" && (!n || !/^\d{1,12}$/.test(n))) {
            throw new CameraIntegrationError("HLS segment nemá platné pořadí.", "CAMERA_STREAM_FAILED");
        }
        return `${resource}?id=${expectedSessionId}${n ? `&n=${n}` : ""}`;
    });
    return `${output.join("\n")}\n`;
}
async function automaticWebRtcCandidates() {
    if (!config.publicBaseUrl)
        return [`stun:${GO2RTC_WEBRTC_PORT}`];
    const hostname = new URL(config.publicBaseUrl).hostname;
    try {
        const result = await lookup(hostname, { family: 4 });
        if (isIP(result.address) === 4)
            return [`${result.address}:${GO2RTC_WEBRTC_PORT}`, `stun:${GO2RTC_WEBRTC_PORT}`];
    }
    catch {
        // A STUN candidate still gives WebRTC a chance; authenticated HLS remains
        // the deterministic fallback when the public hostname cannot be resolved.
    }
    return [`stun:${GO2RTC_WEBRTC_PORT}`];
}
class CameraVideoGateway {
    child = null;
    starting = null;
    registeredStreams = new Map();
    registeringStreams = new Map();
    hlsSessionsByKey = new Map();
    hlsSessionsById = new Map();
    hlsMasterRequests = new Map();
    keepWarmState = null;
    clearGatewayState() {
        this.registeredStreams.clear();
        this.registeringStreams.clear();
        for (const session of this.hlsSessionsByKey.values())
            session.resources.clear();
        this.hlsSessionsByKey.clear();
        this.hlsSessionsById.clear();
        this.hlsMasterRequests.clear();
    }
    forgetHlsSession(session) {
        if (this.hlsSessionsByKey.get(session.key) === session)
            this.hlsSessionsByKey.delete(session.key);
        if (this.hlsSessionsById.get(session.id) === session)
            this.hlsSessionsById.delete(session.id);
        session.resources.clear();
    }
    rememberHlsSession(session) {
        const previous = this.hlsSessionsByKey.get(session.key);
        if (previous && previous !== session)
            this.forgetHlsSession(previous);
        this.hlsSessionsByKey.set(session.key, session);
        this.hlsSessionsById.set(session.id, session);
    }
    async terminateChild(child, graceMs = 2_000) {
        if (child.exitCode !== null || child.signalCode !== null)
            return;
        await new Promise((resolve) => {
            let completed = false;
            const finish = () => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(forceTimer);
                clearTimeout(giveUpTimer);
                child.off("exit", finish);
                child.off("error", finish);
                resolve();
            };
            const forceTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null)
                    child.kill("SIGKILL");
            }, graceMs);
            const giveUpTimer = setTimeout(finish, graceMs + 1_000);
            forceTimer.unref();
            giveUpTimer.unref();
            child.once("exit", finish);
            child.once("error", finish);
            child.kill("SIGTERM");
        });
    }
    async gatewayResponds() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 750);
        try {
            const response = await fetch(`${GO2RTC_API}/api`, { signal: controller.signal });
            await response.body?.cancel();
            return response.ok;
        }
        catch {
            return false;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async startProcess() {
        if (await this.gatewayResponds())
            return;
        this.clearGatewayState();
        const candidates = await automaticWebRtcCandidates();
        const inlineConfig = JSON.stringify({
            api: { listen: "127.0.0.1:1984" },
            rtsp: { listen: "127.0.0.1:8554" },
            webrtc: { listen: `:${GO2RTC_WEBRTC_PORT}`, candidates },
            log: { level: "error" },
        });
        const binary = process.env.GO2RTC_PATH?.trim() || "/usr/local/bin/go2rtc";
        const child = spawn(binary, ["-config", inlineConfig], {
            stdio: ["ignore", "ignore", "ignore"],
            env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
        });
        this.child = child;
        child.once("exit", () => {
            if (this.child === child) {
                this.child = null;
                this.clearGatewayState();
            }
        });
        const spawnError = new Promise((_resolve, reject) => {
            child.once("error", () => reject(new CameraIntegrationError("Interní video brána není v tomto sestavení dostupná.", "CAMERA_STREAM_FAILED")));
        });
        const deadline = Date.now() + GATEWAY_READY_TIMEOUT_MS;
        const readiness = (async () => {
            while (Date.now() < deadline) {
                if (await this.gatewayResponds())
                    return;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new CameraIntegrationError("Interní video brána se nespustila včas.", "CAMERA_STREAM_FAILED");
        })();
        try {
            await Promise.race([spawnError, readiness]);
        }
        catch (error) {
            if (this.child === child)
                this.child = null;
            await this.terminateChild(child);
            throw error;
        }
    }
    async ensureReady() {
        if (await this.gatewayResponds())
            return;
        if (!this.starting) {
            this.starting = this.startProcess().finally(() => {
                this.starting = null;
            });
        }
        await this.starting;
    }
    async request(path, init, consume, timeoutMs = GATEWAY_REQUEST_TIMEOUT_MS) {
        await this.ensureReady();
        const controller = new AbortController();
        const callerSignal = init.signal;
        const abortFromCaller = () => controller.abort(callerSignal?.reason);
        if (callerSignal?.aborted)
            abortFromCaller();
        else
            callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${GO2RTC_API}${path}`, { ...init, signal: controller.signal });
            return await consume(response);
        }
        catch (error) {
            if (error instanceof CameraIntegrationError)
                throw error;
            throw new CameraIntegrationError("Interní video brána neodpovídá.", "CAMERA_STREAM_FAILED");
        }
        finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener("abort", abortFromCaller);
        }
    }
    async registerStream(name, source) {
        await this.ensureReady();
        if (this.registeredStreams.get(name) === source)
            return;
        const pending = this.registeringStreams.get(name);
        if (pending) {
            await pending;
            if (this.registeredStreams.get(name) === source)
                return;
        }
        const query = new URLSearchParams({ name, src: source });
        const registration = this.request(`/api/streams?${query.toString()}`, { method: "PATCH" }, async (response) => {
            await response.body?.cancel();
            if (!response.ok) {
                throw new CameraIntegrationError("NVR stream nelze připojit k video bráně.", "CAMERA_STREAM_FAILED");
            }
            this.registeredStreams.set(name, source);
        });
        this.registeringStreams.set(name, registration);
        try {
            await registration;
        }
        finally {
            if (this.registeringStreams.get(name) === registration)
                this.registeringStreams.delete(name);
        }
    }
    async exchangeWebRtc(db, channelId, quality, offer) {
        if (!offer.startsWith("v=0") || Buffer.byteLength(offer, "utf8") > MAX_SDP_BYTES) {
            throw new CameraIntegrationError("WebRTC nabídka není platná.", "CAMERA_CONFIG_INVALID");
        }
        const sources = cameraGatewaySources(db, channelId, quality);
        for (const [candidateIndex, source] of sources.entries()) {
            const name = streamName(channelId, quality, candidateIndex);
            try {
                await this.registerStream(name, source.url);
                const query = new URLSearchParams({ src: name });
                const result = await this.request(`/api/webrtc?${query.toString()}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/sdp", "User-Agent": `Evora-Smart-Hub/${config.appVersion}` },
                    body: offer,
                }, async (response) => {
                    const body = await readLimited(response, MAX_SDP_BYTES);
                    return { ok: response.ok, answer: body.toString("utf8") };
                });
                if (!result.ok || !result.answer.startsWith("v=0")) {
                    continue;
                }
                return { answer: result.answer, codec: sdpCodec(result.answer), source: source.source };
            }
            catch (error) {
                if (error instanceof CameraIntegrationError && error.code === "CAMERA_CONFIG_INVALID")
                    throw error;
            }
        }
        throw new CameraIntegrationError("Kamera nenabídla WebRTC kompatibilní video.", "CAMERA_STREAM_FAILED");
    }
    async fetchHlsResource(resource, sessionId, sequence) {
        const query = new URLSearchParams({ id: sessionId });
        if (sequence)
            query.set("n", sequence);
        const maximum = resource === "playlist.m3u8"
            ? MAX_HLS_MANIFEST_BYTES
            : resource === "init.mp4"
                ? MAX_HLS_INIT_BYTES
                : MAX_HLS_SEGMENT_BYTES;
        const isSegment = resource === "segment.m4s" || resource === "segment.ts";
        const load = () => this.request(`/api/hls/${resource}?${query.toString()}`, { method: "GET" }, async (response) => ({
            ok: response.ok,
            body: await readLimited(response, maximum),
        }));
        const result = isSegment
            ? await waitForCameraHlsSegment(load)
            : await load();
        if (!result.ok) {
            throw new CameraIntegrationError("HLS relace vypršela nebo segment není dostupný.", "CAMERA_STREAM_FAILED");
        }
        if (resource === "playlist.m3u8") {
            return {
                body: Buffer.from(rewriteCameraHlsMediaPlaylist(result.body.toString("utf8"), sessionId), "utf8"),
                contentType: "application/vnd.apple.mpegurl",
            };
        }
        return {
            body: result.body,
            contentType: resource === "init.mp4" ? "video/mp4"
                : resource === "segment.m4s" ? "video/iso.segment"
                    : "video/mp2t",
        };
    }
    async prepareHlsMaster(name, mode) {
        const key = `${name}|${mode}`;
        const cached = this.hlsSessionsByKey.get(key);
        if (cached) {
            if (Date.now() - cached.lastResourceAt < HLS_SESSION_VALIDATE_AFTER_MS)
                return cached.master;
            try {
                await cached.resources.load(HLS_PLAYLIST_CACHE_KEY, () => this.fetchHlsResource("playlist.m3u8", cached.id), { ttlMs: HLS_PLAYLIST_CACHE_MS });
                cached.lastResourceAt = Date.now();
                return cached.master;
            }
            catch {
                this.forgetHlsSession(cached);
            }
        }
        const query = new URLSearchParams({ src: name });
        // go2rtc deliberately selects MPEG-TS HLS when no codec filter is sent.
        // That avoids fMP4 init/fragment sequence races while keeping one direct
        // RTSP-derived stream compatible with native Safari HLS and hls.js.
        if (mode !== "mpegts")
            query.set("video", mode);
        const result = await this.request(`/api/stream.m3u8?${query.toString()}`, {
            method: "GET",
            headers: { "User-Agent": `Evora-Smart-Hub/${config.appVersion}` },
        }, async (response) => {
            const body = await readLimited(response, MAX_HLS_MANIFEST_BYTES);
            return { ok: response.ok, body };
        });
        if (!result.ok) {
            throw new CameraIntegrationError("Kamera nenabídla kompatibilní HLS video.", "CAMERA_STREAM_FAILED");
        }
        const masterText = rewriteCameraHlsMasterPlaylist(result.body.toString("utf8"));
        const session = {
            key,
            id: cameraHlsSessionId(masterText),
            master: {
                body: Buffer.from(masterText, "utf8"),
                contentType: "application/vnd.apple.mpegurl",
            },
            lastResourceAt: Date.now(),
            segmentPullQueue: new CameraHlsSegmentPullQueue(),
            resources: new CameraHlsResourceCache(),
        };
        this.rememberHlsSession(session);
        try {
            await this.warmHlsSession(session);
        }
        catch (error) {
            this.forgetHlsSession(session);
            throw error;
        }
        return session.master;
    }
    async loadHlsSegment(session, segment) {
        const key = `${segment.resource}:${segment.sequence}`;
        return session.resources.load(key, () => session.segmentPullQueue.run(() => this.fetchHlsResource(segment.resource, session.id, segment.sequence)), { segment: true });
    }
    async warmLatestHlsPlaylistResource(session, playlist) {
        const playlistText = playlist.body.toString("utf8");
        const latestSegment = cameraHlsLatestSegment(playlistText, session.id);
        if (!latestSegment) {
            throw new CameraIntegrationError("HLS zatím neoznámilo první video segment.", "CAMERA_STREAM_FAILED");
        }
        if (playlistText.includes("#EXT-X-MAP:")) {
            await session.resources.load("init.mp4:", () => this.fetchHlsResource("init.mp4", session.id));
        }
        // Starší segmenty v živém playlistu mohou v go2rtc mezitím expirovat.
        // Pro plynulý start stačí držet připravený právě nejnovější segment;
        // prohlížeč si zbývající platné segmenty vyžádá podle playlistu sám.
        await this.loadHlsSegment(session, latestSegment);
        session.lastResourceAt = Date.now();
    }
    async warmHlsSession(session) {
        let lastError;
        for (let attempt = 0; attempt <= HLS_INITIAL_READY_RETRY_DELAYS_MS.length; attempt += 1) {
            if (attempt > 0) {
                await new Promise((resolve) => setTimeout(resolve, HLS_INITIAL_READY_RETRY_DELAYS_MS[attempt - 1]));
            }
            try {
                const playlist = await session.resources.load(HLS_PLAYLIST_CACHE_KEY, () => this.fetchHlsResource("playlist.m3u8", session.id), { ttlMs: HLS_PLAYLIST_CACHE_MS });
                await this.warmLatestHlsPlaylistResource(session, playlist);
                return;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (lastError instanceof CameraIntegrationError)
            throw lastError;
        throw new CameraIntegrationError("HLS video se nepodařilo včas předehřát.", "CAMERA_STREAM_FAILED");
    }
    async hlsMaster(db, channelId, quality, mode = "mpegts") {
        const sources = cameraGatewaySources(db, channelId, quality);
        for (const [candidateIndex, source] of sources.entries()) {
            const name = streamName(channelId, quality, candidateIndex);
            try {
                await this.registerStream(name, source.url);
                const key = `${name}|${mode}`;
                let request = this.hlsMasterRequests.get(key);
                if (!request) {
                    request = this.prepareHlsMaster(name, mode);
                    this.hlsMasterRequests.set(key, request);
                }
                try {
                    return await request;
                }
                finally {
                    if (this.hlsMasterRequests.get(key) === request)
                        this.hlsMasterRequests.delete(key);
                }
            }
            catch (error) {
                if (error instanceof CameraIntegrationError && error.code === "CAMERA_CONFIG_INVALID")
                    throw error;
            }
        }
        throw new CameraIntegrationError("Kamera nenabídla kompatibilní HLS video.", "CAMERA_STREAM_FAILED");
    }
    async hlsResource(resource, sessionId, sequence) {
        if (!HLS_SESSION_PATTERN.test(sessionId)) {
            throw new CameraIntegrationError("HLS relace není platná.", "CAMERA_CONFIG_INVALID");
        }
        if (resource !== "playlist.m3u8" && resource !== "init.mp4" && (!sequence || !/^\d{1,12}$/.test(sequence))) {
            throw new CameraIntegrationError("HLS segment není platný.", "CAMERA_CONFIG_INVALID");
        }
        const session = this.hlsSessionsById.get(sessionId);
        if (!session)
            return this.fetchHlsResource(resource, sessionId, sequence);
        if (resource === "playlist.m3u8") {
            const playlist = await session.resources.load(HLS_PLAYLIST_CACHE_KEY, () => this.fetchHlsResource("playlist.m3u8", sessionId), { ttlMs: HLS_PLAYLIST_CACHE_MS });
            session.lastResourceAt = Date.now();
            // Playlist nesmí čekat na segmenty. Případné krátké zaváhání jednoho
            // segmentu nesmí zneplatnit celou sdílenou relaci pro všechny klienty.
            void this.warmLatestHlsPlaylistResource(session, playlist).catch(() => undefined);
            return playlist;
        }
        if (resource === "segment.m4s" || resource === "segment.ts") {
            const response = await this.loadHlsSegment(session, {
                resource,
                sequence: sequence,
            });
            session.lastResourceAt = Date.now();
            return response;
        }
        const resourceKey = `${resource}:${sequence ?? ""}`;
        const response = await session.resources.load(resourceKey, () => this.fetchHlsResource(resource, sessionId, sequence));
        session.lastResourceAt = Date.now();
        return response;
    }
    startKeepWarm(db, channelId, quality = "preview") {
        if (this.keepWarmState)
            return;
        const state = { stopped: false, timer: null };
        this.keepWarmState = state;
        let failures = 0;
        const schedule = (delayMs) => {
            if (state.stopped)
                return;
            state.timer = setTimeout(() => {
                state.timer = null;
                void (async () => {
                    let warmed = false;
                    try {
                        const master = await this.hlsMaster(db, channelId, quality, "mpegts");
                        const sessionId = cameraHlsSessionId(master.body.toString("utf8"));
                        const session = this.hlsSessionsById.get(sessionId);
                        if (!session)
                            throw new CameraIntegrationError("HLS relace není připravená.", "CAMERA_STREAM_FAILED");
                        const playlist = await session.resources.load(HLS_PLAYLIST_CACHE_KEY, () => this.fetchHlsResource("playlist.m3u8", sessionId), { ttlMs: HLS_PLAYLIST_CACHE_MS });
                        await this.warmLatestHlsPlaylistResource(session, playlist);
                        warmed = true;
                    }
                    catch {
                        // Další omezené kolo zkusí jedinou sdílenou relaci znovu.
                    }
                    if (warmed) {
                        failures = 0;
                        schedule(750);
                    }
                    else {
                        failures += 1;
                        schedule(Math.min(30_000, 1_000 * (2 ** Math.min(failures - 1, 5))));
                    }
                })();
            }, delayMs);
            state.timer.unref();
        };
        schedule(250);
    }
    async stop() {
        const keepWarm = this.keepWarmState;
        this.keepWarmState = null;
        if (keepWarm) {
            keepWarm.stopped = true;
            if (keepWarm.timer)
                clearTimeout(keepWarm.timer);
            keepWarm.timer = null;
        }
        const child = this.child;
        this.child = null;
        this.clearGatewayState();
        if (!child)
            return;
        await this.terminateChild(child);
    }
}
export const cameraVideoGateway = new CameraVideoGateway();
export function startCameraVideoGatewayKeepWarm(db, channelId) {
    cameraVideoGateway.startKeepWarm(db, channelId, "preview");
}
export async function stopCameraVideoGateway() {
    await cameraVideoGateway.stop();
}
