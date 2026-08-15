import { isIP } from "node:net";
import { URL } from "node:url";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { config } from "../config.js";
import { getStoredCredentials } from "../repository.js";
import { loxoneHmac, loxonePasswordHash, encryptSecret, fingerprint, redactSensitiveText } from "../crypto.js";
export class LoxoneError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
const CACHED_CONNECTION_MAX_AGE_MS = 6 * 60 * 60_000;
export function connectionStateForError(code) {
    if (code === "no_access" || code === "credentials_missing")
        return "no_access";
    if (code === "resolver_error" || code === "resolver_timeout")
        return "unknown";
    return "unavailable";
}
function timeoutSignal(milliseconds) {
    return AbortSignal.timeout(milliseconds);
}
function basicAuthorization(credentials) {
    return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}`;
}
function classifyFetchError(error, resolver = false) {
    const value = error;
    if (value.name === "TimeoutError" || value.name === "AbortError") {
        return new LoxoneError(resolver ? "resolver_timeout" : "connection_timeout", "Vypršel časový limit spojení.");
    }
    const code = value.cause?.code ?? value.code ?? "";
    if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
        return new LoxoneError("connection_refused", "Miniserver spojení odmítl nebo není dosažitelný.");
    }
    if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) {
        return new LoxoneError("tls_error", "TLS certifikát vzdáleného přístupu nelze ověřit.");
    }
    return new LoxoneError(resolver ? "resolver_error" : "http_error", value.message || "Spojení selhalo.");
}
function normalizeOfficialUrl(value) {
    const parsed = new URL(value);
    if (!["https:", "wss:"].includes(parsed.protocol))
        throw new LoxoneError("invalid_response", "Cloud vrátil neplatný protokol.");
    if (parsed.username || parsed.password)
        throw new LoxoneError("invalid_response", "Cloud vrátil URL s přihlašovacími údaji.");
    const websocketUrl = parsed.protocol === "wss:" ? parsed.toString().replace(/^wss:/, "https:") : null;
    parsed.protocol = "https:";
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    return { baseUrl: parsed.toString().replace(/\/$/, ""), source: "connect", websocketUrl };
}
export function isSafeLocalMiniserverUrl(value) {
    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
            return false;
        if (parsed.pathname !== "/")
            return false;
        const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        if (isIP(hostname) === 4) {
            const octets = hostname.split(".").map(Number);
            return octets[0] === 10
                || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] === 192 && octets[1] === 168);
        }
        return isIP(hostname) === 6 && (hostname.startsWith("fc") || hostname.startsWith("fd"));
    }
    catch {
        return false;
    }
}
export function normalizeLocalUrl(value) {
    const parsed = new URL(value);
    if (!isSafeLocalMiniserverUrl(value)) {
        throw new LoxoneError("invalid_response", "Lokální adresa musí být HTTP(S) URL s privátní LAN IP bez cesty, hesla nebo parametrů.");
    }
    return { baseUrl: parsed.toString().replace(/\/$/, ""), source: "local", websocketUrl: null };
}
export function cachedConnection(row, now = Date.now()) {
    if (row.local_url || !row.connection_url || !row.connection_resolved_at)
        return null;
    const resolvedAt = Date.parse(row.connection_resolved_at);
    if (!Number.isFinite(resolvedAt) || resolvedAt > now + 60_000 || now - resolvedAt > CACHED_CONNECTION_MAX_AGE_MS)
        return null;
    const source = row.connection_transport;
    if (source !== "connect" && source !== "legacy")
        return null;
    try {
        const parsed = new URL(row.connection_url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
            return null;
        parsed.search = "";
        parsed.hash = "";
        parsed.pathname = parsed.pathname.replace(/\/$/, "");
        return { baseUrl: parsed.toString().replace(/\/$/, ""), source, websocketUrl: null };
    }
    catch {
        return null;
    }
}
async function resolveConnectionAttempt(serial, localUrl) {
    if (localUrl)
        return normalizeLocalUrl(localUrl);
    try {
        const response = await fetch(`https://connect.loxonecloud.com/getip?snr=${encodeURIComponent(serial)}`, {
            redirect: "manual",
            signal: timeoutSignal(12_000),
            headers: { Accept: "application/json", "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` },
        });
        if (response.status === 404)
            throw new LoxoneError("relay_not_connected", "Miniserver není připojený k Remote Connect.", 404);
        if (response.status === 504)
            throw new LoxoneError("relay_not_connected", "Miniserver je registrovaný, ale není připojený.", 504);
        if (response.status === 400)
            throw new LoxoneError("not_registered", "Sériové číslo není v Remote Connect platné.", 400);
        if (response.ok) {
            const payload = (await response.json());
            if (payload.url)
                return normalizeOfficialUrl(payload.url);
            throw new LoxoneError("invalid_response", "Remote Connect nevrátil URL.");
        }
        if (response.status !== 500)
            throw new LoxoneError("resolver_error", `Remote Connect odpověděl HTTP ${response.status}.`, response.status);
    }
    catch (error) {
        if (error instanceof LoxoneError && error.code !== "resolver_error")
            throw error;
        if (!(error instanceof LoxoneError)) {
            const classified = classifyFetchError(error, true);
            if (classified.code === "resolver_timeout")
                throw classified;
        }
        // Chyba databáze nového relay resolveru může mít stále funkční legacy CloudDNS trasu.
    }
    try {
        const query = new URLSearchParams({ getip: "", snr: serial, json: "true" });
        const response = await fetch(`https://dns.loxonecloud.com/?${query}`, {
            redirect: "manual",
            signal: timeoutSignal(12_000),
            headers: { Accept: "application/json", "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}` },
        });
        if (!response.ok)
            throw new LoxoneError("resolver_error", `CloudDNS odpověděl HTTP ${response.status}.`, response.status);
        const payload = (await response.json());
        if (payload.Code !== 200 || !payload.PortOpenHTTPS || !payload.IPHTTPS) {
            throw new LoxoneError("route_unavailable", "Miniserver nemá dostupnou HTTPS trasu.");
        }
        const match = payload.IPHTTPS.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
        if (!match || !payload.DataCenter || !/^[a-z0-9.-]+$/i.test(payload.DataCenter)) {
            throw new LoxoneError("invalid_response", "CloudDNS vrátil neplatnou trasu.");
        }
        const port = Number(match[2]);
        if (port < 1 || port > 65535)
            throw new LoxoneError("invalid_response", "CloudDNS vrátil neplatný port.");
        const host = `${match[1].replaceAll(".", "-")}.${serial.toLowerCase()}.dyndns.${payload.DataCenter}`;
        return { baseUrl: `https://${host}:${port}`, source: "legacy", websocketUrl: null };
    }
    catch (error) {
        if (error instanceof LoxoneError)
            throw error;
        throw classifyFetchError(error, true);
    }
}
function resolverRetryDelay(serial, attempt) {
    const jitter = createHash("sha256").update(`${serial}:${attempt}`).digest().readUInt16BE(0) % 450;
    return 650 * (attempt + 1) + jitter;
}
export async function resolveConnection(serial, localUrl) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await resolveConnectionAttempt(serial, localUrl);
        }
        catch (error) {
            lastError = error;
            const retryable = error instanceof LoxoneError
                && (error.code === "resolver_error" || error.code === "resolver_timeout");
            if (!retryable || attempt === 2)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, resolverRetryDelay(serial, attempt)));
        }
    }
    throw lastError;
}
function decodeXml(value) {
    return value
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}
export function extractLoxoneValue(body) {
    const trimmed = body.trim();
    if (!trimmed)
        return "";
    if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        const code = Number(parsed.LL?.Code ?? 200);
        if (code === 401 || code === 403)
            throw new LoxoneError("no_access", "Miniserver odmítl přihlášení.", code);
        const value = parsed.LL?.value ?? parsed;
        if (typeof value === "string" && ["[", "{"].some((prefix) => value.trim().startsWith(prefix))) {
            try {
                return JSON.parse(value);
            }
            catch {
                return value;
            }
        }
        return value;
    }
    const attribute = trimmed.match(/\bvalue=(?:"([^"]*)"|'([^']*)')/i);
    if (attribute)
        return decodeXml(attribute[1] ?? attribute[2] ?? "");
    const element = trimmed.match(/<value>([\s\S]*?)<\/value>/i);
    if (element)
        return decodeXml(element[1]);
    return trimmed;
}
export async function requestLoxone(connection, credentials, path, options = {}) {
    if (!path.startsWith("/"))
        throw new LoxoneError("invalid_response", "Neplatná cesta webservice.");
    let response;
    try {
        response = await fetch(`${connection.baseUrl}${path}`, {
            method: options.method ?? "GET",
            redirect: "manual",
            signal: timeoutSignal(options.timeoutMs ?? config.requestTimeoutMs),
            headers: {
                Authorization: basicAuthorization(credentials),
                Accept: options.accept ?? "application/json, application/xml, text/plain",
                "User-Agent": `EVORA-Loxone-Servis/${config.appVersion}`,
            },
        });
    }
    catch (error) {
        throw classifyFetchError(error);
    }
    if (response.status === 401 || response.status === 403) {
        throw new LoxoneError("no_access", "Miniserver odmítl přihlašovací údaje.", response.status);
    }
    if (response.status === 404)
        throw new LoxoneError("unsupported", "Webservice není tímto firmware podporovaný.", 404);
    if (!response.ok)
        throw new LoxoneError("http_error", `Webservice odpověděl HTTP ${response.status}.`, response.status);
    const body = await response.text();
    return options.raw ? body : extractLoxoneValue(body);
}
function attribute(attributes, name) {
    const match = attributes.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
    return match ? decodeXml(match[1] ?? match[2] ?? "") : null;
}
function normalizeDeviceSerial(value) {
    if (!value)
        return null;
    const normalized = value.replace(/[^a-f0-9]/gi, "").toUpperCase();
    return normalized.length >= 6 && normalized.length <= 16 ? normalized : null;
}
export function parseStatusXml(xml) {
    const devices = [];
    const messages = [];
    let genericOnline = 0;
    let genericTotal = 0;
    for (const match of xml.matchAll(/<([A-Za-z0-9_:-]+)\b([^>]*)>/g)) {
        const tag = match[1];
        const attrs = match[2];
        if (["miniserver", "status"].includes(tag.toLowerCase()) || attribute(attrs, "DummyDev")?.toLowerCase() === "true")
            continue;
        const onlineValue = attribute(attrs, "Online");
        const offlineValue = attribute(attrs, "Offline");
        const stateValue = attribute(attrs, "State")?.toLowerCase();
        const hasState = onlineValue !== null || offlineValue !== null || stateValue === "online" || stateValue === "offline";
        if (!hasState)
            continue;
        const online = onlineValue?.toLowerCase() === "true" || onlineValue === "1" || stateValue === "online";
        const offline = offlineValue?.toLowerCase() === "true" || offlineValue === "1" || stateValue === "offline";
        genericTotal += 1;
        if (online && !offline)
            genericOnline += 1;
        const serial = normalizeDeviceSerial(attribute(attrs, "Serial") ?? attribute(attrs, "SerialNr") ?? attribute(attrs, "SN") ?? attribute(attrs, "Mac"));
        const message = attribute(attrs, "Message") ?? attribute(attrs, "Error") ?? attribute(attrs, "StatusText");
        if (message && !online)
            messages.push(message);
        if (!serial)
            continue;
        const tagLower = tag.toLowerCase();
        devices.push({
            serial,
            name: attribute(attrs, "Name") ?? attribute(attrs, "Title") ?? serial,
            type: attribute(attrs, "Type") ?? tag,
            online: online && !offline,
            firmware: attribute(attrs, "Version") ?? attribute(attrs, "Firmware"),
            parentSerial: normalizeDeviceSerial(attribute(attrs, "Parent") ?? attribute(attrs, "ParentSerial")),
            deviceIndex: Number.isFinite(Number(attribute(attrs, "DeviceIndex"))) ? Number(attribute(attrs, "DeviceIndex")) : null,
            systemMessage: message,
            source: tagLower.includes("extension") ? "extension" : tagLower.includes("tree") || tagLower.includes("air") ? "device" : "status",
        });
    }
    return { online: genericOnline, total: genericTotal, devices, messages: [...new Set(messages)] };
}
function parseFirmware(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.match(/\b\d+\.\d+\.\d+\.\d+\b/)?.[0] ?? null;
}
export async function checkMiniserver(db, serial) {
    const row = db.prepare("SELECT local_url,connection_url,connection_transport,connection_resolved_at FROM miniservers WHERE serial=?").get(serial);
    const credentials = getStoredCredentials(db, serial);
    if (!credentials) {
        return {
            state: "no_access",
            firmware: null,
            latencyMs: null,
            errorCode: "credentials_missing",
            connection: null,
            elementsOnline: null,
            elementsTotal: null,
            devices: [],
            rawStatusSummary: {},
        };
    }
    const started = Date.now();
    let connection = null;
    try {
        try {
            connection = await resolveConnection(serial, row?.local_url ?? null);
        }
        catch (error) {
            const transientResolverFailure = error instanceof LoxoneError
                && (error.code === "resolver_error" || error.code === "resolver_timeout");
            const cached = transientResolverFailure && row ? cachedConnection(row) : null;
            if (!cached)
                throw error;
            connection = cached;
        }
        const versionValue = await requestLoxone(connection, credentials, "/dev/cfg/version");
        const firmware = parseFirmware(versionValue);
        if (!firmware)
            throw new LoxoneError("invalid_response", "Odpověď neobsahuje platnou verzi firmware.");
        let status = null;
        try {
            const xml = (await requestLoxone(connection, credentials, "/data/status", {
                raw: true,
                accept: "application/xml, text/xml, text/plain",
            }));
            status = parseStatusXml(xml);
        }
        catch (error) {
            if (error instanceof LoxoneError && error.code === "no_access")
                throw error;
        }
        return {
            state: "online",
            firmware,
            latencyMs: Date.now() - started,
            errorCode: null,
            connection,
            elementsOnline: status?.online ?? null,
            elementsTotal: status?.total ?? null,
            devices: status?.devices ?? [],
            rawStatusSummary: { messages: status?.messages ?? [] },
        };
    }
    catch (error) {
        const loxoneError = error instanceof LoxoneError ? error : classifyFetchError(error);
        return {
            state: connectionStateForError(loxoneError.code),
            firmware: null,
            latencyMs: Date.now() - started,
            errorCode: loxoneError.code,
            connection,
            elementsOnline: null,
            elementsTotal: null,
            devices: [],
            rawStatusSummary: {},
        };
    }
}
async function context(db, serial) {
    const row = db.prepare("SELECT local_url FROM miniservers WHERE serial=?").get(serial);
    const credentials = getStoredCredentials(db, serial);
    if (!credentials)
        throw new LoxoneError("credentials_missing", "Miniserver nemá uložené přístupy.");
    return { connection: await resolveConnection(serial, row?.local_url ?? null), credentials };
}
export async function miniserverCommand(db, serial, command) {
    const { connection, credentials } = await context(db, serial);
    const path = {
        update: "/dev/sys/updatetolatestrelease",
        reboot: "/dev/sys/reboot",
        sdtest: "/dev/sys/sdtest",
    }[command];
    return requestLoxone(connection, credentials, path, { timeoutMs: command === "sdtest" ? 60_000 : config.requestTimeoutMs });
}
export async function deviceCommand(db, serial, device, command) {
    if (!/^[A-F0-9]{6,16}$/i.test(device.serial))
        throw new LoxoneError("invalid_response", "Neplatné SN prvku.");
    const { connection, credentials } = await context(db, serial);
    if (command === "identify") {
        return requestLoxone(connection, credentials, `/dev/sps/identify/${encodeURIComponent(device.serial)}`);
    }
    const prefix = device.source === "extension" ? "wsextension" : "wsdevice";
    if (command === "reboot") {
        return requestLoxone(connection, credentials, `/dev/sys/${prefix}/${encodeURIComponent(device.serial)}/Reboot`);
    }
    if (!Number.isInteger(device.deviceIndex) || Number(device.deviceIndex) < 0) {
        throw new LoxoneError("unsupported", "Pro vynucení FW chybí ověřený DeviceIndex prvku.");
    }
    return requestLoxone(connection, credentials, `/dev/sys/${prefix}/${encodeURIComponent(device.serial)}/ForceUpdate/0C000001/${device.deviceIndex}`);
}
function numericValue(value) {
    const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}
export async function readHealth(db, serial) {
    const { connection, credentials } = await context(db, serial);
    const commands = {
        plcState: "/dev/sps/state",
        plcFrequency: "/dev/sps/status",
        cpuLoad: "/dev/sys/cpu",
        heap: "/dev/sys/heap",
        taskCount: "/dev/sys/numtasks",
        interrupts: "/dev/sys/ints",
        activeConnections: "/dev/sys/check",
        ntp: "/dev/cfg/ntp",
        dns1: "/dev/cfg/dns1",
        dns2: "/dev/cfg/dns2",
        localDate: "/dev/sys/date",
        localTime: "/dev/sys/time",
    };
    const entries = await Promise.all(Object.entries(commands).map(async ([key, path]) => {
        try {
            return [key, await requestLoxone(connection, credentials, path)];
        }
        catch (error) {
            return [key, { unsupported: error instanceof LoxoneError ? error.code : "error" }];
        }
    }));
    const values = Object.fromEntries(entries);
    return {
        ...values,
        cpuLoadNumeric: numericValue(values.cpuLoad),
        taskCountNumeric: numericValue(values.taskCount),
        checkedAt: new Date().toISOString(),
        transport: connection.source,
    };
}
export async function readDefinitionLog(db, serial) {
    const { connection, credentials } = await context(db, serial);
    const raw = (await requestLoxone(connection, credentials, "/dev/fsget/log/def.log", {
        raw: true,
        accept: "text/plain",
        timeoutMs: 30_000,
    }));
    return redactSensitiveText(raw.slice(-500_000));
}
export async function readLoxApp3(db, serial) {
    const { connection, credentials } = await context(db, serial);
    const payload = await requestLoxone(connection, credentials, "/data/LoxAPP3.json", {
        raw: true,
        accept: "application/json",
        timeoutMs: 45_000,
    });
    const text = String(payload);
    const parsed = JSON.parse(text);
    const version = typeof parsed.LoxAPPversion3 === "string" ? parsed.LoxAPPversion3 : null;
    return { payload: parsed, hash: createHash("sha256").update(text).digest("hex"), version };
}
export function parseGatewayTopology(payload, ownSerial, knownSerials) {
    const root = payload && typeof payload === "object" ? payload : {};
    const msInfo = root.msInfo && typeof root.msInfo === "object" ? root.msInfo : {};
    const gatewayType = Number(msInfo.gatewayType);
    const role = gatewayType === 2
        ? "gateway"
        : gatewayType === 1
            ? "client"
            : gatewayType === 0
                ? "standalone"
                : "unknown";
    const normalizedOwnSerial = ownSerial.toUpperCase();
    const normalizedKnownSerials = new Set(Array.from(knownSerials, (serial) => serial.toUpperCase()));
    const referencedSerials = Array.from(new Set((JSON.stringify(payload).toUpperCase().match(/504F94[A-F0-9]{6}/g) ?? [])
        .filter((serial) => serial !== normalizedOwnSerial && normalizedKnownSerials.has(serial)))).sort();
    const miniserverType = Number.isFinite(Number(msInfo.miniserverType)) ? Number(msInfo.miniserverType) : null;
    const projectName = typeof msInfo.projectName === "string" ? msInfo.projectName : null;
    return { role, referencedSerials, miniserverType, projectName };
}
export async function readGatewayTopology(db, serial, knownSerials) {
    const snapshot = await readLoxApp3(db, serial);
    return parseGatewayTopology(snapshot.payload, serial, knownSerials);
}
export async function readControlHistory(db, serial, controlUuid) {
    if (!/^[A-F0-9-]{20,40}$/i.test(controlUuid))
        throw new LoxoneError("invalid_response", "Neplatné UUID ovládacího prvku.");
    const { connection, credentials } = await context(db, serial);
    return requestLoxone(connection, credentials, `/jdev/sps/io/${encodeURIComponent(controlUuid)}/gethistory`);
}
export async function readStatisticInfo(db, serial, controlUuid) {
    if (!/^[A-F0-9-]{20,40}$/i.test(controlUuid))
        throw new LoxoneError("invalid_response", "Neplatné UUID statistiky.");
    const { connection, credentials } = await context(db, serial);
    return requestLoxone(connection, credentials, `/jdev/sps/getStatisticInfo/${encodeURIComponent(controlUuid)}`);
}
export async function readStatisticRaw(db, serial, request) {
    if (!/^[A-F0-9-]{20,40}$/i.test(request.controlUuid))
        throw new LoxoneError("invalid_response", "Neplatné UUID statistiky.");
    if (!Number.isInteger(request.from) || !Number.isInteger(request.to) || request.from >= request.to) {
        throw new LoxoneError("invalid_response", "Neplatný interval statistiky.");
    }
    if (!/^[A-Za-z0-9_]{1,64}$/.test(request.outputName))
        throw new LoxoneError("invalid_response", "Neplatný název výstupu statistiky.");
    const { connection, credentials } = await context(db, serial);
    const path = `/dev/sps/getStatistic/${encodeURIComponent(request.controlUuid)}/raw/${request.from}/${request.to}/${request.dataPointUnit}/${request.groupId}/${request.outputName}`;
    return requestLoxone(connection, credentials, path, { timeoutMs: 45_000 });
}
export async function readUserAudit(db, serial) {
    const { connection, credentials } = await context(db, serial);
    const listValue = await requestLoxone(connection, credentials, "/jdev/sps/getuserlist2");
    const summaries = Array.isArray(listValue)
        ? listValue
        : Object.values((listValue && typeof listValue === "object" ? listValue : {}));
    const users = [];
    for (const summary of summaries.slice(0, 500)) {
        if (!summary.uuid || !/^[A-F0-9-]{20,40}$/i.test(summary.uuid))
            continue;
        try {
            const detail = (await requestLoxone(connection, credentials, `/jdev/sps/getuser/${encodeURIComponent(summary.uuid)}`));
            users.push({
                name: detail.name ?? summary.name ?? "",
                uuid: detail.uuid ?? summary.uuid,
                isAdmin: Boolean(detail.isAdmin ?? summary.isAdmin),
                userState: Number(detail.userState ?? summary.userState ?? 0),
                validFrom: detail.validFrom ?? null,
                validUntil: detail.validUntil ?? null,
                expirationAction: detail.expirationAction ?? null,
                scorePWD: Number(detail.scorePWD ?? -2),
                scoreVisuPWD: Number(detail.scoreVisuPWD ?? -2),
                userRights: detail.userRights ?? null,
                trustMember: detail.trustMember ?? null,
                disabledBySource: Boolean(detail.disabledBySource),
                groups: Array.isArray(detail.usergroups)
                    ? detail.usergroups.map((group) => typeof group === "object" && group ? { name: group.name, uuid: group.uuid } : {})
                    : [],
                nfcTagCount: Array.isArray(detail.nfcTags) ? detail.nfcTags.length : 0,
                keycodeCount: Array.isArray(detail.keycodes) ? detail.keycodes.length : 0,
            });
        }
        catch (error) {
            users.push({ ...summary, detailError: error instanceof LoxoneError ? error.code : "error" });
        }
    }
    let trustPeers = [];
    try {
        const peersValue = (await requestLoxone(connection, credentials, "/jdev/sps/trustusermanagement/peers"));
        trustPeers = (peersValue.peers ?? []).map((peer) => ({ serial: peer.serial ?? null, name: peer.name ?? "" }));
    }
    catch {
        // Trust není dostupný na každém projektu/firmware.
    }
    const nowSince2009 = Math.floor(Date.now() / 1000) - 1_230_768_000;
    return {
        users,
        trustPeers,
        summary: {
            total: users.length,
            admins: users.filter((user) => user.isAdmin === true).length,
            weakPasswords: users.filter((user) => Number(user.scorePWD ?? -2) <= 0).length,
            missingPasswords: users.filter((user) => Number(user.scorePWD ?? -2) === -1).length,
            disabled: users.filter((user) => Number(user.userState ?? 0) === 1).length,
            expired: users.filter((user) => {
                const state = Number(user.userState ?? 0);
                const until = Number(user.validUntil ?? 0);
                return (state === 2 || state === 4) && until > 0 && until < nowSince2009;
            }).length,
            trustPeers: trustPeers.length,
        },
    };
}
export async function readOperatingModes(db, serial) {
    const loxApp = await readLoxApp3(db, serial);
    const payload = loxApp.payload;
    const modes = payload.operatingModes ?? payload.operatingmodes ?? payload.operatingMode;
    if (Array.isArray(modes))
        return modes.filter((mode) => Boolean(mode && typeof mode === "object"));
    if (modes && typeof modes === "object") {
        return Object.entries(modes).map(([id, mode]) => mode && typeof mode === "object" ? { id, ...mode } : { id, name: String(mode) });
    }
    return [];
}
export async function readOperatingModeSchedule(db, serial) {
    const { connection, credentials } = await context(db, serial);
    const [entries, heatPeriod, coolPeriod] = await Promise.all([
        requestLoxone(connection, credentials, "/jdev/sps/calendargetentries"),
        requestLoxone(connection, credentials, "/jdev/sps/calendargetheatperiod").catch(() => null),
        requestLoxone(connection, credentials, "/jdev/sps/calendargetcoolperiod").catch(() => null),
    ]);
    return { entries, heatPeriod, coolPeriod };
}
export async function mutateOperatingModeSchedule(db, serial, operation, entry) {
    if (!entry.name || entry.name.length > 120)
        throw new LoxoneError("invalid_response", "Neplatný název kalendářní položky.");
    if (!Number.isInteger(entry.operatingMode) || !Number.isInteger(entry.calendarMode) || entry.calendarMode < 0 || entry.calendarMode > 5) {
        throw new LoxoneError("invalid_response", "Neplatný provozní nebo kalendářní režim.");
    }
    if (!/^[0-9/-]{1,64}$/.test(entry.calendarModeAttributes)) {
        throw new LoxoneError("invalid_response", "Neplatné kalendářní parametry.");
    }
    if ((operation === "update" || operation === "delete") && !entry.uuid?.match(/^[A-F0-9-]{20,40}$/i)) {
        throw new LoxoneError("invalid_response", "Neplatné UUID kalendářní položky.");
    }
    const { connection, credentials } = await context(db, serial);
    if (operation === "delete") {
        return requestLoxone(connection, credentials, `/jdev/sps/calendardeleteentry/${encodeURIComponent(entry.uuid)}`);
    }
    const suffix = `${encodeURIComponent(entry.name)}/${entry.operatingMode}/${entry.calendarMode}/${encodeURIComponent(entry.calendarModeAttributes)}`;
    const path = operation === "create"
        ? `/jdev/sps/calendarcreateentry/${suffix}`
        : `/jdev/sps/calendarupdateentry/${encodeURIComponent(entry.uuid)}/${suffix}`;
    return requestLoxone(connection, credentials, path);
}
function isPrivateAddress(address) {
    if (isIP(address) === 4) {
        const octets = address.split(".").map(Number);
        return (octets[0] === 10 ||
            octets[0] === 127 ||
            (octets[0] === 192 && octets[1] === 168) ||
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
            (octets[0] === 169 && octets[1] === 254));
    }
    if (isIP(address) === 6)
        return address === "::1" || address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd");
    return false;
}
export async function sendAllowedWebservice(db, serial, target) {
    if (!isPrivateAddress(target.address))
        throw new LoxoneError("invalid_response", "Povolené jsou jen privátní LAN adresy.");
    if (!target.webservice.startsWith("/") || /[\r\n]|:\/\/|@/.test(target.webservice)) {
        throw new LoxoneError("invalid_response", "Neplatná cesta LAN webservice.");
    }
    const { connection, credentials } = await context(db, serial);
    const query = new URLSearchParams({ json: JSON.stringify({ address: target.address, webservice: target.webservice }) });
    return requestLoxone(connection, credentials, `/jdev/sys/sendwebservice?${query}`);
}
export async function obtainJwt(db, serial, permission = 2) {
    const { connection, credentials } = await context(db, serial);
    const keyResponse = (await requestLoxone(connection, credentials, `/jdev/sys/getkey2/${encodeURIComponent(credentials.username)}`));
    const key = String(keyResponse.key ?? "");
    const salt = String(keyResponse.salt ?? "");
    const hashAlg = String(keyResponse.hashAlg ?? "SHA1").toUpperCase() === "SHA256" ? "SHA256" : "SHA1";
    if (!/^[A-F0-9]+$/i.test(key) || !salt)
        throw new LoxoneError("invalid_response", "Miniserver nevrátil platný JWT klíč.");
    const passwordHash = loxonePasswordHash(credentials.password, salt, hashAlg);
    const requestHash = loxoneHmac(`${credentials.username}:${passwordHash}`, key, hashAlg);
    const response = (await requestLoxone(connection, credentials, `/jdev/sys/getjwt/${requestHash}/${encodeURIComponent(credentials.username)}/${permission}/${config.appUuid}/${encodeURIComponent(config.appInfo)}`));
    const token = String(response.token ?? "");
    if (!token)
        throw new LoxoneError("unsupported", "Miniserver JWT token nevydal.");
    const validUntilRaw = Number(response.validUntil ?? response.validUntilSec ?? 0);
    const validUntil = validUntilRaw > 0 ? new Date(validUntilRaw * 1000).toISOString() : null;
    const userFingerprint = fingerprint(credentials.username.toLowerCase());
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO jwt_tokens(id,serial,user_fingerprint,token_encrypted,permission,valid_until,last_validated_at,created_at,updated_at)
     VALUES(lower(hex(randomblob(16))),?,?,?,?,?,?,?,?)
     ON CONFLICT(serial,user_fingerprint,permission) DO UPDATE SET
       token_encrypted=excluded.token_encrypted,valid_until=excluded.valid_until,
       last_validated_at=excluded.last_validated_at,updated_at=excluded.updated_at`).run(serial, userFingerprint, encryptSecret(token, config.masterKey, `${serial}:jwt:${userFingerprint}:${permission}`), permission, validUntil, now, now, now);
    return { validUntil, userFingerprint };
}
export function parseXmlDocument(xml) {
    return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
}
