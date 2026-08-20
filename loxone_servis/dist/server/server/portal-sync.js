import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting, transaction } from "./database.js";
const TOKEN_URL = "https://sso.loxone.com/realms/loxone/protocol/openid-connect/token";
const PORTAL_ORIGIN = "https://portal.loxone.com";
const REFRESH_AAD = "portal-sync:refresh-token";
const SYNC_INTERVAL_MS = 24 * 60 * 60_000;
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
    return {
        serial,
        project: first(record, ["project", "project_name", "projectName", "name"]) || serial,
        type: first(record, ["product_type", "productType", "type"]) || "Miniserver",
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
    const session = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/setUserSessionCookie`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form({ token: accessToken }),
    });
    if (!session.ok)
        throw Object.assign(new Error("Loxone Portál nevytvořil synchronizační relaci."), { code: "portal_session_failed" });
    const cookie = cookieHeader(session);
    if (!cookie)
        throw Object.assign(new Error("Loxone Portál neposlal synchronizační cookie."), { code: "portal_session_failed" });
    const response = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/getRegisteredProducts`, {
        method: "POST",
        headers: { accept: "application/json", cookie, origin: PORTAL_ORIGIN, referer: `${PORTAL_ORIGIN}/products/` },
    });
    if (!response.ok)
        throw Object.assign(new Error("Seznam zařízení z Loxone Portálu není dostupný."), { code: "portal_products_failed" });
    const payload = await response.json();
    const products = findProducts(payload).map(normalizeProduct).filter((item) => Boolean(item));
    if (!products.length && findProducts(payload).length)
        throw Object.assign(new Error("Loxone Portál změnil formát seznamu zařízení."), { code: "portal_format_changed" });
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
