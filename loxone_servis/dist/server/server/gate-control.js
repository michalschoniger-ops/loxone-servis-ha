import { Buffer } from "node:buffer";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting } from "./database.js";
const SETTINGS = {
    openUrl: ["camera_gate_open_url_encrypted", "camera-gate:open-url"],
    closeUrl: ["camera_gate_close_url_encrypted", "camera-gate:close-url"],
    username: ["camera_gate_username_encrypted", "camera-gate:username"],
    password: ["camera_gate_password_encrypted", "camera-gate:password"],
    method: "camera_gate_http_method",
};
const GATE_PROJECT = "Parkoviště a brána";
const COMMAND_TIMEOUT_MS = 7_000;
export class GateControlError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
let commandInFlight = false;
function ensureEncryption() {
    if (config.masterKey.length !== 32) {
        throw new GateControlError("INVALID_CONFIG", "Ovládání brány lze nastavit jen na hlavní instanci s aktivním šifrováním.");
    }
}
function normalizeCommandUrl(value) {
    const normalized = value.trim();
    if (!normalized || normalized.length > 2_048) {
        throw new GateControlError("INVALID_CONFIG", "HTTP příkaz brány nemá platnou délku.");
    }
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new GateControlError("INVALID_CONFIG", "HTTP příkaz brány nemá platnou adresu.");
    }
    if (parsed.protocol !== "https:"
        || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new GateControlError("INVALID_CONFIG", "HTTP příkaz brány smí používat jen HTTPS bez přihlašovacích údajů, parametrů a fragmentu.");
    }
    return parsed.toString();
}
function normalizeUsername(value) {
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || /[:\r\n\0]/.test(normalized)) {
        throw new GateControlError("INVALID_CONFIG", "Přihlašovací jméno zařízení brány není platné.");
    }
    return normalized;
}
function normalizePassword(value) {
    if (!value || value.length > 256 || /[\r\n\0]/.test(value)) {
        throw new GateControlError("INVALID_CONFIG", "Heslo zařízení brány není platné.");
    }
    return value;
}
function isLoxoneCloudHost(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "loxonecloud.com" || normalized.endsWith(".loxonecloud.com");
}
function redirectedCommandUrl(source, location) {
    if (!location) {
        throw new GateControlError("UNAVAILABLE", "Zařízení brány nevrátilo platný cíl HTTP přesměrování.");
    }
    try {
        const original = new URL(source);
        const redirected = new URL(location, original);
        const trustedCrossOrigin = isLoxoneCloudHost(original.hostname) && isLoxoneCloudHost(redirected.hostname);
        if (redirected.protocol !== "https:"
            || redirected.username || redirected.password || redirected.search || redirected.hash
            || (redirected.origin !== original.origin && !trustedCrossOrigin)) {
            throw new Error("untrusted redirect");
        }
        return redirected.toString();
    }
    catch {
        throw new GateControlError("UNAVAILABLE", "Zařízení brány vrátilo nedůvěryhodné HTTP přesměrování.");
    }
}
function readEncryptedUrl(db, setting) {
    const stored = getSetting(db, setting[0]);
    if (!stored)
        return null;
    try {
        ensureEncryption();
        return normalizeCommandUrl(decryptSecret(stored, config.masterKey, setting[1]));
    }
    catch {
        return null;
    }
}
function readEncryptedCredential(db, setting, normalize) {
    const stored = getSetting(db, setting[0]);
    if (!stored)
        return null;
    try {
        ensureEncryption();
        return normalize(decryptSecret(stored, config.masterKey, setting[1]));
    }
    catch {
        return null;
    }
}
function readConfiguration(db) {
    const openUrl = readEncryptedUrl(db, SETTINGS.openUrl);
    const closeUrl = readEncryptedUrl(db, SETTINGS.closeUrl);
    const username = readEncryptedCredential(db, SETTINGS.username, normalizeUsername);
    const password = readEncryptedCredential(db, SETTINGS.password, normalizePassword);
    const method = getSetting(db, SETTINGS.method);
    if (!openUrl || !closeUrl || !username || !password || (method !== "GET" && method !== "POST"))
        return null;
    return { openUrl, closeUrl, username, password, method };
}
export function gateControlStatus(db) {
    const configured = readConfiguration(db) !== null;
    return {
        configured,
        // Stav nezkoušíme ověřovat zkušebním HTTP povelem: ten by s bránou
        // skutečně pohnul. Platná, dešifrovatelná dvojice příkazů je proto
        // dostupná k použití a výsledek konkrétního povelu se ověří jeho HTTP
        // odpovědí.
        available: configured,
        project: configured ? GATE_PROJECT : null,
    };
}
export function configureGateControl(db, input) {
    ensureEncryption();
    const openUrl = normalizeCommandUrl(input.openUrl);
    const closeUrl = normalizeCommandUrl(input.closeUrl);
    const username = normalizeUsername(input.username);
    const password = normalizePassword(input.password);
    const method = input.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
        throw new GateControlError("INVALID_CONFIG", "Metoda HTTP příkazu brány není podporovaná.");
    }
    if (new URL(openUrl).origin !== new URL(closeUrl).origin) {
        throw new GateControlError("INVALID_CONFIG", "Oba HTTP příkazy brány musí patřit stejnému ověřenému zařízení.");
    }
    setSetting(db, SETTINGS.openUrl[0], encryptSecret(openUrl, config.masterKey, SETTINGS.openUrl[1]));
    setSetting(db, SETTINGS.closeUrl[0], encryptSecret(closeUrl, config.masterKey, SETTINGS.closeUrl[1]));
    setSetting(db, SETTINGS.username[0], encryptSecret(username, config.masterKey, SETTINGS.username[1]));
    setSetting(db, SETTINGS.password[0], encryptSecret(password, config.masterKey, SETTINGS.password[1]));
    setSetting(db, SETTINGS.method, method);
    return gateControlStatus(db);
}
export async function executeGateControl(db, command) {
    const configured = readConfiguration(db);
    if (!configured)
        throw new GateControlError("NOT_CONFIGURED", "Ovládání brány zatím není nastavené.");
    if (commandInFlight)
        throw new GateControlError("BUSY", "Předchozí příkaz brány ještě probíhá.");
    commandInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
    try {
        const commandUrl = command === "open" ? configured.openUrl : configured.closeUrl;
        const requestInit = {
            method: configured.method,
            redirect: "manual",
            cache: "no-store",
            headers: {
                Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
                Authorization: `Basic ${Buffer.from(`${configured.username}:${configured.password}`, "utf8").toString("base64")}`,
            },
            signal: controller.signal,
        };
        let response = await fetch(commandUrl, requestInit);
        if (response.status === 307 || response.status === 308) {
            const redirectedUrl = redirectedCommandUrl(commandUrl, response.headers.get("location"));
            await response.body?.cancel().catch(() => undefined);
            response = await fetch(redirectedUrl, { ...requestInit, redirect: "error" });
        }
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401 || response.status === 403) {
            throw new GateControlError("AUTH_FAILED", "Přihlášení zařízení brány bylo odmítnuto.");
        }
        if (!response.ok) {
            throw new GateControlError("UNAVAILABLE", "Zařízení brány HTTP příkaz nepotvrdilo.");
        }
        return { ok: true, command };
    }
    catch (error) {
        if (error instanceof GateControlError)
            throw error;
        // Záměrně nevracíme původní chybu: implementace fetch může do jejího
        // textu vložit celou citlivou adresu příkazu.
        throw new GateControlError("UNAVAILABLE", "Zařízení brány na HTTP příkaz neodpovědělo.");
    }
    finally {
        clearTimeout(timeout);
        commandInFlight = false;
    }
}
