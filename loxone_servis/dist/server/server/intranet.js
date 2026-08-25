import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getSetting, setSetting } from "./database.js";
const INTRANET_BASE_URL = "https://intranet.evora.cz";
const SUPABASE_URL = "https://wknmzrjafskktgmkifux.supabase.co";
const SUPABASE_KEY = "sb_publishable_G7YKpiRaxEgGvuDxW6eemg_IG30Bw2F";
const COOKIE_NAME = "sb-wknmzrjafskktgmkifux-auth-token";
const PRAGUE_TIME_ZONE = "Europe/Prague";
const STATUS_MAX_AGE_MS = 30_000;
const SUMMARY_MAX_AGE_MS = 10 * 60_000;
const ROSTER_MAX_AGE_MS = 5 * 60_000;
const CONTACTS_MAX_AGE_MS = 10 * 60_000;
const LEAVES_MAX_AGE_MS = 10 * 60_000;
const HISTORY_MAX_AGE_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 18_000;
const SETTINGS = {
    email: ["intranet_email", "evora-intranet-email-v1"],
    password: ["intranet_password", "evora-intranet-password-v1"],
    refreshToken: ["intranet_refresh_token", "evora-intranet-refresh-v1"],
    snapshot: ["intranet_snapshot", "evora-intranet-snapshot-v1"],
};
export class IntranetError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const runtimes = new WeakMap();
function runtime(db) {
    let value = runtimes.get(db);
    if (!value) {
        value = { accessToken: "", refreshToken: "", cookieHeader: "", expiresAt: 0, refreshInFlight: null };
        runtimes.set(db, value);
    }
    return value;
}
function ensureEncryption() {
    if (config.masterKey.length !== 32) {
        throw new IntranetError("internal_error", "Evora Intranet lze připojit jen na hlavní instanci s aktivním šifrováním.");
    }
}
function readEncrypted(db, setting) {
    const encoded = getSetting(db, setting[0]);
    if (!encoded)
        return null;
    try {
        ensureEncryption();
        return decryptSecret(encoded, config.masterKey, setting[1]);
    }
    catch {
        return null;
    }
}
function writeEncrypted(db, setting, value) {
    if (!value) {
        setSetting(db, setting[0], "");
        return;
    }
    ensureEncryption();
    setSetting(db, setting[0], encryptSecret(value, config.masterKey, setting[1]));
}
function monthKey(date = new Date(), offset = 0) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: PRAGUE_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
    }).formatToParts(date);
    const year = Number(parts.find((part) => part.type === "year")?.value ?? date.getUTCFullYear());
    const month = Number(parts.find((part) => part.type === "month")?.value ?? date.getUTCMonth() + 1);
    const absolute = year * 12 + month - 1 + offset;
    const targetYear = Math.floor(absolute / 12);
    const targetMonth = absolute % 12 + 1;
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
}
function pragueDateKey(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: PRAGUE_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}
function emptySnapshot(configured = false, email = null) {
    return {
        configured,
        email,
        dataState: configured ? "loading" : "not_configured",
        fetchedAt: null,
        summaryFetchedAt: null,
        rosterFetchedAt: null,
        contactsFetchedAt: null,
        leavesFetchedAt: null,
        historyFetchedAt: null,
        currentState: "none",
        currentSince: null,
        todayWorkedSeconds: 0,
        lastArrival: null,
        lastDeparture: null,
        greeting: "",
        workloadHours: 0,
        cards: {},
        people: [],
        leaves: [],
        notificationsUnread: 0,
        history: {
            currentMonth: monthKey(),
            previousMonth: monthKey(new Date(), -1),
            current: [],
            previous: [],
        },
        availableActions: [],
        errorCode: null,
        errorMessage: null,
    };
}
function loadSnapshot(db) {
    const email = readEncrypted(db, SETTINGS.email);
    const password = readEncrypted(db, SETTINGS.password);
    const configured = Boolean(email && password);
    const encoded = readEncrypted(db, SETTINGS.snapshot);
    if (!encoded)
        return emptySnapshot(configured, email);
    try {
        const parsed = JSON.parse(encoded);
        const snapshot = { ...emptySnapshot(configured, email), ...parsed, configured, email };
        snapshot.people = snapshot.people.map((person) => ({ ...person, phone: person.phone ?? null }));
        const age = snapshot.fetchedAt ? Date.now() - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
        if (configured && snapshot.dataState === "current" && age > 150_000)
            snapshot.dataState = "stale";
        return snapshot;
    }
    catch {
        return emptySnapshot(configured, email);
    }
}
/**
 * Returns only the last persisted Intranet state.
 *
 * Lightweight consumers such as native menu snapshots must never turn a menu
 * open into a synchronous Intranet refresh. The regular Intranet route and
 * background job remain responsible for refreshing stale data.
 */
export function getCachedIntranetSnapshot(db) {
    return loadSnapshot(db);
}
function persistSnapshot(db, snapshot) {
    writeEncrypted(db, SETTINGS.snapshot, JSON.stringify(snapshot));
}
function base64Url(value) {
    return Buffer.from(value, "utf8").toString("base64url");
}
function cookieHeader(payload) {
    const value = `base64-${base64Url(JSON.stringify(payload))}`;
    if (value.length <= 3_180)
        return `${COOKIE_NAME}=${value}`;
    const parts = [];
    for (let offset = 0, index = 0; offset < value.length; offset += 3_180, index += 1) {
        parts.push(`${COOKIE_NAME}.${index}=${value.slice(offset, offset + 3_180)}`);
    }
    return parts.join("; ");
}
function sessionPayload(value) {
    if (!value || typeof value !== "object" || !("access_token" in value) || typeof value.access_token !== "string" || !value.access_token) {
        throw new IntranetError("internal_error", "Přihlášení neobsahuje platnou přístupovou relaci.");
    }
    return value;
}
function applySession(db, payload, persistRefresh = true) {
    const target = runtime(db);
    target.accessToken = payload.access_token;
    if (typeof payload.refresh_token === "string" && payload.refresh_token)
        target.refreshToken = payload.refresh_token;
    target.expiresAt = typeof payload.expires_at === "number"
        ? payload.expires_at * 1_000
        : Date.now() + (typeof payload.expires_in === "number" ? payload.expires_in : 3_600) * 1_000;
    target.cookieHeader = cookieHeader(payload);
    if (persistRefresh && target.refreshToken)
        writeEncrypted(db, SETTINGS.refreshToken, target.refreshToken);
}
async function fetchWithTimeout(url, init) {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    }
    catch {
        throw new IntranetError("unavailable", "Evora Intranet právě neodpovídá.");
    }
}
async function passwordGrant(db, email, password, persistRefresh = true) {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if ([400, 401, 403].includes(response.status)) {
        throw new IntranetError("auth_rejected", "Evora Intranet odmítl e-mail nebo heslo.");
    }
    if (!response.ok)
        throw new IntranetError("unavailable", "Přihlášení k Evora Intranetu se nezdařilo.");
    applySession(db, sessionPayload(await response.json()), persistRefresh);
}
async function refreshGrant(db, token) {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }),
    });
    if ([400, 401, 403].includes(response.status)) {
        runtime(db).refreshToken = "";
        writeEncrypted(db, SETTINGS.refreshToken, "");
        throw new IntranetError("auth_rejected", "Přihlášení k Evora Intranetu už neplatí.");
    }
    if (!response.ok)
        throw new IntranetError("unavailable", "Přihlášení k Evora Intranetu se nepodařilo obnovit.");
    applySession(db, sessionPayload(await response.json()));
}
async function ensureSession(db) {
    const target = runtime(db);
    if (target.cookieHeader && target.expiresAt - Date.now() > 45_000)
        return;
    const storedRefresh = target.refreshToken || readEncrypted(db, SETTINGS.refreshToken) || "";
    if (storedRefresh) {
        try {
            await refreshGrant(db, storedRefresh);
            return;
        }
        catch (error) {
            if (!(error instanceof IntranetError) || error.code !== "auth_rejected")
                throw error;
        }
    }
    const email = readEncrypted(db, SETTINGS.email);
    const password = readEncrypted(db, SETTINGS.password);
    if (!email || !password)
        throw new IntranetError("not_configured", "Připojení k Evora Intranetu není nastavené.");
    await passwordGrant(db, email, password);
}
async function intranetRequest(db, path, init = {}, retryAuthentication = true) {
    await ensureSession(db);
    const response = await fetchWithTimeout(`${INTRANET_BASE_URL}${path}`, {
        ...init,
        redirect: "follow",
        headers: {
            Accept: "application/json, text/html",
            Cookie: runtime(db).cookieHeader,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers ?? {}),
        },
    });
    const redirectedToLogin = new URL(response.url || `${INTRANET_BASE_URL}${path}`).pathname === "/login";
    if ((response.status === 401 || redirectedToLogin) && retryAuthentication) {
        const target = runtime(db);
        target.accessToken = "";
        target.cookieHeader = "";
        target.expiresAt = 0;
        return intranetRequest(db, path, init, false);
    }
    if (response.status === 403)
        throw new IntranetError("permission_denied", "Účet nemá k této části Evora Intranetu oprávnění.");
    if (!response.ok || redirectedToLogin) {
        throw new IntranetError(redirectedToLogin ? "auth_rejected" : "not_provided", redirectedToLogin ? "Přihlášení k Evora Intranetu už neplatí." : "Evora Intranet požadovaná data neposkytl.");
    }
    return response;
}
function attendanceEvent(value) {
    if (!value || typeof value !== "object")
        return null;
    const object = value;
    if (typeof object.kind !== "string" || typeof object.ts !== "string" || Number.isNaN(Date.parse(object.ts)))
        return null;
    return {
        id: typeof object.id === "string" ? object.id : null,
        kind: object.kind,
        source: typeof object.source === "string" ? object.source : null,
        ts: object.ts,
    };
}
function attendanceResponse(value) {
    if (!value || typeof value !== "object")
        throw new IntranetError("internal_error", "Docházková data mají neplatný formát.");
    const object = value;
    if (typeof object.hrProfileId !== "string" || !Array.isArray(object.events)) {
        throw new IntranetError("internal_error", "Docházková data mají neplatný formát.");
    }
    return {
        hrProfileId: object.hrProfileId,
        greeting: typeof object.greeting === "string" ? object.greeting : "",
        uvazekH: typeof object.uvazekH === "number" ? object.uvazekH : 0,
        events: object.events.map(attendanceEvent).filter((event) => Boolean(event)),
    };
}
export function deriveIntranetAttendance(events, now = new Date()) {
    const latest = attendanceSessions(events, now).at(-1);
    if (!latest)
        return { state: "none", since: null, worked: 0, arrival: null, departure: null };
    const isOpen = latest.departure === null;
    const today = pragueDateKey(now);
    const belongsToToday = latest.date === today || (latest.endedAt ? pragueDateKey(latest.endedAt) === today : false);
    if ((!isOpen && !belongsToToday) || (isOpen && now.getTime() - latest.startedAt.getTime() > 36 * 60 * 60 * 1_000)) {
        return { state: "none", since: null, worked: 0, arrival: null, departure: null };
    }
    const worked = latest.workedMs + (latest.activeStart ? Math.max(0, now.getTime() - latest.activeStart.getTime()) : 0);
    return {
        state: latest.temporaryState ?? latest.baseState,
        since: (latest.temporarySince ?? latest.baseSince)?.toISOString() ?? null,
        worked: Math.max(0, Math.floor(worked / 1_000)),
        arrival: latest.arrival,
        departure: latest.departure,
    };
}
function attendanceSessions(events, now = new Date()) {
    const parsed = events
        .map((event) => ({ event, date: new Date(event.ts) }))
        .filter(({ date }) => !Number.isNaN(date.getTime()) && date <= now)
        .sort((left, right) => left.date.getTime() - right.date.getTime());
    const sessions = [];
    let session = null;
    const begin = (date) => ({
        date: pragueDateKey(date),
        startedAt: date,
        endedAt: null,
        events: [],
        arrival: null,
        departure: null,
        workedMs: 0,
        activeStart: null,
        baseState: "none",
        baseSince: null,
        temporaryState: null,
        temporarySince: null,
    });
    const closeStale = (date) => {
        if (!session || date.getTime() - session.startedAt.getTime() <= 36 * 60 * 60 * 1_000)
            return;
        session.activeStart = null;
        session.baseState = "away";
        session.baseSince = session.events.length ? new Date(session.events.at(-1).ts) : session.startedAt;
        sessions.push(session);
        session = null;
    };
    for (const { event, date } of parsed) {
        closeStale(date);
        const startsSession = event.kind === "arrival" || event.kind === "home_start";
        if (!session)
            session = begin(date);
        session.events.push(event);
        if (startsSession) {
            session.baseState = event.kind === "arrival" ? "in_building" : "home_office";
            session.baseSince = date;
            session.temporaryState = null;
            session.temporarySince = null;
            session.activeStart ??= date;
            session.arrival ??= event.ts;
        }
        else if (event.kind === "break_out" || event.kind === "doctor_out") {
            if (session.activeStart)
                session.workedMs += Math.max(0, date.getTime() - session.activeStart.getTime());
            session.activeStart = null;
            session.temporaryState = event.kind === "break_out" ? "on_break" : "doctor";
            session.temporarySince = date;
        }
        else if (event.kind === "offsite_out") {
            session.temporaryState = "offsite";
            session.temporarySince = date;
            session.activeStart ??= date;
        }
        else if (["break_in", "doctor_in", "offsite_in"].includes(event.kind)) {
            session.temporaryState = null;
            session.temporarySince = null;
            if (session.baseState === "none") {
                session.baseState = "in_building";
                session.baseSince = date;
            }
            session.activeStart ??= date;
        }
        else if (event.kind === "departure" || event.kind === "home_end") {
            if (session.activeStart)
                session.workedMs += Math.max(0, date.getTime() - session.activeStart.getTime());
            session.activeStart = null;
            session.temporaryState = null;
            session.temporarySince = null;
            session.baseState = "away";
            session.baseSince = date;
            session.departure = event.ts;
            session.endedAt = date;
            sessions.push(session);
            session = null;
        }
    }
    if (session)
        sessions.push(session);
    return sessions;
}
export function intranetAvailableActions(state) {
    if (state === "in_building")
        return ["departure", "break_out", "doctor_out", "offsite_out"];
    if (state === "home_office")
        return ["home_end", "break_out", "doctor_out"];
    if (state === "on_break")
        return ["break_in"];
    if (state === "doctor")
        return ["doctor_in"];
    if (state === "offsite")
        return ["offsite_in"];
    if (state === "vacation" || state === "sick")
        return [];
    return ["arrival", "home_start", "doctor_out", "offsite_out"];
}
export function nextFlightObjects(html) {
    const payload = [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)]
        .map((match) => {
        try {
            const value = JSON.parse(match[1]);
            return value[0] === 1 && typeof value[1] === "string" ? value[1] : "";
        }
        catch {
            return "";
        }
    })
        .join("");
    const objects = [];
    for (const line of payload.split("\n")) {
        const colon = line.indexOf(":");
        if (colon < 0)
            continue;
        try {
            objects.push(JSON.parse(line.slice(colon + 1)));
        }
        catch {
            // Other Next Flight records are not JSON data records.
        }
    }
    return objects;
}
function collectEvents(value, ownProfileId, output) {
    if (Array.isArray(value)) {
        for (const child of value)
            collectEvents(child, ownProfileId, output);
        return;
    }
    if (!value || typeof value !== "object")
        return;
    const object = value;
    const event = attendanceEvent(object);
    const profileId = typeof object.hr_profile_id === "string" ? object.hr_profile_id : null;
    if (event && (!profileId || !ownProfileId || profileId === ownProfileId))
        output.push(event);
    for (const child of Object.values(object))
        collectEvents(child, ownProfileId, output);
}
export function parseIntranetHistory(html, ownProfileId) {
    const events = [];
    for (const object of nextFlightObjects(html))
        collectEvents(object, ownProfileId, events);
    return mergeEvents([], events);
}
function mergeEvents(existing, incoming) {
    const allowedMonths = new Set([monthKey(), monthKey(new Date(), -1)]);
    const merged = new Map();
    for (const event of [...existing, ...incoming]) {
        const date = new Date(event.ts);
        if (Number.isNaN(date.getTime()) || !allowedMonths.has(pragueDateKey(date).slice(0, 7)))
            continue;
        merged.set(`${event.kind}|${event.ts}`, { ...event, id: null, source: null });
    }
    return [...merged.values()].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
}
export function intranetHistoryDays(events, targetMonth, now = new Date()) {
    return attendanceSessions(events, now)
        .filter((session) => session.date.startsWith(targetMonth))
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((session) => {
        const liveMs = session.activeStart ? Math.max(0, now.getTime() - session.activeStart.getTime()) : 0;
        return {
            date: session.date,
            arrival: session.arrival,
            departure: session.departure,
            workedSeconds: Math.floor((session.workedMs + liveMs) / 1_000),
            events: [...session.events],
        };
    });
}
function findDictionary(value, keys) {
    if (Array.isArray(value)) {
        for (const child of value) {
            const found = findDictionary(child, keys);
            if (found)
                return found;
        }
        return null;
    }
    if (!value || typeof value !== "object")
        return null;
    const object = value;
    if (keys.every((key) => key in object))
        return object;
    for (const child of Object.values(object)) {
        const found = findDictionary(child, keys);
        if (found)
            return found;
    }
    return null;
}
function parseRoster(html, ownProfileId, now = new Date()) {
    let root = null;
    for (const object of nextFlightObjects(html)) {
        root = findDictionary(object, ["employees", "events", "absences", "fetchedAt"]);
        if (root)
            break;
    }
    if (!root || !Array.isArray(root.employees) || !Array.isArray(root.events))
        return null;
    const eventsByPerson = new Map();
    for (const raw of root.events) {
        if (!raw || typeof raw !== "object")
            continue;
        const object = raw;
        const id = typeof object.hr_profile_id === "string" ? object.hr_profile_id : "";
        const event = attendanceEvent(object);
        if (!id || !event || now.getTime() - Date.parse(event.ts) > 86_400_000)
            continue;
        eventsByPerson.set(id, [...(eventsByPerson.get(id) ?? []), event]);
    }
    const absences = new Map();
    if (Array.isArray(root.absences)) {
        for (const raw of root.absences) {
            if (!raw || typeof raw !== "object")
                continue;
            const object = raw;
            const id = typeof object.hr_profile_id === "string" ? object.hr_profile_id : "";
            const status = typeof object.status === "string" ? object.status : "";
            const type = typeof object.type === "string" ? object.type : "";
            if (!id || !["approved", "auto_approved", "announced"].includes(status))
                continue;
            if (type === "vacation")
                absences.set(id, "vacation");
            else if (["sick", "sickday"].includes(type))
                absences.set(id, "sick");
            else if (type === "home_office")
                absences.set(id, "home_office");
        }
    }
    const active = new Set(["in_building", "home_office", "on_break", "doctor", "offsite"]);
    const personState = (id) => {
        const derived = deriveIntranetAttendance(eventsByPerson.get(id) ?? [], now);
        return { state: active.has(derived.state) ? derived.state : absences.get(id) ?? derived.state, since: derived.since };
    };
    const people = root.employees.flatMap((raw) => {
        if (!raw || typeof raw !== "object")
            return [];
        const object = raw;
        const id = typeof object.id === "string" ? object.id : "";
        const name = typeof object.name === "string" ? object.name.trim() : "";
        if (!id || !name)
            return [];
        return [{ name, ...personState(id), phone: null }];
    }).sort((left, right) => left.name.localeCompare(right.name, "cs"));
    return { people, ownState: ownProfileId ? personState(ownProfileId).state : null };
}
function normalizedPersonName(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("cs");
}
function comparablePersonName(value) {
    return normalizedPersonName(value).split(" ").filter(Boolean).sort((left, right) => left.localeCompare(right, "cs")).join(" ");
}
export function parseIntranetTeamPhones(html) {
    const phones = new Map();
    const walk = (value) => {
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (!value || typeof value !== "object")
            return;
        const object = value;
        const href = typeof object.href === "string" ? object.href : "";
        const label = typeof object["aria-label"] === "string" ? object["aria-label"] : "";
        if (href.toLowerCase().startsWith("tel:") && /^Zavolat\s+/i.test(label)) {
            const name = label.replace(/^Zavolat\s+/i, "").trim();
            const phone = decodeURIComponent(href.slice(4)).replace(/[^+0-9]/g, "");
            if (name && phone.length >= 6 && phone.length <= 20) {
                phones.set(normalizedPersonName(name), phone);
                phones.set(comparablePersonName(name), phone);
            }
        }
        Object.values(object).forEach(walk);
    };
    nextFlightObjects(html).forEach(walk);
    return phones;
}
const INTRANET_LEAVE_TYPES = new Set(["vacation", "sick", "sickday", "doctor"]);
export function parseIntranetLeaves(html) {
    let root = null;
    for (const object of nextFlightObjects(html)) {
        root = findDictionary(object, ["hrProfileId", "uvazekH", "vacDays", "leaves"]);
        if (root)
            break;
    }
    if (!root || !Array.isArray(root.leaves))
        return null;
    const leaves = root.leaves.flatMap((raw) => {
        if (!raw || typeof raw !== "object")
            return [];
        const object = raw;
        const id = typeof object.id === "string" ? object.id : "";
        const type = typeof object.type === "string" && INTRANET_LEAVE_TYPES.has(object.type)
            ? object.type
            : null;
        const dateFrom = typeof object.date_from === "string" ? object.date_from : "";
        const dateTo = typeof object.date_to === "string" ? object.date_to : "";
        const status = typeof object.status === "string" ? object.status : "";
        if (!id || !type || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || !status)
            return [];
        return [{
                id,
                type,
                dateFrom,
                dateTo,
                portion: typeof object.portion === "number" && object.portion === 0.5 ? 0.5 : 1,
                note: typeof object.note === "string" && object.note.trim() ? object.note.trim() : null,
                status,
                hours: typeof object.hours === "number" && Number.isFinite(object.hours) ? object.hours : null,
                createdAt: typeof object.created_at === "string" ? object.created_at : null,
            }];
    }).sort((left, right) => right.dateFrom.localeCompare(left.dateFrom));
    const vacationDays = typeof root.vacDays === "number" && Number.isFinite(root.vacDays) ? root.vacDays : null;
    return { leaves, vacationDays };
}
function decodeHtml(value) {
    const named = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
    return value
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] ?? `&${name};`)
        .replace(/\s+/g, " ")
        .trim();
}
export function parseIntranetSummary(html) {
    const labels = [
        ["workload", "Úvazek"],
        ["worked_month", "Odpracováno (měsíc)"],
        ["balance_month", "Saldo (měsíc)"],
        ["overtime_ordered", "Přesčas (nařízený)"],
        ["vacation_remaining", "Dovolená – zbývá"],
        ["sickday_remaining", "Sickday – zbývá"],
    ];
    const cards = {};
    for (const [key, label] of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = html.match(new RegExp(`<div[^>]*>${escaped}<\\/div>\\s*<div[^>]*>([\\s\\S]*?)<\\/div>`, "i"));
        const value = match ? decodeHtml(match[1]) : "";
        if (value)
            cards[key] = value;
    }
    const workload = Number.parseFloat((cards.workload ?? "").replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? "0");
    return { cards, workload: Number.isFinite(workload) ? workload : 0 };
}
function snapshotWithHistory(snapshot, events) {
    const currentMonth = monthKey();
    const previousMonth = monthKey(new Date(), -1);
    return {
        ...snapshot,
        history: {
            currentMonth,
            previousMonth,
            current: intranetHistoryDays(events, currentMonth),
            previous: intranetHistoryDays(events, previousMonth),
        },
    };
}
async function performRefresh(db, forceAll) {
    let snapshot = loadSnapshot(db);
    if (!snapshot.configured)
        return snapshot;
    const now = new Date();
    try {
        const response = attendanceResponse(await (await intranetRequest(db, "/api/attendance/me", { method: "POST" })).json());
        const derived = deriveIntranetAttendance(response.events, now);
        const existingEvents = [...snapshot.history.current, ...snapshot.history.previous].flatMap((day) => day.events);
        let historyEvents = mergeEvents(existingEvents, response.events);
        snapshot = {
            ...snapshot,
            configured: true,
            dataState: "current",
            fetchedAt: now.toISOString(),
            currentState: derived.state,
            currentSince: derived.since,
            todayWorkedSeconds: derived.worked,
            lastArrival: derived.arrival,
            lastDeparture: derived.departure,
            greeting: response.greeting,
            workloadHours: response.uvazekH,
            availableActions: intranetAvailableActions(derived.state),
            errorCode: null,
            errorMessage: null,
        };
        const due = (at, maxAge) => forceAll || !at || now.getTime() - Date.parse(at) > maxAge;
        if (due(snapshot.summaryFetchedAt, SUMMARY_MAX_AGE_MS)) {
            try {
                const parsed = parseIntranetSummary(await (await intranetRequest(db, "/moje")).text());
                if (Object.keys(parsed.cards).length) {
                    snapshot.cards = parsed.cards;
                    if (parsed.workload > 0)
                        snapshot.workloadHours = parsed.workload;
                    snapshot.summaryFetchedAt = now.toISOString();
                }
            }
            catch {
                // Current attendance stays usable when a secondary card is unavailable.
            }
        }
        if (due(snapshot.historyFetchedAt, HISTORY_MAX_AGE_MS)) {
            const months = [monthKey(), monthKey(new Date(), -1)];
            for (const month of months) {
                try {
                    const html = await (await intranetRequest(db, `/dochazka?month=${month}`)).text();
                    historyEvents = mergeEvents(historyEvents, parseIntranetHistory(html, response.hrProfileId));
                }
                catch {
                    // Keep the encrypted local history and refresh the other sources.
                }
            }
            snapshot.historyFetchedAt = now.toISOString();
        }
        if (due(snapshot.rosterFetchedAt, ROSTER_MAX_AGE_MS)) {
            try {
                const roster = parseRoster(await (await intranetRequest(db, "/nastenka")).text(), response.hrProfileId, now);
                if (roster) {
                    const existingPhones = new Map();
                    for (const person of snapshot.people) {
                        if (!person.phone)
                            continue;
                        existingPhones.set(normalizedPersonName(person.name), person.phone);
                        existingPhones.set(comparablePersonName(person.name), person.phone);
                    }
                    snapshot.people = roster.people.map((person) => ({
                        ...person,
                        phone: existingPhones.get(normalizedPersonName(person.name)) ?? existingPhones.get(comparablePersonName(person.name)) ?? null,
                    }));
                    snapshot.rosterFetchedAt = now.toISOString();
                    if (roster.ownState && !["in_building", "home_office", "on_break", "doctor", "offsite"].includes(snapshot.currentState)) {
                        snapshot.currentState = roster.ownState;
                        snapshot.currentSince = null;
                        snapshot.availableActions = intranetAvailableActions(roster.ownState);
                    }
                }
            }
            catch {
                // Roster is secondary to the signed-in employee status.
            }
        }
        if (due(snapshot.contactsFetchedAt, CONTACTS_MAX_AGE_MS)) {
            try {
                const phones = parseIntranetTeamPhones(await (await intranetRequest(db, "/tym")).text());
                snapshot.people = snapshot.people.map((person) => ({
                    ...person,
                    phone: phones.get(normalizedPersonName(person.name)) ?? phones.get(comparablePersonName(person.name)) ?? person.phone ?? null,
                }));
                snapshot.contactsFetchedAt = now.toISOString();
            }
            catch {
                // Contacts are an optional admin convenience and must not invalidate attendance.
            }
        }
        if (due(snapshot.leavesFetchedAt, LEAVES_MAX_AGE_MS)) {
            try {
                const parsed = parseIntranetLeaves(await (await intranetRequest(db, "/dovolena")).text());
                if (parsed) {
                    snapshot.leaves = parsed.leaves;
                    snapshot.leavesFetchedAt = now.toISOString();
                    if (parsed.vacationDays !== null && !snapshot.cards.vacation_remaining) {
                        snapshot.cards.vacation_remaining = `${parsed.vacationDays.toLocaleString("cs-CZ")} dní`;
                    }
                }
            }
            catch {
                // Leave requests are secondary to the signed-in employee status.
            }
        }
        try {
            const notifications = await (await intranetRequest(db, "/api/notifications")).json();
            if (typeof notifications.unread === "number")
                snapshot.notificationsUnread = Math.max(0, Math.floor(notifications.unread));
        }
        catch {
            // A notification badge must not invalidate attendance.
        }
        snapshot = snapshotWithHistory(snapshot, historyEvents);
        persistSnapshot(db, snapshot);
        return snapshot;
    }
    catch (error) {
        const serviceError = error instanceof IntranetError
            ? error
            : new IntranetError("internal_error", "Při načítání Evora Intranetu nastala interní chyba Hubu.");
        snapshot.dataState = serviceError.code;
        snapshot.errorCode = serviceError.code;
        snapshot.errorMessage = serviceError.message;
        persistSnapshot(db, snapshot);
        return snapshot;
    }
}
export async function refreshIntranet(db, forceAll = false) {
    const target = runtime(db);
    if (target.refreshInFlight)
        return target.refreshInFlight;
    target.refreshInFlight = performRefresh(db, forceAll).finally(() => {
        target.refreshInFlight = null;
    });
    return target.refreshInFlight;
}
export async function getIntranetSnapshot(db) {
    const snapshot = loadSnapshot(db);
    if (!snapshot.configured)
        return snapshot;
    const age = snapshot.fetchedAt ? Date.now() - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
    return age > STATUS_MAX_AGE_MS ? refreshIntranet(db, false) : snapshot;
}
export async function connectIntranet(db, email, password) {
    ensureEncryption();
    const normalizedEmail = email.trim().toLowerCase();
    await passwordGrant(db, normalizedEmail, password, false);
    writeEncrypted(db, SETTINGS.email, normalizedEmail);
    writeEncrypted(db, SETTINGS.password, password);
    if (runtime(db).refreshToken)
        writeEncrypted(db, SETTINGS.refreshToken, runtime(db).refreshToken);
    persistSnapshot(db, emptySnapshot(true, normalizedEmail));
    return refreshIntranet(db, true);
}
export function disconnectIntranet(db) {
    for (const setting of Object.values(SETTINGS))
        writeEncrypted(db, setting, "");
    runtimes.delete(db);
    return emptySnapshot(false, null);
}
export async function punchIntranet(db, kind) {
    const snapshot = await getIntranetSnapshot(db);
    if (snapshot.dataState !== "current") {
        throw new IntranetError(snapshot.dataState, "Docházková data nejsou aktuální. Nejdřív je obnovte.");
    }
    if (!snapshot.availableActions.includes(kind)) {
        throw new IntranetError("not_provided", "Tato docházková akce neodpovídá aktuálnímu stavu.");
    }
    const ownResponse = attendanceResponse(await (await intranetRequest(db, "/api/attendance/me", { method: "POST" })).json());
    const body = {
        action: "save",
        hr_profile_id: ownResponse.hrProfileId,
        kind,
        ts: new Date().toISOString(),
        source: "web",
        lat: null,
        lng: null,
        gps_accuracy: null,
        location: null,
        client_ref: randomUUID().toLowerCase(),
    };
    await intranetRequest(db, "/api/attendance/events", { method: "POST", body: JSON.stringify(body) });
    return refreshIntranet(db, true);
}
export async function createIntranetLeave(db, input) {
    if (!INTRANET_LEAVE_TYPES.has(input.type) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo)) {
        throw new IntranetError("internal_error", "Žádost o volno obsahuje neplatná data.");
    }
    if (input.dateFrom > input.dateTo)
        throw new IntranetError("internal_error", "Datum konce nesmí být před začátkem volna.");
    const ownResponse = attendanceResponse(await (await intranetRequest(db, "/api/attendance/me", { method: "POST" })).json());
    await intranetRequest(db, "/api/hr/leave", {
        method: "POST",
        body: JSON.stringify({
            action: "create",
            hr_profile_id: ownResponse.hrProfileId,
            type: input.type,
            date_from: input.dateFrom,
            date_to: input.dateTo,
            portion: input.portion,
            note: input.note,
            propustky: [],
        }),
    });
    return refreshIntranet(db, true);
}
export async function cancelIntranetLeave(db, id) {
    if (!id || id.length > 128)
        throw new IntranetError("internal_error", "Žádost o volno má neplatný identifikátor.");
    await intranetRequest(db, "/api/hr/leave", {
        method: "POST",
        body: JSON.stringify({ action: "cancel", id }),
    });
    return refreshIntranet(db, true);
}
