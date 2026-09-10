import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting, transaction } from "./database.js";
const TOKEN_URL = "https://sso.loxone.com/realms/loxone/protocol/openid-connect/token";
const PORTAL_ORIGIN = "https://portal.loxone.com";
const REFRESH_AAD = "portal-sync:refresh-token";
const PASSWORD_AAD = "portal-sync:password";
const SYNC_INTERVAL_MS = 24 * 60 * 60_000;
const ERROR_BACKOFF_MS = 30 * 60_000;
const PORTAL_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
const PORTAL_MINISERVER_TYPES = Object.freeze({
    // These are the stable product_type keys used by the current Loxone Portal.
    // Do not infer the generation from a project name: `miniserver` is Gen. 1,
    // while `miniserver_v2` is the current second-generation Miniserver.
    miniserver: "Miniserver Gen. 1",
    miniserver_go: "Miniserver Go Gen. 1",
    miniserver_v2: "Miniserver",
    miniserver_v2_go: "Miniserver Go",
    miniserver_compact: "Miniserver Compact",
});
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
function portalNumberValue(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value !== "string")
        return null;
    let normalized = value.trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
    if (!normalized)
        return null;
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
        normalized = lastComma > lastDot
            ? normalized.replace(/\./g, "").replace(",", ".")
            : normalized.replace(/,/g, "");
    }
    else if (lastComma >= 0) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}
function portalNumber(record, keys) {
    for (const key of keys) {
        if (!(key in record))
            continue;
        const parsed = portalNumberValue(record[key]);
        if (parsed !== null)
            return parsed;
    }
    return null;
}
function nestedRecord(value, preferredKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    for (const key of preferredKeys) {
        const nested = record[key];
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            return nested;
        }
    }
    return record;
}
function findArray(value, preferredKeys) {
    if (Array.isArray(value))
        return value;
    if (!value || typeof value !== "object")
        return [];
    const record = value;
    for (const key of preferredKeys) {
        const nested = record[key];
        if (Array.isArray(nested))
            return nested;
    }
    for (const nested of Object.values(record)) {
        if (!nested || typeof nested !== "object")
            continue;
        const found = findArray(nested, preferredKeys);
        if (found.length)
            return found;
    }
    return [];
}
function recursiveNumber(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const direct = portalNumber(record, keys);
    if (direct !== null)
        return direct;
    for (const nested of Object.values(record)) {
        const found = recursiveNumber(nested, keys);
        if (found !== null)
            return found;
    }
    return null;
}
function portalBoolean(record, keys) {
    for (const key of keys) {
        if (!(key in record))
            continue;
        const value = record[key];
        if (typeof value === "boolean")
            return value;
        if (typeof value === "number" && (value === 0 || value === 1))
            return value === 1;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes", "active"].includes(normalized))
                return true;
            if (["false", "0", "no", "inactive"].includes(normalized))
                return false;
        }
    }
    return null;
}
export function normalizePortalMiniserverType(rawType) {
    const source = rawType.trim();
    // The Portal currently returns lowercase identifiers. Preserve the old
    // title-style fallback for previously cached/test payloads, where the plain
    // display label "Miniserver" meant the current model rather than the key.
    const exactKey = source === source.toLocaleLowerCase("en-US") || source.includes("_")
        ? source.toLocaleLowerCase("en-US")
        : "";
    if (exactKey && PORTAL_MINISERVER_TYPES[exactKey]) {
        return PORTAL_MINISERVER_TYPES[exactKey];
    }
    const normalized = source.toLocaleLowerCase("en-US");
    if (!normalized.includes("miniserver"))
        return null;
    if (normalized.includes("compact"))
        return "Miniserver Compact";
    const firstGeneration = normalized.includes("gen. 1")
        || normalized.includes("gen 1")
        || normalized.includes("gen1")
        || normalized.includes("1. generace");
    if (normalized.includes("go")) {
        return firstGeneration ? "Miniserver Go Gen. 1" : "Miniserver Go";
    }
    return firstGeneration ? "Miniserver Gen. 1" : "Miniserver";
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
    const type = normalizePortalMiniserverType(rawType);
    if (!type)
        return null;
    const weatherServiceActive = portalBoolean(record, ["active_weather_service", "activeWeatherService"]);
    return {
        serial,
        project: first(record, ["project", "project_name", "projectName", "name"]) || serial,
        type,
        registered: first(record, ["registered", "registered_at", "registeredAt", "registration_date"]),
        productId: first(record, ["id", "product_id", "productId"]) || null,
        weatherServiceStatus: weatherServiceActive === null ? "unknown" : weatherServiceActive ? "active" : "inactive",
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
function normalizeOrder(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const id = first(record, ["order_id", "orderId", "id", "number", "document_number"]);
    if (!id)
        return null;
    return {
        id,
        date: first(record, ["order_date", "orderDate", "date", "created_at", "createdAt"]) || null,
        reference: first(record, ["reference", "customer_reference", "customerReference", "description"]),
        status: first(record, ["status", "state", "order_status", "orderStatus"]),
        amount: portalNumber(record, ["order_amount_excl_vat", "orderAmountExclVat", "amount", "total", "net_amount"]),
    };
}
function normalizeLedgerEntry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const documentNumber = first(record, ["document_number", "documentNumber", "number", "invoice_number", "invoiceNumber", "id"]);
    if (!documentNumber)
        return null;
    return {
        documentNumber,
        date: first(record, ["date", "document_date", "documentDate", "invoice_date", "invoiceDate"]) || null,
        dueDate: first(record, ["due_date", "dueDate", "due", "payment_due_date"]) || null,
        description: first(record, ["description", "text", "reference", "document_type"]),
        amount: portalNumber(record, ["amount", "total_amount", "totalAmount", "value"]),
        openAmount: portalNumber(record, ["open_amount", "openAmount", "amount_open", "outstanding_amount"]),
        status: first(record, ["state", "status", "payment_status", "paymentStatus"]),
    };
}
function normalizeTraining(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const title = first(record, ["title", "name", "training_name", "trainingName", "description"]);
    const id = first(record, ["id", "training_id", "trainingId", "event_id", "eventId"]) || title;
    if (!id || !title)
        return null;
    return {
        id,
        title,
        startsAt: first(record, ["start_date", "startDate", "starts_at", "startsAt", "date_from", "dateFrom", "date"]) || null,
        endsAt: first(record, ["end_date", "endDate", "ends_at", "endsAt", "date_to", "dateTo"]) || null,
        status: first(record, ["status", "state", "booking_status", "bookingStatus"]),
        location: first(record, ["location", "place", "city", "venue"]),
    };
}
function isoDateOnly(value) {
    return value.toISOString().slice(0, 10);
}
async function portalJson(path, cookie, referer, body) {
    const response = await fetchWithTimeout(`${PORTAL_ORIGIN}${path}`, {
        method: "POST",
        headers: portalHeaders(cookie, `${PORTAL_ORIGIN}${referer}`),
        ...(body ? { body } : {}),
    });
    if (!response.ok)
        throw new Error(`${path} HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.valid !== true) {
        throw new Error(`${path} invalid response`);
    }
    return payload;
}
function normalizePortalOverview(partnerPayload, openOrdersPayload, ledgerPayload, trainingsPayload, updatedAt) {
    const partner = nestedRecord(partnerPayload, ["partner_data", "partnerData", "data"]) ?? {};
    const openOrders = openOrdersPayload
        ? findArray(openOrdersPayload, ["found_orders", "foundOrders", "orders", "items", "data"])
            .map(normalizeOrder).filter((item) => Boolean(item)).slice(0, 20)
        : [];
    const ledgerEntries = ledgerPayload
        ? findArray(ledgerPayload, ["ledger_entries", "ledgerEntries", "entries", "items", "data"])
            .map(normalizeLedgerEntry).filter((item) => Boolean(item)).slice(0, 20)
        : [];
    const trainings = trainingsPayload
        ? findArray(trainingsPayload, ["trainings", "events", "items", "data"])
            .map(normalizeTraining).filter((item) => Boolean(item)).slice(0, 20)
        : [];
    const creditLimit = portalNumber(partner, ["credit_limit", "creditLimit"]);
    const usedCredit = portalNumber(partner, ["used_credit", "usedCredit"]);
    const availableSections = [
        "partner",
        ...(openOrdersPayload ? ["orders"] : []),
        ...(ledgerPayload ? ["ledger"] : []),
        ...(trainingsPayload ? ["trainings"] : []),
    ];
    return {
        updatedAt,
        partnerStatus: first(partner, ["partner_status", "partnerStatus", "status"]) || null,
        nextCertificationDate: first(partner, ["next_certification_date", "nextCertificationDate", "certification_valid_until", "certificationValidUntil"]) || null,
        annualTrainingDone: portalBoolean(partner, ["annual_training_done", "annualTrainingDone"]),
        currency: first(partner, ["currency", "currency_code", "currencyCode"]) || null,
        creditLimit,
        usedCredit,
        availableCredit: creditLimit !== null && usedCredit !== null ? creditLimit - usedCredit : null,
        turnover12Months: portalNumber(partner, ["12_month_turnover", "twelve_month_turnover", "turnover12Months"]),
        openAmount: ledgerPayload ? recursiveNumber(ledgerPayload, ["total_amount_open", "totalAmountOpen", "open_amount_total", "openAmount"]) : null,
        dueAmount: ledgerPayload ? recursiveNumber(ledgerPayload, ["total_amount_due", "totalAmountDue", "due_amount_total", "dueAmount"]) : null,
        accountBalance: ledgerPayload ? recursiveNumber(ledgerPayload, ["saldo", "balance", "account_balance", "accountBalance"]) : null,
        openOrderCount: openOrdersPayload
            ? recursiveNumber(openOrdersPayload, ["overall_count", "overallCount", "count", "total"]) ?? openOrders.length
            : 0,
        openOrders,
        ledgerEntries,
        trainingCount: trainingsPayload
            ? recursiveNumber(trainingsPayload, ["overall_count", "overallCount", "count", "total"]) ?? trainings.length
            : 0,
        trainings,
        availableSections,
        unavailableSections: ["orders", "ledger", "trainings"].filter((section) => !availableSections.includes(section)),
    };
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
    const openOrdersBody = new FormData();
    openOrdersBody.set("offset", "0");
    openOrdersBody.set("limit", "999999");
    const ledgerBody = new FormData();
    const ledgerNow = new Date();
    // Keep this range aligned with the current official Invoices.vue request.
    const ledgerStart = new Date(Date.UTC(ledgerNow.getUTCFullYear(), ledgerNow.getUTCMonth() - 6, 1));
    const ledgerEnd = new Date(Date.UTC(ledgerNow.getUTCFullYear(), ledgerNow.getUTCMonth() + 1, 0));
    ledgerBody.set("startDate", isoDateOnly(ledgerStart));
    ledgerBody.set("endDate", isoDateOnly(ledgerEnd));
    const [ordersResult, ledgerResult, trainingsResult] = await Promise.allSettled([
        portalJson("/api/getOpenOrders", cookie, "/orders/", openOrdersBody),
        portalJson("/api/getCustomerLedgerEntries", cookie, "/invoices/", ledgerBody),
        portalJson("/api/getTrainings", cookie, "/trainings/"),
    ]);
    const now = new Date().toISOString();
    return {
        products,
        overview: normalizePortalOverview(partnerPayload, ordersResult.status === "fulfilled" ? ordersResult.value : null, ledgerResult.status === "fulfilled" ? ledgerResult.value : null, trainingsResult.status === "fulfilled" ? trainingsResult.value : null, now),
    };
}
function saveRefreshToken(db, token) {
    setSetting(db, "portal_sync_refresh_token", encryptSecret(token, config.masterKey, REFRESH_AAD));
}
function savePortalPassword(db, password) {
    setSetting(db, "portal_sync_password", encryptSecret(password, config.masterKey, PASSWORD_AAD));
}
function updateStatus(db, status, error = "") {
    setSetting(db, "portal_sync_status", status);
    setSetting(db, "portal_sync_error", error);
}
function upsertProducts(db, products, now) {
    const stable = db.prepare("SELECT version FROM firmware_releases WHERE channel='stable'").get()?.version ?? "";
    const existing = db.prepare("SELECT serial,project,portal_synced_project FROM miniservers WHERE serial=?");
    const insert = db.prepare(`INSERT INTO miniservers(serial,type,project,registered,credential_source,access_policy,target_firmware,firmware_policy,firmware_channel,portal_product_id,portal_last_seen_at,portal_synced_project,portal_synced_type,weather_service_status,weather_service_checked_at,created_at,updated_at)
     VALUES(?,?,?,?,?,'managed',?,'follow_stable','stable',?,?,?,?,?,?,?,?)`);
    const update = db.prepare(`UPDATE miniservers SET project=?,type=?,registered=CASE WHEN registered='' THEN ? ELSE registered END,
       portal_product_id=?,portal_last_seen_at=?,portal_synced_project=?,portal_synced_type=?,
       weather_service_status=?,weather_service_checked_at=?,updated_at=? WHERE serial=?`);
    for (const product of products) {
        const row = existing.get(product.serial);
        if (!row) {
            insert.run(product.serial, product.type, product.project, product.registered, "portal", stable, product.productId, now, product.project, product.type, product.weatherServiceStatus, now, now, now);
            continue;
        }
        const canUpdateProject = !row.project || row.project === product.serial || row.project === row.portal_synced_project;
        const project = canUpdateProject ? product.project : row.project;
        update.run(project, product.type, product.registered, product.productId, now, product.project, product.type, product.weatherServiceStatus, now, now, product.serial);
    }
}
export function getPortalSyncStatus(db) {
    const lastSyncAt = getSetting(db, "portal_sync_last_at");
    const encrypted = getSetting(db, "portal_sync_refresh_token");
    const nextAttemptAt = getSetting(db, "portal_sync_next_attempt_at");
    let overview = null;
    try {
        const cached = getSetting(db, "portal_sync_overview");
        if (cached)
            overview = JSON.parse(cached);
    }
    catch {
        overview = null;
    }
    return {
        connected: Boolean(encrypted),
        reconnectRequired: getSetting(db, "portal_sync_status") === "reconnect_required",
        automaticReconnect: Boolean(encrypted && getSetting(db, "portal_sync_password")),
        email: getSetting(db, "portal_sync_email"),
        status: getSetting(db, "portal_sync_status") ?? "not_connected",
        lastSyncAt,
        nextSyncAt: encrypted
            ? nextAttemptAt || new Date((lastSyncAt && Number.isFinite(Date.parse(lastSyncAt)) ? Date.parse(lastSyncAt) : Date.now()) + SYNC_INTERVAL_MS).toISOString()
            : null,
        lastAutomaticLoginAt: getSetting(db, "portal_sync_last_reauth_at"),
        productCount: Number(getSetting(db, "portal_sync_count") ?? 0),
        lastError: getSetting(db, "portal_sync_error") || null,
        overview,
    };
}
export function portalSyncDue(db, now = Date.now()) {
    if (!getSetting(db, "portal_sync_refresh_token"))
        return false;
    const nextAttempt = getSetting(db, "portal_sync_next_attempt_at");
    if (nextAttempt && Number.isFinite(Date.parse(nextAttempt)))
        return now >= Date.parse(nextAttempt);
    const last = getSetting(db, "portal_sync_last_at");
    return !last || !Number.isFinite(Date.parse(last)) || now - Date.parse(last) >= SYNC_INTERVAL_MS;
}
export async function connectPortal(db, email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    const tokens = await passwordGrant(normalizedEmail, password);
    if (!tokens.refresh_token)
        throw Object.assign(new Error("Loxone Portál neposkytl obnovovací token."), { code: "portal_refresh_missing" });
    saveRefreshToken(db, tokens.refresh_token);
    savePortalPassword(db, password);
    setSetting(db, "portal_sync_email", normalizedEmail);
    setSetting(db, "portal_sync_last_attempt_at", new Date().toISOString());
    updateStatus(db, "connected");
    await syncPortal(db, tokens.access_token, tokens.refresh_token);
    return getPortalSyncStatus(db);
}
export async function syncPortal(db, suppliedAccessToken, suppliedRefreshToken) {
    const attemptAt = new Date();
    setSetting(db, "portal_sync_last_attempt_at", attemptAt.toISOString());
    try {
        let accessToken = suppliedAccessToken;
        let refreshToken = suppliedRefreshToken;
        if (!accessToken) {
            const encrypted = getSetting(db, "portal_sync_refresh_token");
            if (!encrypted)
                throw Object.assign(new Error("Loxone Portál není připojen."), { code: "portal_not_connected" });
            refreshToken = decryptSecret(encrypted, config.masterKey, REFRESH_AAD);
            let tokens;
            try {
                tokens = await refreshGrant(refreshToken);
            }
            catch (error) {
                if (error.code !== "portal_reconnect_required")
                    throw error;
                const email = getSetting(db, "portal_sync_email");
                const encryptedPassword = getSetting(db, "portal_sync_password");
                if (!email || !encryptedPassword) {
                    throw Object.assign(new Error("Přihlášení vypršelo a automatické obnovení není dostupné."), { code: "portal_reconnect_required" });
                }
                let password;
                try {
                    password = decryptSecret(encryptedPassword, config.masterKey, PASSWORD_AAD);
                }
                catch {
                    throw Object.assign(new Error("Uložené přihlášení Loxone Portálu nelze bezpečně přečíst."), { code: "portal_reconnect_required" });
                }
                tokens = await passwordGrant(email, password);
                if (!tokens.refresh_token) {
                    throw Object.assign(new Error("Loxone Portál po automatickém přihlášení neposkytl obnovovací token."), { code: "portal_reconnect_required" });
                }
                setSetting(db, "portal_sync_last_reauth_at", new Date().toISOString());
            }
            accessToken = tokens.access_token;
            refreshToken = tokens.refresh_token ?? refreshToken;
        }
        if (refreshToken)
            saveRefreshToken(db, refreshToken);
        const portalData = await portalProducts(accessToken);
        const now = new Date().toISOString();
        transaction(db, () => upsertProducts(db, portalData.products, now));
        setSetting(db, "portal_sync_last_at", now);
        setSetting(db, "portal_sync_next_attempt_at", new Date(Date.parse(now) + SYNC_INTERVAL_MS).toISOString());
        setSetting(db, "portal_sync_count", String(portalData.products.length));
        setSetting(db, "portal_sync_overview", JSON.stringify({ ...portalData.overview, updatedAt: now }));
        updateStatus(db, "connected");
        return getPortalSyncStatus(db);
    }
    catch (error) {
        const code = error.code ?? "portal_sync_failed";
        if (code === "portal_reconnect_required") {
            setSetting(db, "portal_sync_refresh_token", "");
            setSetting(db, "portal_sync_password", "");
            setSetting(db, "portal_sync_next_attempt_at", "");
            updateStatus(db, "reconnect_required", "Automatické přihlášení bylo odmítnuto. Připojte Loxone Portál znovu.");
        }
        else {
            setSetting(db, "portal_sync_next_attempt_at", new Date(attemptAt.getTime() + ERROR_BACKOFF_MS).toISOString());
            updateStatus(db, "error", error.message);
        }
        throw error;
    }
}
export function disconnectPortal(db) {
    for (const key of [
        "portal_sync_refresh_token",
        "portal_sync_password",
        "portal_sync_email",
        "portal_sync_error",
        "portal_sync_count",
        "portal_sync_last_at",
        "portal_sync_last_attempt_at",
        "portal_sync_next_attempt_at",
        "portal_sync_last_reauth_at",
        "portal_sync_overview",
    ])
        setSetting(db, key, "");
    updateStatus(db, "not_connected");
    return getPortalSyncStatus(db);
}
