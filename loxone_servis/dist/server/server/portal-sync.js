import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting, transaction } from "./database.js";
const TOKEN_URL = "https://sso.loxone.com/realms/loxone/protocol/openid-connect/token";
const PORTAL_ORIGIN = "https://portal.loxone.com";
const REFRESH_AAD = "portal-sync:refresh-token";
const SYNC_INTERVAL_MS = 24 * 60 * 60_000;
const PORTAL_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
function form(values) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
        body.set(key, value);
    return body;
}
async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    }
    finally {
        clearTimeout(timeout);
    }
}
async function readToken(response) {
    let payload = {};
    try {
        payload = await response.json();
    }
    catch {
        // Odpověď se záměrně neloguje, protože může obsahovat token.
    }
    if (!response.ok || !payload.access_token) {
        const error = new Error(payload.error === "invalid_grant" ? "Přihlášení do Loxone Portálu bylo odmítnuto." : "Loxone Portál nevydal přístupový token.");
        Object.assign(error, { code: payload.error === "invalid_grant" ? "portal_reconnect_required" : "portal_auth_failed" });
        throw error;
    }
    return payload;
}
async function passwordGrant(email, password) {
    return readToken(await fetchWithTimeout(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_id: "portal", grant_type: "password", scope: "openid offline_access", username: email, password }),
    }));
}
async function refreshGrant(refreshToken) {
    return readToken(await fetchWithTimeout(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_id: "portal", grant_type: "refresh_token", refresh_token: refreshToken }),
    }));
}
function cookieHeader(response) {
    const headers = response.headers;
    const setCookies = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
    return setCookies.map((entry) => entry.split(";", 1)[0]).filter(Boolean).join("; ");
}
function mergeCookies(...values) {
    const cookies = new Map();
    for (const value of values) {
        for (const pair of value.split(";")) {
            const separator = pair.indexOf("=");
            if (separator <= 0)
                continue;
            const name = pair.slice(0, separator).trim();
            const cookieValue = pair.slice(separator + 1).trim();
            if (name && cookieValue)
                cookies.set(name, cookieValue);
        }
    }
    return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}
function portalHeaders(cookie = "", referer = `${PORTAL_ORIGIN}/`) {
    return {
        accept: "application/json, text/plain, */*",
        origin: PORTAL_ORIGIN,
        referer,
        "user-agent": PORTAL_USER_AGENT,
        ...(cookie ? { cookie } : {}),
    };
}
function text(value) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function first(record, keys) {
    for (const key of keys) {
        const value = text(record[key]);
        if (value)
            return value;
    }
    return "";
}
function normalizeProduct(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const serial = first(record, ["serial_no", "serialNo", "serial", "serialnumber", "serial_number", "sn"])
        .replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(serial))
        return null;
    const rawType = first(record, ["product_type", "productType", "type"]);
    if (!rawType.toLocaleLowerCase("en-US").includes("miniserver"))
        return null;
    const normalizedType = rawType.toLocaleLowerCase("en-US");
    const type = normalizedType.includes("compact")
        ? "Miniserver Compact"
        : normalizedType.includes(" go") || normalizedType.endsWith("go")
            ? "Miniserver Go"
            : normalizedType.includes("gen. 1") || normalizedType.includes("gen 1") || normalizedType.includes("gen1")
                ? "Miniserver Gen. 1"
                : "Miniserver";
    return {
        serial,
        project: first(record, ["project", "project_name", "projectName", "name"]) || serial,
        type,
        registered: first(record, ["registered", "registered_at", "registeredAt", "registration_date"]),
        productId: first(record, ["id", "product_id", "productId"]) || null,
    };
}
function findProducts(value) {
    if (Array.isArray(value))
        return value;
    if (!value || typeof value !== "object")
        return [];
    const record = value;
    for (const key of ["products", "registeredProducts", "data", "items", "result"]) {
        const nested = record[key];
        if (Array.isArray(nested))
            return nested;
        if (nested && typeof nested === "object") {
            const found = findProducts(nested);
            if (found.length)
                return found;
        }
    }
    return [];
}
async function portalProducts(accessToken) {
    const home = await fetchWithTimeout(`${PORTAL_ORIGIN}/`, {
        method: "GET",
        headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "user-agent": PORTAL_USER_AGENT,
        },
    });
    if (!home.ok)
        throw Object.assign(new Error("Loxone Portál není dostupný."), { code: "portal_session_failed" });
    let cookie = cookieHeader(home);
    const sessionBody = new FormData();
    sessionBody.set("token", accessToken);
    const session = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/setUserSessionCookie`, {
        method: "POST",
        headers: portalHeaders(cookie),
        body: sessionBody,
    });
    if (!session.ok)
        throw Object.assign(new Error("Loxone Portál nevytvořil synchronizační relaci."), { code: "portal_session_failed" });
    cookie = mergeCookies(cookie, cookieHeader(session));
    if (!cookie)
        throw Object.assign(new Error("Loxone Portál neposlal synchronizační cookie."), { code: "portal_session_failed" });
    const partnerResponse = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/getPartnerData`, {
        method: "POST",
        headers: portalHeaders(cookie),
    });
    let partnerPayload = {};
    try {
        partnerPayload = await partnerResponse.json();
    }
    catch {
        // Obsah odpovědi se záměrně neloguje.
    }
    if (!partnerResponse.ok || partnerPayload.valid !== true) {
        throw Object.assign(new Error("Synchronizační relace Loxone Portálu nebyla ověřena."), { code: "portal_session_failed" });
    }
    const response = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/getRegisteredProducts`, {
        method: "POST",
        headers: portalHeaders(cookie, `${PORTAL_ORIGIN}/products/`),
    });
    if (!response.ok)
        throw Object.assign(new Error("Seznam zařízení z Loxone Portálu není dostupný."), { code: "portal_products_failed" });
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.valid !== true) {
        throw Object.assign(new Error("Loxone Portál odmítl načtení registrovaných zařízení."), { code: "portal_products_failed" });
    }
    const products = findProducts(payload).map(normalizeProduct).filter((item) => Boolean(item));
    if (!products.length)
        throw Object.assign(new Error("Loxone Portál nevrátil žádné registrované Miniservery."), { code: "portal_format_changed" });
    return products;
}
function saveRefreshToken(db, token) {
    setSetting(db, "portal_sync_refresh_token", encryptSecret(token, config.masterKey, REFRESH_AAD));
}
function updateStatus(db, status, error = "") {
    setSetting(db, "portal_sync_status", status);
    setSetting(db, "portal_sync_error", error);
}
function upsertProducts(db, products, now) {
    const stable = db.prepare("SELECT version FROM firmware_releases WHERE channel='stable'").get()?.version ?? "";
    const existing = db.prepare("SELECT serial,project,portal_synced_project FROM miniservers WHERE serial=?");
    const insert = db.prepare(`INSERT INTO miniservers(serial,type,project,registered,credential_source,access_policy,target_firmware,firmware_policy,firmware_channel,portal_product_id,portal_last_seen_at,portal_synced_project,portal_synced_type,created_at,updated_at)
     VALUES(?,?,?,?,?,'managed',?,'follow_stable','stable',?,?,?,?,?,?)`);
    const update = db.prepare(`UPDATE miniservers SET project=?,type=?,registered=CASE WHEN registered='' THEN ? ELSE registered END,
       portal_product_id=?,portal_last_seen_at=?,portal_synced_project=?,portal_synced_type=?,updated_at=? WHERE serial=?`);
    for (const product of products) {
        const row = existing.get(product.serial);
        if (!row) {
            insert.run(product.serial, product.type, product.project, product.registered, "portal", stable, product.productId, now, product.project, product.type, now, now);
            continue;
        }
        const canUpdateProject = !row.project || row.project === product.serial || row.project === row.portal_synced_project;
        const project = canUpdateProject ? product.project : row.project;
        update.run(project, product.type, product.registered, product.productId, now, product.project, product.type, now, product.serial);
    }
}
export function getPortalSyncStatus(db) {
    const lastSyncAt = getSetting(db, "portal_sync_last_at");
    const encrypted = getSetting(db, "portal_sync_refresh_token");
    return {
        connected: Boolean(encrypted),
        reconnectRequired: getSetting(db, "portal_sync_status") === "reconnect_required",
        email: getSetting(db, "portal_sync_email"),
        status: getSetting(db, "portal_sync_status") ?? "not_connected",
        lastSyncAt,
        nextSyncAt: encrypted ? new Date((lastSyncAt ? Date.parse(lastSyncAt) : Date.now()) + SYNC_INTERVAL_MS).toISOString() : null,
        productCount: Number(getSetting(db, "portal_sync_count") ?? 0),
        lastError: getSetting(db, "portal_sync_error") || null,
    };
}
export function portalSyncDue(db, now = Date.now()) {
    if (!getSetting(db, "portal_sync_refresh_token"))
        return false;
    const last = getSetting(db, "portal_sync_last_at");
    return !last || !Number.isFinite(Date.parse(last)) || now - Date.parse(last) >= SYNC_INTERVAL_MS;
}
export async function connectPortal(db, email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    const tokens = await passwordGrant(normalizedEmail, password);
    if (!tokens.refresh_token)
        throw Object.assign(new Error("Loxone Portál neposkytl obnovovací token."), { code: "portal_refresh_missing" });
    saveRefreshToken(db, tokens.refresh_token);
    setSetting(db, "portal_sync_email", normalizedEmail);
    updateStatus(db, "connected");
    await syncPortal(db, tokens.access_token, tokens.refresh_token);
    return getPortalSyncStatus(db);
}
export async function syncPortal(db, suppliedAccessToken, suppliedRefreshToken) {
    try {
        let accessToken = suppliedAccessToken;
        let refreshToken = suppliedRefreshToken;
        if (!accessToken) {
            const encrypted = getSetting(db, "portal_sync_refresh_token");
            if (!encrypted)
                throw Object.assign(new Error("Loxone Portál není připojen."), { code: "portal_not_connected" });
            refreshToken = decryptSecret(encrypted, config.masterKey, REFRESH_AAD);
            const tokens = await refreshGrant(refreshToken);
            accessToken = tokens.access_token;
            refreshToken = tokens.refresh_token ?? refreshToken;
        }
        if (refreshToken)
            saveRefreshToken(db, refreshToken);
        const products = await portalProducts(accessToken);
        const now = new Date().toISOString();
        transaction(db, () => upsertProducts(db, products, now));
        setSetting(db, "portal_sync_last_at", now);
        setSetting(db, "portal_sync_count", String(products.length));
        updateStatus(db, "connected");
        return getPortalSyncStatus(db);
    }
    catch (error) {
        const code = error.code ?? "portal_sync_failed";
        if (code === "portal_reconnect_required") {
            setSetting(db, "portal_sync_refresh_token", "");
            updateStatus(db, "reconnect_required", "Přihlášení vypršelo. Připojte Loxone Portál znovu.");
        }
        else {
            updateStatus(db, "error", error.message);
        }
        throw error;
    }
}
export function disconnectPortal(db) {
    for (const key of ["portal_sync_refresh_token", "portal_sync_email", "portal_sync_error", "portal_sync_count", "portal_sync_last_at"])
        setSetting(db, key, "");
    updateStatus(db, "not_connected");
    return getPortalSyncStatus(db);
}
