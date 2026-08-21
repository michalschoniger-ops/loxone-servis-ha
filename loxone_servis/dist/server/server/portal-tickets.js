import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting } from "./database.js";
const TOKEN_URL = "https://sso.loxone.com/realms/loxone/protocol/openid-connect/token";
const PORTAL_ORIGIN = "https://portal.loxone.com";
const PASSWORD_AAD = "portal-sync:password";
const ATTACHMENT_AAD = "portal-ticket:attachment";
const SESSION_LIFETIME_MS = 30 * 60_000;
const ATTACHMENT_TOKEN_LIFETIME_MS = 15 * 60_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PORTAL_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
const sessions = new WeakMap();
const pendingSessions = new WeakMap();
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
function attachmentFromPortal(value) {
    const item = portalObject(value);
    const href = portalString(item.href, 8_000);
    const name = portalString(item.name, 240) || "priloha";
    if (!href)
        return null;
    const token = encryptSecret(JSON.stringify({ href, name, expiresAt: Date.now() + ATTACHMENT_TOKEN_LIFETIME_MS }), config.masterKey, ATTACHMENT_AAD);
    return { id: portalString(item.id, 120) || token.slice(-24), name, token };
}
function threadFromPortal(value) {
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
    const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(attachmentFromPortal).filter((entry) => Boolean(entry))
        : [];
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
export async function listPortalTickets(db) {
    const payload = await postPortalJson(db, "getTickets", {}, { referer: `${PORTAL_ORIGIN}/tickets/` });
    if (!Array.isArray(payload))
        throw portalError("Loxone Portál vrátil neznámý formát seznamu ticketů.", "PORTAL_FORMAT_CHANGED");
    return payload.map(summaryFromPortal).filter((ticket) => Boolean(ticket));
}
async function rawPortalTicket(db, ticketId) {
    const payload = await postPortalJson(db, "getTicketDetail", { ticket_id: ticketId }, { referer: `${PORTAL_ORIGIN}/ticket/${encodeURIComponent(ticketId)}` });
    const item = portalObject(payload);
    if (!portalString(item.ticketNumber ?? item.ticket_number, 80)) {
        throw portalError("Detail ticketu není dostupný.", "PORTAL_TICKET_NOT_FOUND");
    }
    return item;
}
export async function getPortalTicket(db, ticketId) {
    const item = await rawPortalTicket(db, ticketId);
    const summary = summaryFromPortal({ ...item, id: ticketId });
    if (!summary)
        throw portalError("Detail ticketu není dostupný.", "PORTAL_TICKET_NOT_FOUND");
    const threads = Array.isArray(item.threads)
        ? item.threads.map(threadFromPortal).filter((thread) => Boolean(thread))
        : [];
    const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(attachmentFromPortal).filter((entry) => Boolean(entry))
        : [];
    return { ...summary, threads, attachments };
}
export async function createPortalTicket(db, input) {
    const payload = await postPortalJson(db, "createTicket", { ticket_subject: input.subject, ticket_description: input.description }, { referer: `${PORTAL_ORIGIN}/ticket/new/`, mutation: true });
    const item = portalObject(payload);
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
