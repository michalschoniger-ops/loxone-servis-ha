import { createHash } from "node:crypto";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting } from "./database.js";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPES = "offline_access Files.ReadWrite";
const REFRESH_TOKEN_AAD = "service-tasks-excel-graph-refresh-v1";
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MAX_CELL_TEXT = 32_000;
const SETTINGS = {
    refreshToken: "service_tasks_excel_graph_refresh_token",
    connectedAt: "service_tasks_excel_graph_connected_at",
    lastError: "service_tasks_excel_graph_last_error",
    reconnectRequired: "service_tasks_excel_graph_reconnect_required",
    driveId: "service_tasks_excel_graph_drive_id",
    itemId: "service_tasks_excel_graph_item_id",
    shareFingerprint: "service_tasks_excel_graph_share_fingerprint",
    writebackVerifiedAt: "service_tasks_excel_graph_writeback_verified_at",
    writebackVerifiedShareFingerprint: "service_tasks_excel_graph_writeback_verified_share_fingerprint",
};
const deviceFlows = new WeakMap();
const graphQueues = new WeakMap();
export class ServiceTaskExcelGraphError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "ServiceTaskExcelGraphError";
    }
}
function graphConfigured() {
    return Boolean(config.serviceTasksExcelGraphTenantId && config.serviceTasksExcelGraphClientId);
}
function tokenEndpoint(path) {
    return `https://login.microsoftonline.com/${config.serviceTasksExcelGraphTenantId}/oauth2/v2.0/${path}`;
}
function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
async function responseObject(response) {
    try {
        return object(await response.json());
    }
    catch {
        return {};
    }
}
function setting(db, key) {
    return getSetting(db, key) ?? "";
}
function clearWorkbookLocation(db) {
    setSetting(db, SETTINGS.driveId, "");
    setSetting(db, SETTINGS.itemId, "");
    setSetting(db, SETTINGS.shareFingerprint, "");
}
function recordGraphError(db, message, reconnectRequired = false) {
    setSetting(db, SETTINGS.lastError, message);
    setSetting(db, SETTINGS.reconnectRequired, reconnectRequired ? "1" : "");
    if (reconnectRequired)
        setSetting(db, SETTINGS.connectedAt, "");
}
function clearGraphError(db) {
    setSetting(db, SETTINGS.lastError, "");
    setSetting(db, SETTINGS.reconnectRequired, "");
}
function verificationUri(value) {
    if (typeof value !== "string")
        return "";
    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
            return "";
        if (host !== "microsoft.com" && !host.endsWith(".microsoft.com") && !host.endsWith(".microsoftonline.com"))
            return "";
        return parsed.toString();
    }
    catch {
        return "";
    }
}
export function getServiceTaskExcelGraphStatus(db) {
    const configured = graphConfigured();
    const now = Date.now();
    let flow = deviceFlows.get(db);
    if (flow && flow.expiresAtMs <= now) {
        deviceFlows.delete(db);
        recordGraphError(db, "Přihlašovací kód Microsoft 365 vypršel. Spusťte připojení znovu.");
        flow = undefined;
    }
    const hasRefreshToken = Boolean(setting(db, SETTINGS.refreshToken));
    const connectedAt = setting(db, SETTINGS.connectedAt) || null;
    const writebackVerifiedAt = setting(db, SETTINGS.writebackVerifiedShareFingerprint) === shareFingerprint()
        ? setting(db, SETTINGS.writebackVerifiedAt) || null
        : null;
    const lastError = setting(db, SETTINGS.lastError) || null;
    const reconnectRequired = setting(db, SETTINGS.reconnectRequired) === "1";
    const state = !configured ? "not_configured"
        : flow ? "pending"
            : reconnectRequired ? "reconnect_required"
                : lastError ? "error"
                    : hasRefreshToken && connectedAt ? "connected" : "disconnected";
    return {
        configured,
        state,
        connectedAt,
        writebackVerifiedAt,
        lastError,
        verification: flow ? {
            userCode: flow.userCode,
            verificationUri: flow.verificationUri,
            expiresAt: new Date(flow.expiresAtMs).toISOString(),
            pollAfterMs: Math.max(1_000, flow.nextPollAtMs - now),
        } : null,
    };
}
export function serviceTaskExcelGraphReady(db) {
    return Boolean(graphConfigured()
        && config.serviceTasksExcelShareUrl
        && setting(db, SETTINGS.refreshToken)
        && setting(db, SETTINGS.connectedAt));
}
export async function startServiceTaskExcelGraphConnection(db) {
    if (!graphConfigured()) {
        throw new ServiceTaskExcelGraphError("Microsoft Graph zatím nemá nastavený tenant ID a client ID.", "GRAPH_NOT_CONFIGURED");
    }
    if (!config.serviceTasksExcelShareUrl) {
        throw new ServiceTaskExcelGraphError("Nejdřív nastavte sdílený odkaz na Excel.", "SHARE_URL_NOT_CONFIGURED");
    }
    let response;
    try {
        response = await fetch(tokenEndpoint("devicecode"), {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({ client_id: config.serviceTasksExcelGraphClientId, scope: GRAPH_SCOPES }),
            signal: AbortSignal.timeout(15_000),
        });
    }
    catch {
        throw new ServiceTaskExcelGraphError("Microsoft 365 právě neodpovídá.", "GRAPH_DEVICE_CODE_UNAVAILABLE");
    }
    const payload = await responseObject(response);
    if (!response.ok) {
        throw new ServiceTaskExcelGraphError("Microsoft 365 odmítl zahájení připojení.", "GRAPH_DEVICE_CODE_REJECTED");
    }
    const deviceCode = typeof payload.device_code === "string" ? payload.device_code : "";
    const userCode = typeof payload.user_code === "string" ? payload.user_code.trim() : "";
    const uri = verificationUri(payload.verification_uri);
    const expiresIn = Math.max(60, Math.min(1_800, Number(payload.expires_in ?? 900)));
    const intervalMs = Math.max(5_000, Math.min(30_000, Number(payload.interval ?? 5) * 1_000));
    if (!deviceCode || !userCode || !uri || !Number.isFinite(expiresIn) || !Number.isFinite(intervalMs)) {
        throw new ServiceTaskExcelGraphError("Microsoft 365 vrátil neúplný přihlašovací kód.", "GRAPH_DEVICE_CODE_INVALID");
    }
    deviceFlows.set(db, {
        deviceCode,
        userCode,
        verificationUri: uri,
        expiresAtMs: Date.now() + expiresIn * 1_000,
        intervalMs,
        nextPollAtMs: Date.now(),
    });
    clearGraphError(db);
    return getServiceTaskExcelGraphStatus(db);
}
function saveRefreshToken(db, refreshToken) {
    setSetting(db, SETTINGS.refreshToken, encryptSecret(refreshToken, config.masterKey, REFRESH_TOKEN_AAD));
}
function readRefreshToken(db) {
    const encrypted = setting(db, SETTINGS.refreshToken);
    if (!encrypted)
        throw new ServiceTaskExcelGraphError("Microsoft 365 není připojený.", "GRAPH_AUTH_REQUIRED");
    try {
        return decryptSecret(encrypted, config.masterKey, REFRESH_TOKEN_AAD);
    }
    catch {
        recordGraphError(db, "Uložené připojení Microsoft 365 nelze bezpečně přečíst. Připojte účet znovu.", true);
        throw new ServiceTaskExcelGraphError("Microsoft 365 vyžaduje nové připojení.", "GRAPH_RECONNECT_REQUIRED");
    }
}
function tokenFailure(code) {
    if (["invalid_grant", "interaction_required", "unauthorized_client"].includes(code)) {
        return { message: "Microsoft 365 vyžaduje nové připojení účtu.", reconnect: true };
    }
    if (code === "authorization_declined")
        return { message: "Připojení Microsoft 365 bylo zamítnuto.", reconnect: false };
    if (code === "expired_token")
        return { message: "Přihlašovací kód Microsoft 365 vypršel.", reconnect: false };
    return { message: "Microsoft 365 připojení se nepodařilo dokončit.", reconnect: false };
}
async function accessTokenFromRefresh(db) {
    const refreshToken = readRefreshToken(db);
    let response;
    try {
        response = await fetch(tokenEndpoint("token"), {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({
                client_id: config.serviceTasksExcelGraphClientId,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                scope: GRAPH_SCOPES,
            }),
            signal: AbortSignal.timeout(15_000),
        });
    }
    catch {
        recordGraphError(db, "Microsoft 365 právě neodpovídá.");
        throw new ServiceTaskExcelGraphError("Microsoft 365 právě neodpovídá.", "GRAPH_TOKEN_UNAVAILABLE");
    }
    const payload = await responseObject(response);
    if (!response.ok) {
        const failure = tokenFailure(typeof payload.error === "string" ? payload.error : "");
        recordGraphError(db, failure.message, failure.reconnect);
        throw new ServiceTaskExcelGraphError(failure.message, failure.reconnect ? "GRAPH_RECONNECT_REQUIRED" : "GRAPH_TOKEN_REJECTED");
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) {
        recordGraphError(db, "Microsoft 365 neposkytl přístup pro Excel.");
        throw new ServiceTaskExcelGraphError("Microsoft 365 neposkytl přístup pro Excel.", "GRAPH_ACCESS_TOKEN_MISSING");
    }
    if (typeof payload.refresh_token === "string" && payload.refresh_token)
        saveRefreshToken(db, payload.refresh_token);
    clearGraphError(db);
    return accessToken;
}
export async function pollServiceTaskExcelGraphConnection(db) {
    const flow = deviceFlows.get(db);
    if (!flow)
        return getServiceTaskExcelGraphStatus(db);
    if (flow.expiresAtMs <= Date.now()) {
        deviceFlows.delete(db);
        recordGraphError(db, "Přihlašovací kód Microsoft 365 vypršel.");
        return getServiceTaskExcelGraphStatus(db);
    }
    if (flow.nextPollAtMs > Date.now())
        return getServiceTaskExcelGraphStatus(db);
    flow.nextPollAtMs = Date.now() + flow.intervalMs;
    let response;
    try {
        response = await fetch(tokenEndpoint("token"), {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({
                client_id: config.serviceTasksExcelGraphClientId,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                device_code: flow.deviceCode,
            }),
            signal: AbortSignal.timeout(15_000),
        });
    }
    catch {
        recordGraphError(db, "Microsoft 365 právě neodpovídá.");
        return getServiceTaskExcelGraphStatus(db);
    }
    const payload = await responseObject(response);
    if (!response.ok) {
        const code = typeof payload.error === "string" ? payload.error : "";
        if (code === "authorization_pending")
            return getServiceTaskExcelGraphStatus(db);
        if (code === "slow_down") {
            flow.intervalMs = Math.min(30_000, flow.intervalMs + 5_000);
            flow.nextPollAtMs = Date.now() + flow.intervalMs;
            return getServiceTaskExcelGraphStatus(db);
        }
        const failure = tokenFailure(code);
        deviceFlows.delete(db);
        recordGraphError(db, failure.message, failure.reconnect);
        return getServiceTaskExcelGraphStatus(db);
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
    if (!accessToken || !refreshToken) {
        deviceFlows.delete(db);
        recordGraphError(db, "Microsoft 365 neposkytl trvalé oprávnění pro hodinovou synchronizaci.");
        return getServiceTaskExcelGraphStatus(db);
    }
    saveRefreshToken(db, refreshToken);
    clearWorkbookLocation(db);
    try {
        await resolveWorkbookLocation(db, accessToken, true);
        const now = new Date().toISOString();
        setSetting(db, SETTINGS.connectedAt, now);
        clearGraphError(db);
    }
    catch (error) {
        const message = error instanceof ServiceTaskExcelGraphError ? error.message : "Připojený účet nemůže otevřít zdrojový Excel.";
        recordGraphError(db, message);
    }
    finally {
        deviceFlows.delete(db);
    }
    return getServiceTaskExcelGraphStatus(db);
}
export function disconnectServiceTaskExcelGraph(db) {
    deviceFlows.delete(db);
    setSetting(db, SETTINGS.refreshToken, "");
    setSetting(db, SETTINGS.connectedAt, "");
    clearGraphError(db);
    clearWorkbookLocation(db);
    return getServiceTaskExcelGraphStatus(db);
}
export function encodeGraphSharingUrl(value) {
    return `u!${Buffer.from(value, "utf8").toString("base64url")}`;
}
function shareUrlCandidates() {
    const source = config.serviceTasksExcelShareUrl;
    if (!source)
        return [];
    const result = [source];
    const canonical = new URL(source);
    canonical.searchParams.delete("download");
    canonical.searchParams.delete("web");
    if (!result.includes(canonical.toString()))
        result.push(canonical.toString());
    const browser = new URL(canonical);
    browser.searchParams.set("web", "1");
    if (!result.includes(browser.toString()))
        result.push(browser.toString());
    return result;
}
function shareFingerprint() {
    return createHash("sha256").update(config.serviceTasksExcelShareUrl, "utf8").digest("hex");
}
async function graphFetch(path, accessToken, init = {}) {
    return fetch(`${GRAPH_ROOT}${path}`, {
        ...init,
        headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(20_000),
    });
}
function graphRequestError(status) {
    if (status === 401)
        return new ServiceTaskExcelGraphError("Microsoft 365 vyžaduje nové připojení účtu.", "GRAPH_RECONNECT_REQUIRED");
    if (status === 403)
        return new ServiceTaskExcelGraphError("Připojený účet nemá oprávnění k načtení tohoto Excelu.", "GRAPH_PERMISSION_DENIED");
    if (status === 404)
        return new ServiceTaskExcelGraphError("Zdrojový Excel nebyl přes Microsoft Graph nalezen.", "GRAPH_WORKBOOK_NOT_FOUND");
    if (status === 409 || status === 423)
        return new ServiceTaskExcelGraphError("Excel je právě zamčený jinou operací.", "GRAPH_WORKBOOK_LOCKED");
    if (status === 429)
        return new ServiceTaskExcelGraphError("Microsoft Graph dočasně omezil počet požadavků.", "GRAPH_THROTTLED");
    return new ServiceTaskExcelGraphError("Microsoft Graph právě nedokáže zpracovat Excel.", "GRAPH_REQUEST_FAILED");
}
async function resolveWorkbookLocation(db, accessToken, force = false) {
    const fingerprint = shareFingerprint();
    const cached = {
        driveId: setting(db, SETTINGS.driveId),
        itemId: setting(db, SETTINGS.itemId),
    };
    if (!force && cached.driveId && cached.itemId && setting(db, SETTINGS.shareFingerprint) === fingerprint)
        return cached;
    let lastError = null;
    for (const shareUrl of shareUrlCandidates()) {
        const response = await graphFetch(`/shares/${encodeGraphSharingUrl(shareUrl)}/driveItem?$select=id,name,parentReference,file`, accessToken, { headers: { Prefer: "redeemSharingLink" } });
        if (!response.ok) {
            lastError = graphRequestError(response.status);
            if ([400, 404].includes(response.status))
                continue;
            throw lastError;
        }
        const payload = await responseObject(response);
        const itemId = typeof payload.id === "string" ? payload.id : "";
        const driveId = typeof object(payload.parentReference).driveId === "string" ? String(object(payload.parentReference).driveId) : "";
        if (!itemId || !driveId || !payload.file) {
            lastError = new ServiceTaskExcelGraphError("Sdílený odkaz nevede na soubor Excel.", "GRAPH_DRIVE_ITEM_INVALID");
            continue;
        }
        setSetting(db, SETTINGS.driveId, driveId);
        setSetting(db, SETTINGS.itemId, itemId);
        setSetting(db, SETTINGS.shareFingerprint, fingerprint);
        return { driveId, itemId };
    }
    throw lastError ?? new ServiceTaskExcelGraphError("Zdrojový Excel nebyl přes Microsoft Graph nalezen.", "GRAPH_WORKBOOK_NOT_FOUND");
}
async function withWorkbookLocation(db, accessToken, operation) {
    const location = await resolveWorkbookLocation(db, accessToken);
    try {
        return await operation(location);
    }
    catch (error) {
        if (!(error instanceof ServiceTaskExcelGraphError) || error.code !== "GRAPH_WORKBOOK_NOT_FOUND")
            throw error;
        clearWorkbookLocation(db);
        return operation(await resolveWorkbookLocation(db, accessToken, true));
    }
}
async function downloadWorkbook(location, accessToken) {
    const response = await graphFetch(`/drives/${encodeURIComponent(location.driveId)}/items/${encodeURIComponent(location.itemId)}/content`, accessToken, { redirect: "manual", headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    let contentResponse = response;
    if (response.status >= 300 && response.status < 400) {
        const locationHeader = response.headers.get("location") ?? "";
        let downloadUrl;
        try {
            downloadUrl = new URL(locationHeader);
        }
        catch {
            throw new ServiceTaskExcelGraphError("Microsoft Graph neposkytl bezpečnou adresu ke stažení Excelu.", "GRAPH_DOWNLOAD_REDIRECT_INVALID");
        }
        if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) {
            throw new ServiceTaskExcelGraphError("Microsoft Graph neposkytl bezpečnou adresu ke stažení Excelu.", "GRAPH_DOWNLOAD_REDIRECT_INVALID");
        }
        contentResponse = await fetch(downloadUrl, {
            redirect: "follow",
            headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            signal: AbortSignal.timeout(30_000),
        });
    }
    if (!contentResponse.ok)
        throw graphRequestError(contentResponse.status);
    const declaredSize = Number(contentResponse.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_WORKBOOK_BYTES) {
        throw new ServiceTaskExcelGraphError("Zdrojový Excel překračuje bezpečný limit 25 MB.", "GRAPH_WORKBOOK_TOO_LARGE");
    }
    const workbook = Buffer.from(await contentResponse.arrayBuffer());
    if (workbook.length > MAX_WORKBOOK_BYTES) {
        throw new ServiceTaskExcelGraphError("Zdrojový Excel překračuje bezpečný limit 25 MB.", "GRAPH_WORKBOOK_TOO_LARGE");
    }
    return workbook;
}
function worksheetRangePath(location, sheetName, address) {
    return `/drives/${encodeURIComponent(location.driveId)}/items/${encodeURIComponent(location.itemId)}`
        + `/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')`;
}
function rangeValue(payload, column = 0, property = "values") {
    const rows = Array.isArray(payload[property]) ? payload[property] : [];
    const firstRow = Array.isArray(rows[0]) ? rows[0] : [];
    const value = firstRow[column];
    return value === null || value === undefined ? "" : String(value);
}
async function readCompletionCell(location, accessToken, row) {
    const response = await graphFetch(`${worksheetRangePath(location, row.sheet_name, `E${row.row_number}`)}?$select=values,address`, accessToken);
    if (!response.ok)
        throw graphRequestError(response.status);
    return rangeValue(await responseObject(response));
}
function normalizedTaskIdentity(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-")
        .replace(/\s+/g, " ").trim().toLocaleLowerCase("cs");
}
function taskIdentityFingerprint(place, request) {
    const normalizedPlace = normalizedTaskIdentity(place) || normalizedTaskIdentity("Bez místa");
    return createHash("sha256").update(`${normalizedPlace}\n${normalizedTaskIdentity(request)}`, "utf8").digest("hex");
}
async function readWritebackTarget(location, accessToken, row) {
    if (!Number.isInteger(row.row_number) || row.row_number < 2 || row.row_number > 1_048_576) {
        throw new ServiceTaskExcelGraphError("Vazba úkolu ukazuje na neplatný řádek Excelu.", "WRITEBACK_ROW_INVALID");
    }
    const response = await graphFetch(`${worksheetRangePath(location, row.sheet_name, `C${row.row_number}:E${row.row_number}`)}?$select=values,formulas,address`, accessToken);
    if (!response.ok)
        throw graphRequestError(response.status);
    const payload = await responseObject(response);
    if (taskIdentityFingerprint(rangeValue(payload, 0), rangeValue(payload, 1)) !== row.source_fingerprint) {
        throw new ServiceTaskExcelGraphError("Řádek úkolu se v Excelu mezitím přesunul; zápis počká na nový import mapování.", "WRITEBACK_ROW_MOVED");
    }
    return { completion: rangeValue(payload, 2), formula: rangeValue(payload, 2, "formulas") };
}
export function serviceTaskExcelCompletionMarker(completedAt) {
    const readable = completedAt.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
    return `Hotovo · Evora Smart Hub · ${readable}`;
}
function writebackRows(db, taskId) {
    const filter = taskId ? "AND links.task_id=?" : "";
    return db.prepare(`SELECT links.task_id,links.sheet_name,links.row_number,links.source_fingerprint,tasks.completed_at
     FROM service_task_excel_links links JOIN service_tasks tasks ON tasks.id=links.task_id
     WHERE links.local_status_dirty=1 AND tasks.status='done' ${filter}
     ORDER BY tasks.completed_at,links.row_number LIMIT 100`).all(...(taskId ? [taskId] : []));
}
function writebackStateForError(error) {
    return [
        "GRAPH_NOT_CONFIGURED", "GRAPH_AUTH_REQUIRED", "GRAPH_RECONNECT_REQUIRED", "GRAPH_PERMISSION_DENIED",
        "WRITEBACK_CELL_TOO_LONG", "WRITEBACK_COMPLETION_TIME_MISSING", "WRITEBACK_FORMULA_CELL", "WRITEBACK_ROW_INVALID",
    ]
        .includes(error.code) ? "blocked" : "pending";
}
function recordWritebackFailure(db, rows, error) {
    const update = db.prepare("UPDATE service_task_excel_links SET writeback_state=?,writeback_error=? WHERE task_id=? AND local_status_dirty=1");
    for (const row of rows)
        update.run(writebackStateForError(error), error.message, row.task_id);
}
async function writebackOne(db, location, accessToken, row) {
    if (!row.completed_at) {
        throw new ServiceTaskExcelGraphError("Dokončený úkol nemá uložený čas dokončení.", "WRITEBACK_COMPLETION_TIME_MISSING");
    }
    const marker = serviceTaskExcelCompletionMarker(row.completed_at);
    const target = await readWritebackTarget(location, accessToken, row);
    if (target.formula.trimStart().startsWith("=")) {
        throw new ServiceTaskExcelGraphError("Cílová buňka Excelu obsahuje vzorec a Hub ji bezpečně nepřepíše.", "WRITEBACK_FORMULA_CELL");
    }
    const current = target.completion;
    if (!current.includes(marker)) {
        const next = current.trim() ? `${current}${current.endsWith("\n") || current.endsWith("\r") ? "" : "\n"}${marker}` : marker;
        if (next.length > MAX_CELL_TEXT) {
            throw new ServiceTaskExcelGraphError("Cílová buňka Excelu je příliš dlouhá pro bezpečné přidání dokončení.", "WRITEBACK_CELL_TOO_LONG");
        }
        const response = await graphFetch(worksheetRangePath(location, row.sheet_name, `E${row.row_number}`), accessToken, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ values: [[next]] }),
        });
        if (!response.ok)
            throw graphRequestError(response.status);
    }
    const readBack = await readCompletionCell(location, accessToken, row);
    if (!readBack.includes(marker)) {
        throw new ServiceTaskExcelGraphError("Microsoft Graph zápis nepotvrdil shodným read-backem buňky.", "WRITEBACK_READBACK_MISMATCH");
    }
    const verifiedAt = new Date().toISOString();
    db.prepare(`UPDATE service_task_excel_links SET local_status_dirty=0,writeback_state='synced',writeback_error=NULL,last_writeback_at=?
     WHERE task_id=?`).run(verifiedAt, row.task_id);
    setSetting(db, SETTINGS.writebackVerifiedAt, verifiedAt);
    setSetting(db, SETTINGS.writebackVerifiedShareFingerprint, shareFingerprint());
}
async function flushWritebacks(db, location, accessToken, taskId) {
    const rows = writebackRows(db, taskId);
    for (const row of rows) {
        try {
            await writebackOne(db, location, accessToken, row);
        }
        catch (error) {
            const known = error instanceof ServiceTaskExcelGraphError
                ? error : new ServiceTaskExcelGraphError("Zápis dokončení do Excelu se nezdařil.", "WRITEBACK_FAILED");
            recordWritebackFailure(db, [row], known);
            if (known.code === "GRAPH_WORKBOOK_NOT_FOUND")
                throw known;
        }
    }
}
async function withGraphQueue(db, operation) {
    const previous = graphQueues.get(db) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    graphQueues.set(db, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    }
    finally {
        release();
        if (graphQueues.get(db) === tail)
            graphQueues.delete(db);
    }
}
export async function downloadServiceTaskWorkbookViaGraph(db) {
    try {
        return await withGraphQueue(db, async () => {
            if (!serviceTaskExcelGraphReady(db)) {
                throw new ServiceTaskExcelGraphError("Microsoft 365 není připravený pro automatickou synchronizaci.", "GRAPH_AUTH_REQUIRED");
            }
            const accessToken = await accessTokenFromRefresh(db);
            return withWorkbookLocation(db, accessToken, (location) => downloadWorkbook(location, accessToken));
        });
    }
    catch (error) {
        const known = error instanceof ServiceTaskExcelGraphError
            ? error : new ServiceTaskExcelGraphError("Microsoft Graph nedokázal načíst zdrojový Excel.", "GRAPH_SYNC_FAILED");
        recordGraphError(db, known.message, known.code === "GRAPH_RECONNECT_REQUIRED");
        throw known;
    }
}
async function syncServiceTaskExcelWritebacks(db, taskId) {
    const rows = writebackRows(db, taskId);
    if (!rows.length)
        return;
    try {
        await withGraphQueue(db, async () => {
            if (!serviceTaskExcelGraphReady(db)) {
                throw new ServiceTaskExcelGraphError("Dokončení čeká na připojení Microsoft 365 s právem zápisu.", "GRAPH_AUTH_REQUIRED");
            }
            const accessToken = await accessTokenFromRefresh(db);
            await withWorkbookLocation(db, accessToken, (location) => flushWritebacks(db, location, accessToken, taskId));
        });
    }
    catch (error) {
        const known = error instanceof ServiceTaskExcelGraphError
            ? error : new ServiceTaskExcelGraphError("Zápis dokončení do Excelu se nezdařil.", "WRITEBACK_FAILED");
        if (["GRAPH_RECONNECT_REQUIRED", "GRAPH_PERMISSION_DENIED"].includes(known.code)) {
            recordGraphError(db, known.message, known.code === "GRAPH_RECONNECT_REQUIRED");
        }
        recordWritebackFailure(db, rows, known);
    }
}
export async function syncServiceTaskExcelWriteback(db, taskId) {
    return syncServiceTaskExcelWritebacks(db, taskId);
}
export async function syncPendingServiceTaskExcelWritebacks(db) {
    return syncServiceTaskExcelWritebacks(db);
}
