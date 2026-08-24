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
            if (this.child === child)
                this.child = null;
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
        const query = new URLSearchParams({ name, src: source });
        await this.request(`/api/streams?${query.toString()}`, { method: "PATCH" }, async (response) => {
            await response.body?.cancel();
            if (!response.ok) {
                throw new CameraIntegrationError("NVR stream nelze připojit k video bráně.", "CAMERA_STREAM_FAILED");
            }
        });
    }
    async unregisterStream(name) {
        const query = new URLSearchParams({ src: name });
        await this.request(`/api/streams?${query.toString()}`, { method: "DELETE" }, async (response) => {
            await response.body?.cancel();
            if (!response.ok && response.status !== 404) {
                throw new CameraIntegrationError("Video brána neuvolnila nefunkční stream.", "CAMERA_STREAM_FAILED");
            }
        }, 3_000);
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
                    await this.unregisterStream(name).catch(() => undefined);
                    continue;
                }
                return { answer: result.answer, codec: sdpCodec(result.answer), source: source.source };
            }
            catch (error) {
                await this.unregisterStream(name).catch(() => undefined);
                if (error instanceof CameraIntegrationError && error.code === "CAMERA_CONFIG_INVALID")
                    throw error;
            }
        }
        throw new CameraIntegrationError("Kamera nenabídla WebRTC kompatibilní video.", "CAMERA_STREAM_FAILED");
    }
    async hlsMaster(db, channelId, quality, codecs = "h264,h265") {
        const sources = cameraGatewaySources(db, channelId, quality);
        for (const [candidateIndex, source] of sources.entries()) {
            const name = streamName(channelId, quality, candidateIndex);
            try {
                await this.registerStream(name, source.url);
                const query = new URLSearchParams({ src: name, video: codecs });
                const result = await this.request(`/api/stream.m3u8?${query.toString()}`, {
                    method: "GET",
                    headers: { "User-Agent": `Evora-Smart-Hub/${config.appVersion}` },
                }, async (response) => {
                    const body = await readLimited(response, MAX_HLS_MANIFEST_BYTES);
                    return { ok: response.ok, body };
                });
                if (!result.ok) {
                    await this.unregisterStream(name).catch(() => undefined);
                    continue;
                }
                const master = rewriteCameraHlsMasterPlaylist(result.body.toString("utf8"));
                cameraHlsSessionId(master);
                return {
                    body: Buffer.from(master, "utf8"),
                    contentType: "application/vnd.apple.mpegurl",
                };
            }
            catch (error) {
                await this.unregisterStream(name).catch(() => undefined);
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
        const query = new URLSearchParams({ id: sessionId });
        if (sequence)
            query.set("n", sequence);
        const maximum = resource === "playlist.m3u8"
            ? MAX_HLS_MANIFEST_BYTES
            : resource === "init.mp4"
                ? MAX_HLS_INIT_BYTES
                : MAX_HLS_SEGMENT_BYTES;
        const result = await this.request(`/api/hls/${resource}?${query.toString()}`, { method: "GET" }, async (response) => ({
            ok: response.ok,
            body: await readLimited(response, maximum),
        }));
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
    async stop() {
        const child = this.child;
        this.child = null;
        if (!child)
            return;
        await this.terminateChild(child);
    }
}
export const cameraVideoGateway = new CameraVideoGateway();
export async function stopCameraVideoGateway() {
    await cameraVideoGateway.stop();
}
