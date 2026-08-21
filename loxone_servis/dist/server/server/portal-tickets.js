import { createHash } from "node:crypto";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting } from "./database.js";
const TOKEN_URL = "https://sso.loxone.com/realms/loxone/protocol/openid-connect/token";
const PORTAL_ORIGIN = "https://portal.loxone.com";
const PASSWORD_AAD = "portal-sync:password";
const ATTACHMENT_AAD = "portal-ticket:attachment";
const DETAIL_CACHE_AAD_PREFIX = "portal-ticket:detail-cache:";
const TICKET_CACHE_SYNC_SETTING = "portal_ticket_cache_synced_at";
const SESSION_LIFETIME_MS = 30 * 60_000;
const ATTACHMENT_TOKEN_LIFETIME_MS = 15 * 60_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PORTAL_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
const sessions = new WeakMap();
const pendingSessions = new WeakMap();
const pendingTicketRefreshes = new WeakMap();
function ensurePortalTicketCache(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS portal_ticket_cache (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL DEFAULT '',
      thread_count INTEGER NOT NULL DEFAULT 0,
      contact_name TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      detail_encrypted TEXT,
      detail_fingerprint TEXT,
      detail_cached_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portal_ticket_cache_order
      ON portal_ticket_cache(sort_order,id);
  `);
}
function form(values) {
    const body = new FormData();
    for (const [key, value] of Object.entries(values))
        body.set(key, value);
    return body;
}
async function fetchWithTimeout(url, init, timeoutMs = 30_000) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
}
function cookieHeader(response) {
    const headers = response.headers;
    const setCookies = headers.getSetCookie?.()
        ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
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
function portalHeaders(cookie, referer = `${PORTAL_ORIGIN}/`) {
    return {
        accept: "application/json, text/plain, */*",
        origin: PORTAL_ORIGIN,
        referer,
        "user-agent": PORTAL_USER_AGENT,
        cookie,
    };
}
function portalError(message, code) {
    return Object.assign(new Error(message), { code });
}
async function establishSession(db) {
    const current = sessions.get(db);
    if (current && current.expiresAt > Date.now())
        return current;
    const pending = pendingSessions.get(db);
    if (pending)
        return pending;
    const created = (async () => {
        const email = getSetting(db, "portal_sync_email")?.trim() ?? "";
        const encryptedPassword = getSetting(db, "portal_sync_password") ?? "";
        if (!email || !encryptedPassword) {
            throw portalError("Nejdřív v Nastavení připojte Loxone Partner Portal a aktivujte automatické přihlášení.", "PORTAL_RECONNECT_REQUIRED");
        }
        let password = "";
        try {
            password = decryptSecret(encryptedPassword, config.masterKey, PASSWORD_AAD);
        }
        catch {
            throw portalError("Uložené přihlášení Loxone Portálu nelze bezpečně přečíst.", "PORTAL_RECONNECT_REQUIRED");
        }
        try {
            const tokenResponse = await fetchWithTimeout(TOKEN_URL, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: "portal",
                    grant_type: "password",
                    scope: "openid",
                    username: email,
                    password,
                }),
            });
            const tokenPayload = await tokenResponse.json().catch(() => ({}));
            if (!tokenResponse.ok || !tokenPayload.access_token) {
                throw portalError("Loxone Portál odmítl automatické přihlášení.", "PORTAL_RECONNECT_REQUIRED");
            }
            const home = await fetchWithTimeout(`${PORTAL_ORIGIN}/`, {
                method: "GET",
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "user-agent": PORTAL_USER_AGENT,
                },
            });
            if (!home.ok)
                throw portalError("Loxone Partner Portal není dostupný.", "PORTAL_UNAVAILABLE");
            let cookie = cookieHeader(home);
            const sessionResponse = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/setUserSessionCookie`, {
                method: "POST",
                headers: portalHeaders(cookie),
                body: form({ token: tokenPayload.access_token }),
            });
            cookie = mergeCookies(cookie, cookieHeader(sessionResponse));
            if (!sessionResponse.ok || !cookie) {
                throw portalError("Loxone Portál nevytvořil bezpečnou relaci.", "PORTAL_SESSION_FAILED");
            }
            const partnerResponse = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/getPartnerData`, {
                method: "POST",
                headers: portalHeaders(cookie),
            });
            const partnerPayload = await partnerResponse.json().catch(() => ({}));
            if (!partnerResponse.ok || partnerPayload.valid !== true) {
                throw portalError("Relaci Loxone Portálu se nepodařilo ověřit.", "PORTAL_SESSION_FAILED");
            }
            const result = { cookie, expiresAt: Date.now() + SESSION_LIFETIME_MS };
            sessions.set(db, result);
            return result;
        }
        finally {
            password = "";
        }
    })();
    pendingSessions.set(db, created);
    try {
        return await created;
    }
    finally {
        pendingSessions.delete(db);
    }
}
async function postPortalJson(db, endpoint, fields = {}, options = {}) {
    const perform = async () => {
        const session = await establishSession(db);
        const response = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/${endpoint}`, {
            method: "POST",
            headers: portalHeaders(session.cookie, options.referer),
            ...(Object.keys(fields).length ? { body: form(fields) } : {}),
        });
        const payload = await response.json().catch(() => null);
        return { response, payload };
    };
    let result = await perform();
    if (!options.mutation && [301, 302, 303, 307, 308, 401, 403].includes(result.response.status)) {
        sessions.delete(db);
        result = await perform();
    }
    if (!result.response.ok) {
        if ([301, 302, 303, 307, 308, 401, 403].includes(result.response.status))
            sessions.delete(db);
        throw portalError("Loxone Portál požadavek odmítl.", "PORTAL_REQUEST_FAILED");
    }
    if (result.payload
        && typeof result.payload === "object"
        && !Array.isArray(result.payload)
        && result.payload.valid === false) {
        throw portalError("Loxone Portál operaci nepotvrdil.", "PORTAL_RESPONSE_INVALID");
    }
    return result.payload;
}
function portalString(value, maxLength = 20_000) {
    if (typeof value !== "string" && typeof value !== "number")
        return "";
    return String(value).trim().slice(0, maxLength);
}
function portalObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function decodeHtmlEntities(value) {
    const named = {
        amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity.startsWith("#x")) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith("#")) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return named[entity.toLowerCase()] ?? match;
    });
}
export function portalTicketPlainText(value) {
    const html = portalString(value, 120_000)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "• ")
        .replace(/<[^>]+>/g, "");
    return decodeHtmlEntities(html)
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 100_000);
}
function cachedAttachmentFromPortal(value) {
    const item = portalObject(value);
    const href = portalString(item.href, 8_000);
    const name = portalString(item.name, 240) || "priloha";
    const safeHref = href && allowedAttachmentUrl(href) ? href : "";
    if (!name && !safeHref)
        return null;
    return {
        id: portalString(item.id, 120) || createHash("sha256").update(`${name}\n${safeHref}`).digest("hex").slice(0, 24),
        name,
        href: safeHref,
    };
}
function publicAttachment(item) {
    const token = item.href
        ? encryptSecret(JSON.stringify({ href: item.href, name: item.name, expiresAt: Date.now() + ATTACHMENT_TOKEN_LIFETIME_MS }), config.masterKey, ATTACHMENT_AAD)
        : "";
    return { id: item.id || token.slice(-24), name: item.name, token, downloadable: Boolean(item.href) };
}
function attachmentsFromContent(value) {
    const html = portalString(value, 120_000);
    const result = [];
    const seen = new Set();
    const linkPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(linkPattern)) {
        const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
        if (!href || !allowedAttachmentUrl(href))
            continue;
        let name = portalTicketPlainText(match[4] ?? "").replace(/^\s*(?:download|stáhnout)\s*$/i, "");
        if (!name) {
            try {
                name = decodeURIComponent(new URL(href).pathname.split("/").filter(Boolean).pop() ?? "");
            }
            catch {
                name = "";
            }
        }
        name = name.trim().slice(0, 240) || "příloha";
        const key = `${name}\n${href}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push({ id: createHash("sha256").update(key).digest("hex").slice(0, 24), name, href });
    }
    const plainText = portalTicketPlainText(html);
    const filePattern = /^([^\r\n]{1,220}\.(?:jpe?g|png|gif|webp|heic|heif|pdf|zip|7z|rar|txt|log|csv|xlsx?|docx?))\s*-\s*\(\s*(?:size|velikost)\s*:/gimu;
    for (const match of plainText.matchAll(filePattern)) {
        const name = (match[1] ?? "").trim().slice(0, 240);
        if (!name || result.some((item) => item.name.toLocaleLowerCase("cs") === name.toLocaleLowerCase("cs")))
            continue;
        result.push({ id: createHash("sha256").update(name).digest("hex").slice(0, 24), name, href: "" });
    }
    return result;
}
function mergeCachedAttachments(...groups) {
    const merged = new Map();
    for (const item of groups.flat()) {
        const key = item.name.toLocaleLowerCase("cs");
        const previous = merged.get(key);
        if (!previous || (!previous.href && item.href))
            merged.set(key, item);
    }
    return [...merged.values()];
}
function cachedThreadFromPortal(value) {
    const item = portalObject(value);
    const visibility = portalString(item.visibility, 30);
    const status = portalString(item.status, 30);
    const type = portalString(item.type, 30);
    if (visibility && visibility !== "public")
        return null;
    if (type && type !== "thread")
        return null;
    if (status && !["SUCCESS", "PENDING"].includes(status))
        return null;
    const author = portalObject(item.author);
    const listedAttachments = Array.isArray(item.attachments)
        ? item.attachments.map(cachedAttachmentFromPortal).filter((entry) => Boolean(entry))
        : [];
    const attachments = mergeCachedAttachments(listedAttachments, attachmentsFromContent(item.content));
    return {
        id: portalString(item.id, 120),
        createdTime: portalString(item.createdTime ?? item.created_time, 80),
        content: portalTicketPlainText(item.content),
        author: {
            type: portalString(author.type, 40),
            firstName: portalString(author.firstName ?? author.firstname, 120),
            lastName: portalString(author.lastName ?? author.lastname, 120),
            isLoxone: portalString(author.type, 40).toUpperCase() === "AGENT" && Boolean(author.id),
        },
        attachments,
    };
}
function publicThread(item) {
    return { ...item, attachments: item.attachments.map(publicAttachment) };
}
function summaryFromPortal(value) {
    const item = portalObject(value);
    const id = portalString(item.id, 120);
    if (!id)
        return null;
    const contact = portalObject(item.contactData ?? item.contact_data);
    return {
        id,
        ticketNumber: portalString(item.ticketNumber ?? item.ticket_number, 80),
        subject: portalString(item.subject, 1_000),
        status: portalString(item.statusType ?? item.status_type, 80) || "Unknown",
        createdTime: portalString(item.createdTime ?? item.created_time, 80),
        threadCount: Number.parseInt(portalString(item.threadCount ?? item.thread_count, 20), 10) || 0,
        contactName: [portalString(contact.firstname ?? contact.firstName, 120), portalString(contact.lastname ?? contact.lastName, 120)]
            .filter(Boolean)
            .join(" "),
    };
}
function summaryFingerprint(ticket) {
    return createHash("sha256").update(JSON.stringify(ticket)).digest("hex");
}
function summaryFromCacheRow(row) {
    return {
        id: row.id,
        ticketNumber: row.ticket_number,
        subject: row.subject,
        status: row.status,
        createdTime: row.created_time,
        threadCount: Number(row.thread_count),
        contactName: row.contact_name,
    };
}
function cachedPortalTicketRows(db) {
    ensurePortalTicketCache(db);
    return db.prepare(`SELECT id,ticket_number,subject,status,created_time,thread_count,contact_name,
            fingerprint,sort_order,detail_encrypted,detail_fingerprint
     FROM portal_ticket_cache ORDER BY sort_order,id`).all();
}
function cachedPortalTicketSummary(db, ticketId) {
    ensurePortalTicketCache(db);
    const row = db.prepare(`SELECT id,ticket_number,subject,status,created_time,thread_count,contact_name,
            fingerprint,sort_order,detail_encrypted,detail_fingerprint
     FROM portal_ticket_cache WHERE id=?`).get(ticketId);
    return row ? summaryFromCacheRow(row) : null;
}
async function refreshPortalTicketCache(db) {
    const existingRefresh = pendingTicketRefreshes.get(db);
    if (existingRefresh)
        return existingRefresh;
    const refresh = (async () => {
        const payload = await postPortalJson(db, "getTickets", {}, { referer: `${PORTAL_ORIGIN}/tickets/` });
        if (!Array.isArray(payload))
            throw portalError("Loxone Portál vrátil neznámý formát seznamu ticketů.", "PORTAL_FORMAT_CHANGED");
        const unique = new Map();
        for (const ticket of payload.map(summaryFromPortal))
            if (ticket)
                unique.set(ticket.id, ticket);
        const tickets = [...unique.values()];
        ensurePortalTicketCache(db);
        const existing = new Map(cachedPortalTicketRows(db).map((row) => [row.id, row]));
        const now = new Date().toISOString();
        const unchanged = db.prepare(`UPDATE portal_ticket_cache SET ticket_number=?,subject=?,status=?,created_time=?,thread_count=?,
       contact_name=?,sort_order=?,synced_at=? WHERE id=?`);
        const changed = db.prepare(`INSERT INTO portal_ticket_cache(
         id,ticket_number,subject,status,created_time,thread_count,contact_name,fingerprint,sort_order,synced_at,
         detail_encrypted,detail_fingerprint,detail_cached_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)
       ON CONFLICT(id) DO UPDATE SET
         ticket_number=excluded.ticket_number,subject=excluded.subject,status=excluded.status,
         created_time=excluded.created_time,thread_count=excluded.thread_count,contact_name=excluded.contact_name,
         fingerprint=excluded.fingerprint,sort_order=excluded.sort_order,synced_at=excluded.synced_at,
         detail_encrypted=NULL,detail_fingerprint=NULL,detail_cached_at=NULL`);
        db.exec("BEGIN IMMEDIATE");
        try {
            tickets.forEach((ticket, index) => {
                const fingerprint = summaryFingerprint(ticket);
                const previous = existing.get(ticket.id);
                if (previous?.fingerprint === fingerprint) {
                    unchanged.run(ticket.ticketNumber, ticket.subject, ticket.status, ticket.createdTime, ticket.threadCount, ticket.contactName, index, now, ticket.id);
                }
                else {
                    changed.run(ticket.id, ticket.ticketNumber, ticket.subject, ticket.status, ticket.createdTime, ticket.threadCount, ticket.contactName, fingerprint, index, now);
                }
                existing.delete(ticket.id);
            });
            const remove = db.prepare("DELETE FROM portal_ticket_cache WHERE id=?");
            for (const ticketId of existing.keys())
                remove.run(ticketId);
            setSetting(db, TICKET_CACHE_SYNC_SETTING, now);
            db.exec("COMMIT");
        }
        catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
        return cachedPortalTicketRows(db).map(summaryFromCacheRow);
    })();
    pendingTicketRefreshes.set(db, refresh);
    try {
        return await refresh;
    }
    finally {
        pendingTicketRefreshes.delete(db);
    }
}
export async function listPortalTickets(db, options = {}) {
    ensurePortalTicketCache(db);
    if (!options.refresh && getSetting(db, TICKET_CACHE_SYNC_SETTING)) {
        return cachedPortalTicketRows(db).map(summaryFromCacheRow);
    }
    return refreshPortalTicketCache(db);
}
async function rawPortalTicket(db, ticketId) {
    const payload = await postPortalJson(db, "getTicketDetail", { ticket_id: ticketId }, { referer: `${PORTAL_ORIGIN}/ticket/${encodeURIComponent(ticketId)}` });
    const item = portalObject(payload);
    if (!portalString(item.ticketNumber ?? item.ticket_number, 80)) {
        throw portalError("Detail ticketu není dostupný.", "PORTAL_TICKET_NOT_FOUND");
    }
    return item;
}
function cachedPortalTicketDetail(db, ticketId, summary) {
    ensurePortalTicketCache(db);
    const row = db.prepare("SELECT detail_encrypted,detail_fingerprint,fingerprint FROM portal_ticket_cache WHERE id=?").get(ticketId);
    if (!row?.detail_encrypted || row.detail_fingerprint !== row.fingerprint)
        return null;
    try {
        const cached = JSON.parse(decryptSecret(row.detail_encrypted, config.masterKey, `${DETAIL_CACHE_AAD_PREFIX}${ticketId}`));
        if (!Array.isArray(cached.threads) || !Array.isArray(cached.attachments))
            return null;
        return {
            ...summary,
            threads: cached.threads.map(publicThread),
            attachments: cached.attachments.map(publicAttachment),
        };
    }
    catch {
        db.prepare("UPDATE portal_ticket_cache SET detail_encrypted=NULL,detail_fingerprint=NULL,detail_cached_at=NULL WHERE id=?").run(ticketId);
        return null;
    }
}
function storePortalTicketDetail(db, summary, detail) {
    ensurePortalTicketCache(db);
    const now = new Date().toISOString();
    const fingerprint = summaryFingerprint(summary);
    const previous = db.prepare("SELECT sort_order FROM portal_ticket_cache WHERE id=?").get(summary.id);
    const encrypted = encryptSecret(JSON.stringify(detail), config.masterKey, `${DETAIL_CACHE_AAD_PREFIX}${summary.id}`);
    db.prepare(`INSERT INTO portal_ticket_cache(
       id,ticket_number,subject,status,created_time,thread_count,contact_name,fingerprint,sort_order,synced_at,
       detail_encrypted,detail_fingerprint,detail_cached_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       ticket_number=excluded.ticket_number,subject=excluded.subject,status=excluded.status,
       created_time=excluded.created_time,thread_count=excluded.thread_count,contact_name=excluded.contact_name,
       fingerprint=excluded.fingerprint,synced_at=excluded.synced_at,detail_encrypted=excluded.detail_encrypted,
       detail_fingerprint=excluded.detail_fingerprint,detail_cached_at=excluded.detail_cached_at`).run(summary.id, summary.ticketNumber, summary.subject, summary.status, summary.createdTime, summary.threadCount, summary.contactName, fingerprint, previous?.sort_order ?? 0, now, encrypted, fingerprint, now);
    return {
        ...summary,
        threads: detail.threads.map(publicThread),
        attachments: detail.attachments.map(publicAttachment),
    };
}
function invalidatePortalTicketCache(db, ticketId) {
    ensurePortalTicketCache(db);
    if (ticketId) {
        db.prepare("UPDATE portal_ticket_cache SET detail_encrypted=NULL,detail_fingerprint=NULL,detail_cached_at=NULL WHERE id=?").run(ticketId);
    }
    db.prepare("DELETE FROM settings WHERE key=?").run(TICKET_CACHE_SYNC_SETTING);
}
export async function getPortalTicket(db, ticketId, options = {}) {
    const cachedSummary = cachedPortalTicketSummary(db, ticketId);
    if (cachedSummary && !options.refresh) {
        const cached = cachedPortalTicketDetail(db, ticketId, cachedSummary);
        if (cached)
            return cached;
    }
    const item = await rawPortalTicket(db, ticketId);
    const summary = summaryFromPortal({ ...item, id: ticketId });
    if (!summary)
        throw portalError("Detail ticketu není dostupný.", "PORTAL_TICKET_NOT_FOUND");
    const threads = Array.isArray(item.threads)
        ? item.threads.map(cachedThreadFromPortal).filter((thread) => Boolean(thread))
        : [];
    const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(cachedAttachmentFromPortal).filter((entry) => Boolean(entry))
        : [];
    return storePortalTicketDetail(db, summary, { threads, attachments });
}
export async function createPortalTicket(db, input) {
    const payload = await postPortalJson(db, "createTicket", { ticket_subject: input.subject, ticket_description: input.description }, { referer: `${PORTAL_ORIGIN}/ticket/new/`, mutation: true });
    const item = portalObject(payload);
    invalidatePortalTicketCache(db);
    return {
        ok: true,
        ticketId: portalString(item.id ?? item.ticket_id, 120) || null,
        ticketNumber: portalString(item.ticketNumber ?? item.ticket_number, 80) || null,
    };
}
export async function replyPortalTicket(db, ticketId, content) {
    const ticket = await rawPortalTicket(db, ticketId);
    const number = portalString(ticket.ticketNumber ?? ticket.ticket_number, 80);
    const departmentId = portalString(ticket.departmentId ?? ticket.department_id, 120);
    if (!number || !departmentId)
        throw portalError("Ticket neobsahuje údaje potřebné pro odpověď.", "PORTAL_FORMAT_CHANGED");
    await postPortalJson(db, "submitTicketAnswer", {
        ticket_subject: `Answer: ${ticketId}`,
        ticket_description: content,
        number,
        ticket_id: ticketId,
        departmentId,
    }, { referer: `${PORTAL_ORIGIN}/ticket/${encodeURIComponent(ticketId)}`, mutation: true });
    invalidatePortalTicketCache(db, ticketId);
    return { ok: true };
}
function allowedAttachmentUrl(value) {
    const normalized = value.replace("https://desk.zoho.euhttps://desk.zoho.eu/", "https://desk.zoho.eu/");
    try {
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase();
        if (url.protocol !== "https:")
            return null;
        if (!(host === "zoho.eu" || host.endsWith(".zoho.eu") || host === "loxone.com" || host.endsWith(".loxone.com")))
            return null;
        if (url.username || url.password)
            return null;
        return url;
    }
    catch {
        return null;
    }
}
export async function downloadPortalTicketAttachment(db, token) {
    let decoded = {};
    try {
        decoded = JSON.parse(decryptSecret(token, config.masterKey, ATTACHMENT_AAD));
    }
    catch {
        throw portalError("Odkaz na přílohu není platný nebo vypršel.", "PORTAL_ATTACHMENT_INVALID");
    }
    if (typeof decoded.expiresAt !== "number" || decoded.expiresAt <= Date.now()) {
        throw portalError("Odkaz na přílohu vypršel. Otevřete detail ticketu znovu.", "PORTAL_ATTACHMENT_EXPIRED");
    }
    const url = allowedAttachmentUrl(portalString(decoded.href, 8_000));
    const fileName = portalString(decoded.name, 240).replace(/[^\p{L}\p{N} ._()-]/gu, "_") || "priloha";
    if (!url)
        throw portalError("Odkaz na přílohu není povolený.", "PORTAL_ATTACHMENT_INVALID");
    const session = await establishSession(db);
    const response = await fetchWithTimeout(`${PORTAL_ORIGIN}/api/getTicketAttachment`, {
        method: "POST",
        headers: portalHeaders(session.cookie, `${PORTAL_ORIGIN}/tickets/`),
        body: form({ url: url.toString() }),
    }, 60_000);
    if (!response.ok)
        throw portalError("Přílohu se nepodařilo stáhnout.", "PORTAL_ATTACHMENT_FAILED");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_ATTACHMENT_BYTES)
        throw portalError("Příloha je větší než povolených 25 MB.", "PORTAL_ATTACHMENT_TOO_LARGE");
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > MAX_ATTACHMENT_BYTES)
        throw portalError("Příloha je větší než povolených 25 MB.", "PORTAL_ATTACHMENT_TOO_LARGE");
    return {
        content,
        contentType: response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream",
        fileName,
    };
}
export function clearPortalTicketSession(db) {
    sessions.delete(db);
    pendingSessions.delete(db);
}
export function clearPortalTicketCache(db) {
    ensurePortalTicketCache(db);
    db.exec("DELETE FROM portal_ticket_cache");
    db.prepare("DELETE FROM settings WHERE key=?").run(TICKET_CACHE_SYNC_SETTING);
}
