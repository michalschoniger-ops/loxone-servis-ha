import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actionPayloadHash, consumeConfirmation, createActionConfirmationWithPassword, requireRole, requireUser } from "./auth.js";
import { audit, transaction } from "./database.js";
import { config } from "./config.js";
import { encryptSecret, hashPassword } from "./crypto.js";
import { fleetOverview, getMiniserver, getStoredCredentials, listMiniservers, listProjectFolders, listReleaseArchive, saveCredentials } from "./repository.js";
import { deviceCommand, obtainJwt, readControlHistory, readDefinitionLog, readOperatingModes, readOperatingModeSchedule, readStatisticInfo, readUserAudit, sendAllowedWebservice, mutateOperatingModeSchedule, isSafeLocalMiniserverUrl, LoxoneError, } from "./loxone/client.js";
import { readCurrentProgramArchive, readExportManifest, readLegacyStatisticExport, readLoxApp3Export, readProgramBackupCatalog, readSelectedProgramBackup, readStatisticsCatalogExport, readSystemStatisticsExport, readV2StatisticExport, } from "./loxone/exports.js";
import { cleanupServiceBundles, createServiceBundle, getServiceBundle, serviceBundleStream } from "./service-bundle.js";
import { replaceProjectFolderMembers } from "./folder-members.js";
import { projectFolderDescendantIds, wouldCreateProjectFolderCycle } from "../shared/folder-hierarchy.js";
import { nextDistinctFolderColor } from "../shared/folder-colors.js";
import { clearHomeAssistantSecrets, callHomeAssistantService, getHomeAssistantCredentials, getHomeAssistantInstance, installHomeAssistantUpdate, listHomeAssistantInstances, normalizeHomeAssistantUrl, saveHomeAssistantSecrets, } from "./home-assistant.js";
import { readOneWireHistory } from "./onewire-history.js";
import { connectPortal, disconnectPortal, getPortalSyncStatus } from "./portal-sync.js";
import { clearPortalTicketCache, clearPortalTicketSession, createPortalTicket, downloadPortalTicketAttachment, getPortalTicket, listPortalTickets, replyPortalTicket, } from "./portal-tickets.js";
import { authenticateLauncherAgent, configLauncherUpdateManifest, configLauncherVersionStatus, createConfigLaunchJob, createLauncherPairing, getConfigLaunchJobForUser, heartbeatLauncherAgent, pairLauncherAgent, preferredLauncherAgent, revokeLauncherAgent, takeConfigLaunchJob, updateConfigLaunchJob, } from "./config-launcher.js";
import { activeWorkLogTokenCount, authenticateWorkLogToken, createWorkLogToken, listWorkLogTokens, revokeWorkLogToken, workLogLoxoneAppUrl, } from "./worklog-integration.js";
import { officialConfigDownloadUrl } from "./release.js";
import { getMiniserverProfile, listTags, saveMiniserverProfile } from "./miniserver-profiles.js";
import { addServiceTaskAttachment, addServiceTaskComment, createServiceTask, getServiceTask, listServiceTasks, processServiceTaskReminders, readServiceTaskAttachment, updateServiceTask, } from "./service-tasks.js";
import { getServiceTaskExcelSyncStatus, ServiceTaskExcelError, syncServiceTasksFromExcel, } from "./service-tasks-excel.js";
import { disconnectServiceTaskExcelGraph, pollServiceTaskExcelGraphConnection, ServiceTaskExcelGraphError, startServiceTaskExcelGraphConnection, } from "./service-tasks-excel-graph.js";
import { getIncident, listIncidents, recordOperationalAttempt, refreshIncidents, updateIncident } from "./incidents.js";
import { lastConnectionTest, runConnectionTest } from "./connection-test.js";
import { CameraIntegrationError, deleteCameraIntegration, getCameraOverview, getCameraSnapshot, refreshCameraIntegration, saveCameraIntegration, } from "./cameras.js";
import { cancelIntranetLeave, connectIntranet, createIntranetLeave, disconnectIntranet, getIntranetSnapshot, IntranetError, punchIntranet, refreshIntranet, } from "./intranet.js";
const serialSchema = z.string().regex(/^[A-Fa-f0-9]{12}$/).transform((value) => value.toUpperCase());
const homeAssistantIdSchema = z.string().uuid();
const configLaunchJobIdSchema = z.string().uuid();
const launcherDiagnosticCheckSchema = z.object({
    state: z.enum(["passed", "warning", "failed", "not_supported"]),
    message: z.string().trim().min(1).max(300),
}).strict();
const launcherDiagnosticsSchema = z.object({
    signature: launcherDiagnosticCheckSchema,
    uiAutomation: launcherDiagnosticCheckSchema,
    permissions: launcherDiagnosticCheckSchema,
    hubConnection: launcherDiagnosticCheckSchema,
    configDiscovery: launcherDiagnosticCheckSchema,
    safeLogging: launcherDiagnosticCheckSchema,
    automaticUpdate: launcherDiagnosticCheckSchema,
}).strict();
const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const coloredTagInputSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict();
const serviceTaskInputSchema = z.object({
    title: z.string().trim().min(3).max(240),
    description: z.string().trim().max(20_000).default(""),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    assigneeUserId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
    serial: serialSchema.nullable().default(null),
    incidentId: z.string().uuid().nullable().default(null),
    source: z.enum(["phone", "email", "in_person", "internal", "monitoring", "excel", "other"]).default("internal"),
    contactName: z.string().trim().max(160).default(""),
    contactPhone: z.string().trim().max(80).default(""),
    contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
    dueAt: nullableDateTimeSchema.default(null),
    reminderAt: nullableDateTimeSchema.default(null),
    tags: z.array(coloredTagInputSchema).max(20).default([]),
}).strict();
const intranetLeaveSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("create"),
        type: z.enum(["vacation", "sick", "sickday", "doctor"]),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        portion: z.union([z.literal(0.5), z.literal(1)]).default(1),
        note: z.string().trim().max(1_000).nullable().default(null),
    }).strict(),
    z.object({
        action: z.literal("cancel"),
        id: z.string().trim().min(1).max(128),
    }).strict(),
]);
function normalizeAppSearch(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("cs")
        .trim();
}
function appSearchMatches(query, ...values) {
    const searchable = normalizeAppSearch(values.join(" "));
    return query.split(/\s+/).every((token) => searchable.includes(token));
}
function savedViewFilters(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export function attachmentMatchesMime(data, mimeType) {
    if (mimeType === "image/jpeg")
        return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (mimeType === "image/png")
        return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/webp")
        return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
    if (mimeType === "application/pdf")
        return data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-";
    if (mimeType === "image/heic" || mimeType === "image/heif") {
        if (data.length < 12 || data.subarray(4, 8).toString("ascii") !== "ftyp")
            return false;
        const brand = data.subarray(8, 12).toString("ascii").toLowerCase();
        return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
    }
    return false;
}
// Older installations keep the immutable owner under a stable `owner-*` id,
// while accounts created in the UI use UUIDs. Both are first-party user ids.
// Keep the accepted alphabet narrow so the path parameter cannot become a
// traversal or an encoded URL fragment.
export const appUserIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const portalTicketIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const programBackupFileSchema = z.string().regex(/^sps_[0-9]+_\d{14}\.zip$/i);
const portalTicketCreateSchema = z.object({
    subject: z.string().trim().min(3).max(500).refine((value) => !value.includes("\0")),
    description: z.string().trim().min(3).max(20_000).refine((value) => !value.includes("\0")),
});
const portalTicketReplySchema = z.object({
    content: z.string().trim().min(1).max(20_000).refine((value) => !value.includes("\0")),
});
const portalTicketConfirmationSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("portal_ticket_create"), password: z.string().min(1).max(512), payload: portalTicketCreateSchema }),
    z.object({
        action: z.literal("portal_ticket_reply"),
        password: z.string().min(1).max(512),
        payload: portalTicketReplySchema.extend({ ticketId: portalTicketIdSchema }),
    }),
]);
function exactConfigRelease(db, version) {
    if (!version)
        return null;
    const history = db.prepare(`SELECT version,config_url FROM firmware_release_history
     WHERE version=? AND config_url<>'' ORDER BY last_seen_at DESC LIMIT 1`).get(version);
    if (history)
        return { version: history.version, configUrl: history.config_url };
    const current = db.prepare("SELECT version,config_url FROM firmware_releases WHERE version=? LIMIT 1").get(version);
    return {
        version: current?.version ?? version,
        configUrl: current?.config_url || officialConfigDownloadUrl(version),
    };
}
function miniserverDeviceImage(type) {
    const normalized = type.toLowerCase();
    if (normalized.includes("compact"))
        return "devices/compact-transparent.png";
    if (normalized.includes("go"))
        return "devices/go.png";
    return "devices/miniserver.png";
}
function confirmationHeader(headers) {
    const value = headers["x-action-confirmation"];
    return typeof value === "string" ? value : undefined;
}
function requireConfirmation(db, user, header, action, serial, payload) {
    return consumeConfirmation(db, user, header, action, serial, actionPayloadHash(action, serial, payload));
}
function parseJson(value) {
    if (!value)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function sendDownload(reply, exported) {
    const fileName = exported.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
    return reply
        .header("Cache-Control", "no-store, max-age=0")
        .header("Pragma", "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .type(exported.contentType)
        .send(exported.content);
}
function operationalFailure(error) {
    if (error instanceof LoxoneError)
        return { code: error.code, message: error.message };
    return { code: "INTERNAL_ERROR", message: "Operace skončila interní chybou Hubu." };
}
function sendIntranetError(reply, error) {
    if (!(error instanceof IntranetError)) {
        return reply.code(500).send({ error: "Při komunikaci s Evora Intranetem nastala interní chyba Hubu.", code: "INTERNAL_ERROR" });
    }
    const status = error.code === "auth_rejected" ? 401
        : error.code === "permission_denied" ? 403
            : error.code === "not_configured" ? 409
                : error.code === "unavailable" ? 503
                    : error.code === "not_provided" ? 502
                        : 500;
    return reply.code(status).send({ error: error.message, code: error.code.toUpperCase() });
}
function recordOperationalResult(db, input) {
    try {
        recordOperationalAttempt(db, input);
        refreshIncidents(db);
    }
    catch {
        // Evidence collection must never replace the original download result or error.
    }
}
export async function registerApi(app, db, jobs) {
    app.get("/api/overview", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return fleetOverview(db);
    });
    app.get("/api/search", { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(request.query);
        const query = normalizeAppSearch(q);
        const items = [];
        const add = (result, ...searchable) => {
            if (appSearchMatches(query, result.title, result.detail, ...searchable))
                items.push(result);
        };
        for (const raw of db.prepare("SELECT serial,type,project,notes,current_firmware AS currentFirmware,connection_state AS connectionState FROM miniservers ORDER BY project COLLATE NOCASE").all()) {
            const row = raw;
            add({
                id: `miniserver:${String(row.serial)}`,
                kind: "miniserver",
                title: String(row.project || row.serial),
                detail: `${String(row.type || "Miniserver")} · SN ${String(row.serial)} · ${String(row.connectionState || "unknown")}`,
                page: "fleet",
                serial: String(row.serial),
            }, row.serial, row.type, row.project, row.notes, row.currentFirmware, row.connectionState);
        }
        for (const raw of db.prepare("SELECT id,name,description FROM project_folders ORDER BY sort_order,name COLLATE NOCASE").all()) {
            const row = raw;
            add({
                id: `folder:${String(row.id)}`,
                kind: "folder",
                title: String(row.name),
                detail: String(row.description || "Složka Miniserverů"),
                page: "fleet",
                folderId: String(row.id),
            }, row.name, row.description);
        }
        if (user.role === "admin" || user.role === "technician") {
            for (const raw of db.prepare("SELECT id,public_id AS publicId,title,description,status,contact_name AS contactName,serial FROM service_tasks ORDER BY updated_at DESC LIMIT 1000").all()) {
                const row = raw;
                add({
                    id: `task:${String(row.id)}`,
                    kind: "task",
                    title: `${String(row.publicId)} · ${String(row.title)}`,
                    detail: `${String(row.status)}${row.contactName ? ` · ${String(row.contactName)}` : ""}`,
                    page: "service_tasks",
                    targetId: String(row.id),
                }, row.publicId, row.title, row.description, row.status, row.contactName, row.serial);
            }
            for (const raw of db.prepare("SELECT id,title,summary,severity,status,serial FROM incidents ORDER BY updated_at DESC LIMIT 1000").all()) {
                const row = raw;
                add({
                    id: `incident:${String(row.id)}`,
                    kind: "incident",
                    title: String(row.title),
                    detail: `${String(row.severity)} · ${String(row.status)}${row.serial ? ` · ${String(row.serial)}` : ""}`,
                    page: "incidents",
                    targetId: String(row.id),
                }, row.title, row.summary, row.severity, row.status, row.serial);
            }
        }
        if (user.role === "admin") {
            for (const raw of db.prepare("SELECT id,ticket_number AS ticketNumber,subject,status,contact_name AS contactName FROM portal_ticket_cache ORDER BY sort_order,id LIMIT 1000").all()) {
                const row = raw;
                add({
                    id: `ticket:${String(row.id)}`,
                    kind: "ticket",
                    title: `#${String(row.ticketNumber || row.id)} · ${String(row.subject || "Bez předmětu")}`,
                    detail: `${String(row.status || "Bez stavu")}${row.contactName ? ` · ${String(row.contactName)}` : ""}`,
                    page: "tickets",
                    targetId: String(row.id),
                }, row.ticketNumber, row.subject, row.status, row.contactName);
            }
            for (const raw of db.prepare("SELECT id,email,display_name AS displayName,role,active FROM users ORDER BY display_name COLLATE NOCASE,email").all()) {
                const row = raw;
                add({
                    id: `user:${String(row.id)}`,
                    kind: "user",
                    title: String(row.displayName || row.email),
                    detail: `${String(row.email)} · ${String(row.role)} · ${row.active === 1 ? "aktivní" : "neaktivní"}`,
                    page: "users",
                }, row.displayName, row.email, row.role, row.active === 1 ? "aktivní online" : "neaktivní offline");
            }
        }
        reply.header("Cache-Control", "private, no-store, max-age=0");
        return { items: items.slice(0, 50) };
    });
    app.get("/api/intranet", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        try {
            return await getIntranetSnapshot(db);
        }
        catch (error) {
            return sendIntranetError(reply, error);
        }
    });
    app.post("/api/intranet/connect", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = z.object({
            email: z.string().trim().email().max(254),
            password: z.string().min(1).max(512),
        }).strict().parse(request.body);
        try {
            const snapshot = await connectIntranet(db, input.email, input.password);
            audit(db, "intranet.connected", user.id, null, { email: input.email.toLowerCase(), state: snapshot.dataState });
            return snapshot;
        }
        catch (error) {
            audit(db, "intranet.connection_failed", user.id, null, { code: error instanceof IntranetError ? error.code : "internal_error" });
            return sendIntranetError(reply, error);
        }
    });
    app.post("/api/intranet/refresh", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        try {
            const snapshot = await refreshIntranet(db, true);
            audit(db, "intranet.refreshed", user.id, null, { state: snapshot.dataState });
            return snapshot;
        }
        catch (error) {
            return sendIntranetError(reply, error);
        }
    });
    app.post("/api/intranet/punch", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = z.object({
            kind: z.enum(["arrival", "departure", "home_start", "home_end", "break_out", "break_in", "doctor_out", "doctor_in", "offsite_out", "offsite_in"]),
        }).strict().parse(request.body);
        try {
            const snapshot = await punchIntranet(db, input.kind);
            audit(db, "intranet.attendance_recorded", user.id, null, { kind: input.kind, state: snapshot.currentState });
            return snapshot;
        }
        catch (error) {
            audit(db, "intranet.attendance_failed", user.id, null, { kind: input.kind, code: error instanceof IntranetError ? error.code : "internal_error" });
            return sendIntranetError(reply, error);
        }
    });
    app.post("/api/intranet/leave", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = intranetLeaveSchema.parse(request.body);
        try {
            if (input.action === "create") {
                const snapshot = await createIntranetLeave(db, input);
                audit(db, "intranet.leave_created", user.id, null, {
                    type: input.type,
                    dateFrom: input.dateFrom,
                    dateTo: input.dateTo,
                    portion: input.portion,
                });
                return snapshot;
            }
            const snapshot = await cancelIntranetLeave(db, input.id);
            audit(db, "intranet.leave_cancelled", user.id, null, { id: input.id });
            return snapshot;
        }
        catch (error) {
            audit(db, "intranet.leave_failed", user.id, null, {
                action: input.action,
                code: error instanceof IntranetError ? error.code : "internal_error",
            });
            return sendIntranetError(reply, error);
        }
    });
    app.delete("/api/intranet", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const snapshot = disconnectIntranet(db);
        audit(db, "intranet.disconnected", user.id, null, {});
        return snapshot;
    });
    app.get("/api/portal-sync", async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        return getPortalSyncStatus(db);
    });
    app.post("/api/portal-sync/connect", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const body = z.object({
            email: z.string().email(),
            portalPassword: z.string().min(1).max(512),
        }).parse(request.body);
        const status = await connectPortal(db, body.email, body.portalPassword);
        clearPortalTicketSession(db);
        clearPortalTicketCache(db);
        audit(db, "portal.connected", user.id, null, { email: body.email, productCount: status.productCount });
        return status;
    });
    app.post("/api/portal-sync/run", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const existing = jobs.findActive("portal_sync", null);
        return reply.code(202).send({ job: existing ?? jobs.enqueueUnique("portal_sync", null, user.id, { manual: true }) });
    });
    app.delete("/api/portal-sync", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        audit(db, "portal.disconnected", user.id, null, {});
        const status = disconnectPortal(db);
        clearPortalTicketSession(db);
        clearPortalTicketCache(db);
        return status;
    });
    app.get("/api/portal-tickets", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        const refresh = request.query?.refresh === "1";
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return { items: await listPortalTickets(db, { refresh }) };
    });
    app.get("/api/portal-tickets/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        const id = portalTicketIdSchema.parse(request.params.id);
        const refresh = request.query?.refresh === "1";
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return { ticket: await getPortalTicket(db, id, { refresh }) };
    });
    app.post("/api/portal-tickets", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = portalTicketCreateSchema.parse(request.body);
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "portal_ticket_create", null, input)) {
            return reply.code(428).send({ error: "Nejdřív zkontrolujte celý návrh a potvrďte odeslání svým heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await createPortalTicket(db, input);
        audit(db, "portal.ticket_created", user.id, null, {
            confirmation: "explicit_after_preview",
            portalTicketId: result.ticketId,
            portalTicketNumber: result.ticketNumber,
        });
        return result;
    });
    app.post("/api/portal-tickets/:id/replies", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const ticketId = portalTicketIdSchema.parse(request.params.id);
        const replyInput = portalTicketReplySchema.parse(request.body);
        const payload = { ticketId, content: replyInput.content };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "portal_ticket_reply", null, payload)) {
            return reply.code(428).send({ error: "Nejdřív zkontrolujte celou odpověď a potvrďte odeslání svým heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await replyPortalTicket(db, ticketId, replyInput.content);
        audit(db, "portal.ticket_replied", user.id, null, {
            confirmation: "explicit_after_preview",
            portalTicketId: ticketId,
        });
        return result;
    });
    app.post("/api/portal-tickets/attachments/download", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        const input = z.object({ token: z.string().min(20).max(20_000) }).parse(request.body);
        const attachment = await downloadPortalTicketAttachment(db, input.token);
        const fallbackName = attachment.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
        return reply
            .header("Cache-Control", "no-store, max-age=0")
            .header("Pragma", "no-cache")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
            .type(attachment.contentType)
            .send(attachment.content);
    });
    app.get("/api/integrations/worklog/tokens", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        return { items: listWorkLogTokens(db, user.id) };
    });
    app.post("/api/integrations/worklog/tokens", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        if (activeWorkLogTokenCount(db, user.id) >= 5) {
            return reply.code(409).send({
                error: "Nejdřív zrušte některý starší WorkLog token. Jeden účet může mít nejvýše pět aktivních zařízení.",
                code: "WORKLOG_TOKEN_LIMIT",
            });
        }
        const input = z.object({
            name: z.string().trim().min(1).max(100).default("Evora Smart Menu – Mac"),
        }).parse(request.body ?? {});
        const created = createWorkLogToken(db, user.id, input.name);
        audit(db, "worklog.token_created", user.id, null, { integrationId: created.item.id, name: created.item.name });
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return created;
    });
    app.delete("/api/integrations/worklog/tokens/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        if (!revokeWorkLogToken(db, user.id, id)) {
            return reply.code(404).send({ error: "Aktivní WorkLog token nebyl nalezen.", code: "NOT_FOUND" });
        }
        audit(db, "worklog.token_revoked", user.id, null, { integrationId: id });
        return { ok: true };
    });
    app.get("/api/integrations/worklog/v1/portal-tickets", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const refresh = request.query?.refresh === "1";
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return { user: { email: identity.email }, items: await listPortalTickets(db, { refresh }) };
    });
    app.get("/api/integrations/worklog/v1/portal-tickets/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const id = portalTicketIdSchema.parse(request.params.id);
        const refresh = request.query?.refresh === "1";
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return { ticket: await getPortalTicket(db, id, { refresh }) };
    });
    app.post("/api/integrations/worklog/v1/portal-tickets/attachments/download", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const input = z.object({ token: z.string().min(20).max(20_000) }).parse(request.body);
        const attachment = await downloadPortalTicketAttachment(db, input.token);
        const fallbackName = attachment.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
        return reply
            .header("Cache-Control", "no-store, max-age=0")
            .header("Pragma", "no-cache")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
            .type(attachment.contentType)
            .send(attachment.content);
    });
    app.post("/api/integrations/worklog/v1/portal-tickets/confirm", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const input = portalTicketConfirmationSchema.parse(request.body);
        const confirmed = await createActionConfirmationWithPassword(db, { id: identity.ownerUserId }, {
            password: input.password,
            action: input.action,
            serial: null,
            payload: input.payload,
        });
        if (!confirmed)
            return reply.code(403).send({ error: "Heslo není správné.", code: "REAUTH_FAILED" });
        return confirmed;
    });
    app.post("/api/integrations/worklog/v1/portal-tickets", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const input = portalTicketCreateSchema.parse(request.body);
        if (!requireConfirmation(db, { id: identity.ownerUserId }, confirmationHeader(request.headers), "portal_ticket_create", null, input)) {
            return reply.code(428).send({ error: "Nejdřív zkontrolujte celý návrh a potvrďte odeslání svým heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await createPortalTicket(db, input);
        audit(db, "worklog.portal_ticket_created", identity.ownerUserId, null, {
            integrationId: identity.tokenId,
            confirmation: "explicit_after_preview",
            portalTicketId: result.ticketId,
            portalTicketNumber: result.ticketNumber,
        });
        return result;
    });
    app.post("/api/integrations/worklog/v1/portal-tickets/:id/replies", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const ticketId = portalTicketIdSchema.parse(request.params.id);
        const replyInput = portalTicketReplySchema.parse(request.body);
        const payload = { ticketId, content: replyInput.content };
        if (!requireConfirmation(db, { id: identity.ownerUserId }, confirmationHeader(request.headers), "portal_ticket_reply", null, payload)) {
            return reply.code(428).send({ error: "Nejdřív zkontrolujte celou odpověď a potvrďte odeslání svým heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await replyPortalTicket(db, ticketId, replyInput.content);
        audit(db, "worklog.portal_ticket_replied", identity.ownerUserId, null, {
            integrationId: identity.tokenId,
            confirmation: "explicit_after_preview",
            portalTicketId: ticketId,
        });
        return result;
    });
    app.get("/api/integrations/worklog/v1/miniservers", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity) {
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        }
        const agent = preferredLauncherAgent(db, identity.ownerUserId);
        const folderColors = new Map(listProjectFolders(db).map((folder) => [folder.id, folder.color]));
        const items = listMiniservers(db).map((server) => {
            const release = exactConfigRelease(db, server.currentFirmware);
            return {
                serial: server.serial,
                project: server.project,
                type: server.type,
                folderName: server.folderName ?? "Ostatní",
                folderColor: server.folderId ? (folderColors.get(server.folderId) ?? "#58D73A") : "#8A948C",
                connectionState: server.connectionState,
                currentFirmware: server.currentFirmware,
                elementsOnline: server.elementsOnline,
                elementsTotal: server.elementsTotal,
                offlineDevices: server.elementsTotal === null ? null : server.offlineDevices,
                lastCheckedAt: server.lastCheckedAt,
                lastLatencyMs: server.lastLatencyMs,
                consecutiveFailures: server.consecutiveFailures,
                healthVerdict: server.healthVerdict,
                healthRefreshedAt: server.healthRefreshedAt,
                dataState: server.dataState,
                hasCredentials: server.hasCredentials,
                loxoneAppAvailable: server.hasCredentials,
                loxoneConfigAvailable: Boolean(agent?.available && !agent.updateRequired && server.currentFirmware && server.hasCredentials),
                configVersion: release?.version ?? server.currentFirmware,
                configDownloadUrl: release?.configUrl ?? null,
                deviceImageUrl: miniserverDeviceImage(server.type),
            };
        });
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return {
            appVersion: config.appVersion,
            user: { email: identity.email },
            launcherAgent: agent,
            cameras: getCameraOverview(db).channels,
            items,
        };
    });
    app.get("/api/integrations/worklog/v1/cameras/:channelId/snapshot", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const channelId = z.coerce.number().int().min(0).max(99).parse(request.params.channelId);
        try {
            const jpeg = await getCameraSnapshot(db, channelId);
            return reply.header("Cache-Control", "private, no-store, max-age=0").type("image/jpeg").send(jpeg);
        }
        catch (error) {
            const message = error instanceof CameraIntegrationError ? error.message : "Náhled kamery není dostupný.";
            const status = error instanceof CameraIntegrationError && error.code === "CAMERA_CONFIG_INVALID" ? 404 : 502;
            return reply.code(status).send({ error: message, code: error instanceof CameraIntegrationError ? error.code : "CAMERA_STREAM_FAILED" });
        }
    });
    app.put("/api/integrations/worklog/v1/cameras/config", { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity)
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        const input = z.object({
            name: z.string().trim().min(1).max(100).optional(),
            host: z.string().trim().min(7).max(15),
            httpPort: z.number().int().min(1).max(65_535).optional(),
            rtspPort: z.number().int().min(1).max(65_535).optional(),
            username: z.string().trim().min(1).max(64),
            password: z.string().min(1).max(256),
        }).strict().parse(request.body);
        try {
            const overview = await saveCameraIntegration(db, input);
            audit(db, "worklog.cameras_configured", identity.ownerUserId, null, {
                integrationId: identity.tokenId,
                host: overview.host,
                model: overview.model,
                channels: overview.channels.length,
            });
            return { item: overview };
        }
        catch (error) {
            if (error instanceof CameraIntegrationError) {
                const status = error.code === "CAMERA_CONFIG_INVALID" ? 400 : error.code === "CAMERA_AUTH_FAILED" ? 401 : 502;
                return reply.code(status).send({ error: error.message, code: error.code });
            }
            throw error;
        }
    });
    app.post("/api/integrations/worklog/v1/miniservers/:serial/actions", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity) {
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        }
        const serial = serialSchema.parse(request.params.serial);
        const input = z.object({ action: z.enum(["loxone_app", "loxone_config"]) }).parse(request.body);
        const server = getMiniserver(db, serial);
        if (!server)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const credentials = getStoredCredentials(db, serial);
        if (!credentials) {
            return reply.code(409).send({ error: "U Miniserveru nejsou uložené přístupy.", code: "CREDENTIALS_MISSING" });
        }
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        if (input.action === "loxone_app") {
            audit(db, "worklog.loxone_app_opened", identity.ownerUserId, serial, { integrationId: identity.tokenId });
            return { action: input.action, url: workLogLoxoneAppUrl(serial, credentials.username, credentials.password) };
        }
        if (!server.currentFirmware) {
            return reply.code(409).send({ error: "Nejdřív je potřeba zjistit firmware Miniserveru.", code: "FIRMWARE_UNKNOWN" });
        }
        const agent = preferredLauncherAgent(db, identity.ownerUserId);
        if (!agent?.available) {
            return reply.code(409).send({ error: "Váš Windows Launcher není online.", code: "AGENT_OFFLINE" });
        }
        if (agent.updateRequired) {
            return reply.code(409).send({
                error: `Windows Launcher ${agent.helperVersion ?? "neznámé verze"} je zastaralý. V Nastavení stáhněte a spusťte aktualizaci alespoň na ${agent.requiredHelperVersion}. Existující spárování zůstane zachované.`,
                code: "AGENT_UPDATE_REQUIRED",
                requiredHelperVersion: agent.requiredHelperVersion,
                latestHelperVersion: agent.latestHelperVersion,
            });
        }
        const release = exactConfigRelease(db, server.currentFirmware);
        const job = createConfigLaunchJob(db, {
            serial,
            actorUserId: identity.ownerUserId,
            agentId: agent.id,
            requiredVersion: server.currentFirmware,
            connectionUrl: server.connectionUrl ?? `https://dns.loxonecloud.com/${serial}`,
            configUrl: release?.configUrl ?? null,
        });
        audit(db, "worklog.config_launch_requested", identity.ownerUserId, serial, {
            integrationId: identity.tokenId,
            jobId: job.id,
            agentId: agent.id,
            requiredVersion: job.requiredVersion,
        });
        return reply.code(202).send({ action: input.action, job });
    });
    app.get("/api/integrations/worklog/v1/config-jobs/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
        const identity = authenticateWorkLogToken(db, request.headers.authorization);
        if (!identity) {
            return reply.code(401).send({ error: "WorkLog token není platný.", code: "WORKLOG_AUTH_INVALID" });
        }
        const id = configLaunchJobIdSchema.parse(request.params.id);
        const job = getConfigLaunchJobForUser(db, id, identity.ownerUserId);
        if (!job)
            return reply.code(404).send({ error: "Požadavek nebyl nalezen.", code: "NOT_FOUND" });
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return { job };
    });
    app.get("/api/config-launcher", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        return { agent: preferredLauncherAgent(db, user.id) };
    });
    app.delete("/api/config-launcher/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const agentId = configLaunchJobIdSchema.parse(request.params.id);
        if (!revokeLauncherAgent(db, user.id, agentId)) {
            return reply.code(404).send({ error: "Počítač nebyl nalezen nebo už je odebraný.", code: "NOT_FOUND" });
        }
        audit(db, "config_launcher.revoked", user.id, null, { agentId });
        return { ok: true };
    });
    app.post("/api/config-launcher/pairings", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const input = z.object({ name: z.string().trim().min(1).max(100).default("Windows Launcher") }).parse(request.body ?? {});
        const pairing = createLauncherPairing(db, user.id, input.name);
        audit(db, "config_launcher.pairing_created", user.id, null, { name: input.name, expiresAt: pairing.expiresAt });
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return pairing;
    });
    app.post("/api/config-launcher/agent/pair", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const input = z.object({
            code: z.string().min(12).max(100),
            name: z.string().trim().min(1).max(100).optional(),
        }).parse(request.body);
        const paired = pairLauncherAgent(db, input.code, input.name);
        if (!paired)
            return reply.code(401).send({ error: "Párovací kód je neplatný nebo vypršel.", code: "PAIRING_INVALID" });
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        audit(db, "config_launcher.paired", null, null, { agentId: paired.agentId, name: input.name ?? "Windows Launcher" });
        return paired;
    });
    app.post("/api/config-launcher/agent/poll", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (request, reply) => {
        const agent = authenticateLauncherAgent(db, request.headers.authorization);
        if (!agent)
            return reply.code(401).send({ error: "Windows Launcher není autorizovaný.", code: "AGENT_AUTH_INVALID" });
        const input = z.object({
            helperVersion: z.string().trim().min(1).max(40),
            installedVersions: z.array(z.string().trim().min(1).max(40)).max(100),
            diagnostics: launcherDiagnosticsSchema.nullable().optional(),
        }).parse(request.body);
        heartbeatLauncherAgent(db, agent, input.helperVersion, input.installedVersions, input.diagnostics);
        const versionStatus = configLauncherVersionStatus(input.helperVersion);
        const update = versionStatus.updateAvailable ? configLauncherUpdateManifest() : null;
        if (versionStatus.updateRequired) {
            reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
            return { job: null, ...versionStatus, update };
        }
        const job = takeConfigLaunchJob(db, agent.id);
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        if (!job)
            return { job: null, ...versionStatus, update };
        const credentials = getStoredCredentials(db, job.serial);
        if (!credentials) {
            updateConfigLaunchJob(db, agent.id, job.id, "failed", "U Miniserveru chybí uložené přístupy.", "CREDENTIALS_MISSING");
            return { job: null, ...versionStatus, update };
        }
        audit(db, "config_launcher.job_delivered", null, job.serial, { jobId: job.id, agentId: agent.id, requiredVersion: job.required_version });
        return {
            ...versionStatus,
            update,
            job: {
                id: job.id,
                serial: job.serial,
                requiredVersion: job.required_version,
                connectionAddress: job.connection_url,
                configUrl: job.config_url,
                username: credentials.username,
                password: credentials.password,
            },
        };
    });
    app.post("/api/config-launcher/agent/jobs/:id/status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
        const agent = authenticateLauncherAgent(db, request.headers.authorization);
        if (!agent)
            return reply.code(401).send({ error: "Windows Launcher není autorizovaný.", code: "AGENT_AUTH_INVALID" });
        const id = configLaunchJobIdSchema.parse(request.params.id);
        const input = z.object({
            state: z.enum(["launching", "connecting", "succeeded", "missing_config", "failed"]),
            message: z.string().trim().min(1).max(500),
            errorCode: z.string().trim().min(1).max(80).nullable().optional(),
        }).parse(request.body);
        const job = updateConfigLaunchJob(db, agent.id, id, input.state, input.message, input.errorCode ?? null);
        if (!job)
            return reply.code(409).send({ error: "Stav požadavku už nelze změnit.", code: "JOB_STATE_INVALID" });
        if (["succeeded", "missing_config", "failed"].includes(job.state)) {
            audit(db, `config_launcher.${job.state}`, null, job.serial, { jobId: job.id, agentId: agent.id, errorCode: job.errorCode });
        }
        return { job };
    });
    app.get("/api/config-launcher/jobs/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = configLaunchJobIdSchema.parse(request.params.id);
        const job = getConfigLaunchJobForUser(db, id, user.id);
        if (!job)
            return reply.code(404).send({ error: "Požadavek nebyl nalezen.", code: "NOT_FOUND" });
        reply.header("Cache-Control", "no-store, max-age=0");
        return { job };
    });
    app.get("/api/releases/history", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listReleaseArchive(db) };
    });
    app.get("/api/miniservers", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listMiniservers(db) };
    });
    app.get("/api/miniservers/:serial/profile", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const serial = serialSchema.parse(request.params.serial);
        const profile = getMiniserverProfile(db, serial);
        if (!profile)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        return { profile };
    });
    app.put("/api/miniservers/:serial/profile", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const input = z.object({
            customerName: z.string().trim().max(160).default(""),
            contactName: z.string().trim().max(160).default(""),
            contactRole: z.string().trim().max(120).default(""),
            contactPhone: z.string().trim().max(80).default(""),
            contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
            preferredChannel: z.enum(["phone", "email", "sms", "whatsapp", "other"]).default("phone"),
            siteAddress: z.string().trim().max(500).default(""),
            siteType: z.string().trim().max(120).default(""),
            serviceContract: z.string().trim().max(160).default(""),
            slaHours: z.number().int().min(1).max(8_760).nullable().default(null),
            warrantyUntil: z.string().date().nullable().default(null),
            nextServiceAt: z.string().date().nullable().default(null),
            customFields: z.array(z.object({ key: z.string().trim().min(1).max(80), value: z.string().trim().max(500) }).strict()).max(30).default([]),
            tags: z.array(coloredTagInputSchema).max(20).default([]),
        }).strict().parse(request.body);
        try {
            const profile = saveMiniserverProfile(db, serial, input);
            audit(db, "miniserver.profile_updated", user.id, serial, {
                fields: Object.keys(input).filter((key) => key !== "contactEmail" && key !== "contactPhone"),
                hasContact: Boolean(input.contactName || input.contactEmail || input.contactPhone),
            });
            return { profile };
        }
        catch (error) {
            const code = error.code;
            if (code === "NOT_FOUND")
                return reply.code(404).send({ error: error.message, code });
            if (code === "CLIENT_PROFILE_INHERITED")
                return reply.code(409).send({ error: error.message, code });
            throw error;
        }
    });
    app.get("/api/tags", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        return { items: listTags(db) };
    });
    app.get("/api/assignees", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const items = db.prepare("SELECT id,email,display_name,role FROM users WHERE active=1 AND role IN ('admin','technician') ORDER BY display_name COLLATE NOCASE,email").all().map((row) => ({
            id: row.id, email: row.email, displayName: row.display_name || row.email, role: row.role,
        }));
        return { items };
    });
    app.get("/api/saved-views", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const query = z.object({ scope: z.enum(["fleet", "incidents", "service_tasks"]) }).parse(request.query);
        const items = db.prepare("SELECT id,name,scope,filters_json,created_at,updated_at FROM saved_views WHERE user_id=? AND scope=? ORDER BY name COLLATE NOCASE")
            .all(user.id, query.scope).map((row) => ({
            id: row.id, name: row.name, scope: row.scope, filters: savedViewFilters(row.filters_json), createdAt: row.created_at, updatedAt: row.updated_at,
        }));
        return { items };
    });
    app.post("/api/saved-views", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const input = z.object({
            name: z.string().trim().min(1).max(100), scope: z.enum(["fleet", "incidents", "service_tasks"]),
            filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
        }).strict().parse(request.body);
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO saved_views(id,user_id,name,scope,filters_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(user_id,scope,name) DO UPDATE SET filters_json=excluded.filters_json,updated_at=excluded.updated_at`).run(id, user.id, input.name, input.scope, JSON.stringify(input.filters), now, now);
        return reply.code(201).send({ ok: true });
    });
    app.delete("/api/saved-views/:id", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        db.prepare("DELETE FROM saved_views WHERE id=? AND user_id=?").run(id, user.id);
        return { ok: true };
    });
    app.post("/api/miniservers/:serial/connection-test", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const result = await runConnectionTest(db, serial, user.id);
        audit(db, "miniserver.connection_test", user.id, serial, {
            state: result.state,
            steps: result.steps.map((step) => ({ key: step.key, state: step.state, code: step.code })),
        });
        return { result };
    });
    app.get("/api/miniservers/:serial/connection-test", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const serial = serialSchema.parse(request.params.serial);
        return { result: lastConnectionTest(db, serial) };
    });
    app.get("/api/incidents", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        return { items: listIncidents(db) };
    });
    app.post("/api/incidents/refresh", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const items = refreshIncidents(db);
        audit(db, "incidents.refreshed", user.id, null, { count: items.length });
        return { items };
    });
    app.get("/api/incidents/:id", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const id = z.string().uuid().parse(request.params.id);
        const incident = getIncident(db, id);
        if (!incident)
            return reply.code(404).send({ error: "Incident nebyl nalezen.", code: "NOT_FOUND" });
        return { incident };
    });
    app.patch("/api/incidents/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({
            status: z.enum(["open", "acknowledged", "resolved"]).optional(),
            severity: z.enum(["info", "warning", "critical"]).optional(),
            assigneeUserId: appUserIdSchema.nullable().optional(),
            slaDueAt: nullableDateTimeSchema.optional(),
            comment: z.string().trim().min(1).max(5_000).optional(),
        }).strict().refine((value) => Object.keys(value).length > 0).parse(request.body);
        const incident = updateIncident(db, id, user.id, input);
        if (!incident)
            return reply.code(404).send({ error: "Incident nebyl nalezen.", code: "NOT_FOUND" });
        audit(db, "incident.updated", user.id, incident.serial, { incidentId: id, fields: Object.keys(input) });
        return { incident };
    });
    app.get("/api/service-tasks", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        return { items: listServiceTasks(db) };
    });
    app.get("/api/service-tasks/excel/status", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        return { status: getServiceTaskExcelSyncStatus(db, { includeGraphVerification: user.role === "admin" }) };
    });
    app.post("/api/service-tasks/excel/graph/connect", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        try {
            const graph = await startServiceTaskExcelGraphConnection(db);
            audit(db, "service_tasks.excel_graph_connection_started", user.id, null, {});
            return { graph };
        }
        catch (error) {
            const known = error instanceof ServiceTaskExcelGraphError ? error : null;
            return reply.code(known?.code.endsWith("NOT_CONFIGURED") ? 409 : 502).send({
                error: known?.message ?? "Připojení Microsoft 365 se nepodařilo zahájit.",
                code: known?.code ?? "GRAPH_CONNECTION_FAILED",
            });
        }
    });
    app.post("/api/service-tasks/excel/graph/poll", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const before = getServiceTaskExcelSyncStatus(db).graph.state;
        const graph = await pollServiceTaskExcelGraphConnection(db);
        if (before !== "connected" && graph.state === "connected") {
            audit(db, "service_tasks.excel_graph_connected", user.id, null, {});
        }
        return { graph };
    });
    app.delete("/api/service-tasks/excel/graph", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const graph = disconnectServiceTaskExcelGraph(db);
        audit(db, "service_tasks.excel_graph_disconnected", user.id, null, {});
        return { graph };
    });
    app.post("/api/service-tasks/excel/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        try {
            const status = await syncServiceTasksFromExcel(db);
            audit(db, "service_tasks.excel_synced", user.id, null, { activeRows: status.activeRows });
            return { status, items: listServiceTasks(db) };
        }
        catch (error) {
            const known = error instanceof ServiceTaskExcelError ? error : null;
            audit(db, "service_tasks.excel_sync_failed", user.id, null, { code: known?.code ?? "SYNC_FAILED" });
            const status = known?.code === "NOT_CONFIGURED" || known?.code === "GRAPH_AUTH_REQUIRED" ? 409
                : known?.code === "GRAPH_PERMISSION_DENIED" ? 403 : 502;
            return reply.code(status).send({
                error: known?.message ?? "Synchronizace Excelu se nezdařila.", code: known?.code ?? "SYNC_FAILED",
            });
        }
    });
    app.post("/api/service-tasks", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const input = serviceTaskInputSchema.parse(request.body);
        const task = createServiceTask(db, user.id, input);
        audit(db, "service_task.created", user.id, task.serial, { taskId: task.id, publicId: task.publicId, priority: task.priority });
        return reply.code(201).send({ task });
    });
    app.get("/api/service-tasks/:id", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const id = z.string().uuid().parse(request.params.id);
        const task = getServiceTask(db, id);
        if (!task)
            return reply.code(404).send({ error: "Servisní úkol nebyl nalezen.", code: "NOT_FOUND" });
        return { task };
    });
    app.patch("/api/service-tasks/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = serviceTaskInputSchema.partial().extend({ status: z.enum(["new", "planned", "in_progress", "waiting", "done", "cancelled"]).optional() })
            .strict().refine((value) => Object.keys(value).length > 0).parse(request.body);
        const task = updateServiceTask(db, id, user.id, input);
        if (!task)
            return reply.code(404).send({ error: "Servisní úkol nebyl nalezen.", code: "NOT_FOUND" });
        const updated = getServiceTask(db, id) ?? task;
        audit(db, "service_task.updated", user.id, updated.serial, {
            taskId: id,
            fields: Object.keys(input),
            excelWritebackState: updated.externalSync?.state ?? null,
        });
        return { task: updated };
    });
    app.post("/api/service-tasks/:id/comments", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({ body: z.string().trim().min(1).max(10_000) }).strict().parse(request.body);
        const task = addServiceTaskComment(db, id, user.id, input.body);
        if (!task)
            return reply.code(404).send({ error: "Servisní úkol nebyl nalezen.", code: "NOT_FOUND" });
        audit(db, "service_task.comment_added", user.id, task.serial, { taskId: id });
        return reply.code(201).send({ task });
    });
    app.post("/api/service-tasks/:id/attachments", {
        bodyLimit: 12 * 1024 * 1024,
        config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({
            fileName: z.string().trim().min(1).max(180).regex(/^[^\\/\0]+$/),
            mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]),
            dataBase64: z.string().min(4).max(11_200_000),
        }).strict().parse(request.body);
        const data = Buffer.from(input.dataBase64, "base64");
        if (data.length === 0 || data.length > 8 * 1024 * 1024 || data.toString("base64").replace(/=+$/, "") !== input.dataBase64.replace(/=+$/, "")) {
            return reply.code(400).send({ error: "Příloha není platný Base64 soubor do 8 MB.", code: "ATTACHMENT_INVALID" });
        }
        if (!attachmentMatchesMime(data, input.mimeType)) {
            return reply.code(400).send({ error: "Obsah přílohy neodpovídá deklarovanému typu souboru.", code: "ATTACHMENT_TYPE_MISMATCH" });
        }
        let task;
        try {
            task = addServiceTaskAttachment(db, id, user.id, { fileName: input.fileName, mimeType: input.mimeType, data });
        }
        catch (error) {
            if (error.code === "ATTACHMENT_LIMIT") {
                return reply.code(409).send({ error: error.message, code: "ATTACHMENT_LIMIT" });
            }
            throw error;
        }
        if (!task)
            return reply.code(404).send({ error: "Servisní úkol nebyl nalezen.", code: "NOT_FOUND" });
        audit(db, "service_task.attachment_added", user.id, task.serial, { taskId: id, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: data.length });
        return reply.code(201).send({ task });
    });
    app.get("/api/service-tasks/:taskId/attachments/:id", async (request, reply) => {
        if (!requireRole(request, reply, ["admin", "technician"]))
            return;
        const params = z.object({ taskId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
        const attachment = readServiceTaskAttachment(db, params.taskId, params.id);
        if (!attachment)
            return reply.code(404).send({ error: "Příloha nebyla nalezena.", code: "NOT_FOUND" });
        reply.header("Cache-Control", "private, no-store");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Content-Type", attachment.mimeType);
        reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
        return reply.send(attachment.data);
    });
    app.get("/api/folders", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listProjectFolders(db) };
    });
    app.get("/api/folders/:id/detail", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const id = z.string().uuid().parse(request.params.id);
        const query = z.object({ range: z.enum(["24h", "7d", "30d", "13m", "5y"]).default("30d") }).parse(request.query);
        const folders = listProjectFolders(db);
        const folder = folders.find((item) => item.id === id);
        if (!folder)
            return reply.code(404).send({ error: "Složka nebyla nalezena.", code: "NOT_FOUND" });
        const folderIds = new Set([id, ...projectFolderDescendantIds(folders, id)]);
        const servers = listMiniservers(db).filter((server) => server.folderId && folderIds.has(server.folderId));
        const serials = servers.map((server) => server.serial);
        const serverBySerial = new Map(servers.map((server) => [server.serial, server]));
        const devices = serials.length
            ? db.prepare(`SELECT serial AS serverSerial,device_serial AS serial,parent_serial AS parentSerial,name,type,firmware,online,
                first_offline_at AS firstOfflineAt,last_seen_at AS lastSeenAt,system_message AS systemMessage,
                device_index AS deviceIndex,source,updated_at AS updatedAt,
                json_extract(payload_json,'$.temperatureC') AS temperatureC,
                json_extract(payload_json,'$.temperatureUpdatedAt') AS temperatureUpdatedAt,
                json_extract(payload_json,'$.airRssiDb') AS airRssiDb,
                json_extract(payload_json,'$.airHops') AS airHops,
                json_extract(payload_json,'$.batteryPercent') AS batteryPercent,
                json_extract(payload_json,'$.productName') AS productName,
                json_extract(payload_json,'$.productNumber') AS productNumber
         FROM device_inventory
         WHERE serial IN (${serials.map(() => "?").join(",")})
           AND device_serial NOT GLOB '*[^0-9A-F]*' AND length(device_serial) BETWEEN 6 AND 16
         ORDER BY online,name COLLATE NOCASE`).all(...serials).map((row) => {
                const item = row;
                const server = serverBySerial.get(String(item.serverSerial));
                return { ...item, serverProject: server?.project ?? String(item.serverSerial) };
            })
            : [];
        const oneWireSensors = servers.flatMap((server) => readOneWireHistory(db, server.serial, query.range).sensors.map((sensor) => ({
            ...sensor,
            serverSerial: server.serial,
            serverProject: server.project,
        })));
        const online = devices.filter((device) => Number(device.online) === 1).length;
        return {
            folder,
            folderIds: [...folderIds],
            servers,
            devices,
            totals: { servers: servers.length, devices: devices.length, online, offline: devices.length - online },
            range: query.range,
            oneWireSensors,
        };
    });
    app.get("/api/home-assistant", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listHomeAssistantInstances(db) };
    });
    app.get("/api/cameras", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        return getCameraOverview(db);
    });
    app.put("/api/cameras/config", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = z.object({
            name: z.string().trim().min(1).max(100).optional(),
            host: z.string().trim().min(7).max(15),
            httpPort: z.number().int().min(1).max(65_535).optional(),
            rtspPort: z.number().int().min(1).max(65_535).optional(),
            username: z.string().trim().min(1).max(64),
            password: z.string().min(1).max(256),
        }).strict().parse(request.body);
        try {
            const overview = await saveCameraIntegration(db, input);
            audit(db, "cameras.configured", user.id, null, {
                host: overview.host,
                model: overview.model,
                channels: overview.channels.length,
            });
            return { item: overview };
        }
        catch (error) {
            if (error instanceof CameraIntegrationError) {
                const status = error.code === "CAMERA_CONFIG_INVALID" ? 400 : error.code === "CAMERA_AUTH_FAILED" ? 401 : 502;
                return reply.code(status).send({ error: error.message, code: error.code });
            }
            throw error;
        }
    });
    app.post("/api/cameras/refresh", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        try {
            const overview = await refreshCameraIntegration(db);
            audit(db, "cameras.refreshed", user.id, null, { channels: overview.channels.length });
            return { item: overview };
        }
        catch (error) {
            if (error instanceof CameraIntegrationError) {
                const status = error.code === "CAMERA_CONFIG_INVALID" ? 409 : error.code === "CAMERA_AUTH_FAILED" ? 401 : 502;
                return reply.code(status).send({ error: error.message, code: error.code });
            }
            throw error;
        }
    });
    app.get("/api/cameras/:channelId/snapshot", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const channelId = z.coerce.number().int().min(0).max(99).parse(request.params.channelId);
        try {
            const jpeg = await getCameraSnapshot(db, channelId);
            return reply.header("Cache-Control", "private, no-store, max-age=0").type("image/jpeg").send(jpeg);
        }
        catch (error) {
            const message = error instanceof CameraIntegrationError ? error.message : "Náhled kamery není dostupný.";
            const status = error instanceof CameraIntegrationError && error.code === "CAMERA_CONFIG_INVALID" ? 404 : 502;
            return reply.code(status).send({ error: message, code: error instanceof CameraIntegrationError ? error.code : "CAMERA_STREAM_FAILED" });
        }
    });
    app.delete("/api/cameras/config", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        if (!deleteCameraIntegration(db))
            return reply.code(404).send({ error: "NVR nebylo nastavené.", code: "NOT_FOUND" });
        audit(db, "cameras.removed", user.id, null, {});
        return { ok: true };
    });
    app.post("/api/home-assistant", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const input = z.object({
            name: z.string().trim().min(1).max(120),
            baseUrl: z.string().trim().min(1).max(500),
            username: z.string().max(200).optional(),
            password: z.string().max(1024).optional(),
            accessToken: z.string().max(8192).optional(),
            monitoringEnabled: z.boolean().default(true),
        }).strict().parse(request.body);
        if (Boolean(input.username) !== Boolean(input.password)) {
            return reply.code(400).send({ error: "Uživatelské jméno a heslo musí být vyplněné společně.", code: "INCOMPLETE_CREDENTIALS" });
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        let baseUrl;
        try {
            baseUrl = normalizeHomeAssistantUrl(input.baseUrl);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message, code: "INVALID_HA_URL" });
        }
        try {
            db.prepare(`INSERT INTO home_assistant_instances(id,name,base_url,monitoring_enabled,created_at,updated_at)
         VALUES(?,?,?,?,?,?)`).run(id, input.name, baseUrl, input.monitoringEnabled ? 1 : 0, now, now);
        }
        catch (error) {
            if (error.message.includes("UNIQUE")) {
                return reply.code(409).send({ error: "Tento Home Assistant už je v seznamu.", code: "DUPLICATE_HA" });
            }
            throw error;
        }
        if (input.username && input.password)
            saveHomeAssistantSecrets(db, id, { username: input.username, password: input.password });
        if (input.accessToken)
            saveHomeAssistantSecrets(db, id, { accessToken: input.accessToken });
        audit(db, "home_assistant.created", user.id, null, { id, name: input.name, baseUrl, monitoringEnabled: input.monitoringEnabled });
        return reply.code(201).send({ item: getHomeAssistantInstance(db, id) });
    });
    app.patch("/api/home-assistant/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        const input = z.object({
            name: z.string().trim().min(1).max(120).optional(),
            baseUrl: z.string().trim().min(1).max(500).optional(),
            monitoringEnabled: z.boolean().optional(),
        }).strict().parse(request.body);
        if (!getHomeAssistantInstance(db, id))
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const fields = [];
        const values = [];
        if (input.name !== undefined) {
            fields.push("name=?");
            values.push(input.name);
        }
        if (input.baseUrl !== undefined) {
            try {
                fields.push("base_url=?");
                values.push(normalizeHomeAssistantUrl(input.baseUrl));
            }
            catch (error) {
                return reply.code(400).send({ error: error.message, code: "INVALID_HA_URL" });
            }
        }
        if (input.monitoringEnabled !== undefined) {
            fields.push("monitoring_enabled=?");
            values.push(input.monitoringEnabled ? 1 : 0);
        }
        if (!fields.length)
            return reply.code(400).send({ error: "Není co změnit.", code: "EMPTY_PATCH" });
        fields.push("updated_at=?");
        values.push(new Date().toISOString(), id);
        try {
            db.prepare(`UPDATE home_assistant_instances SET ${fields.join(",")} WHERE id=?`).run(...values);
        }
        catch (error) {
            if (error.message.includes("UNIQUE")) {
                return reply.code(409).send({ error: "Tento Home Assistant už je v seznamu.", code: "DUPLICATE_HA" });
            }
            throw error;
        }
        audit(db, "home_assistant.updated", user.id, null, { id, fields: Object.keys(input) });
        return { item: getHomeAssistantInstance(db, id) };
    });
    app.put("/api/home-assistant/:id/secrets", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        if (!getHomeAssistantInstance(db, id))
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const input = z.object({
            username: z.string().max(200).optional(),
            password: z.string().max(1024).optional(),
            accessToken: z.string().max(8192).optional(),
            clearCredentials: z.boolean().default(false),
            clearAccessToken: z.boolean().default(false),
        }).strict().parse(request.body);
        if (Boolean(input.username) !== Boolean(input.password)) {
            return reply.code(400).send({ error: "Uživatelské jméno a heslo musí být vyplněné společně.", code: "INCOMPLETE_CREDENTIALS" });
        }
        clearHomeAssistantSecrets(db, id, { credentials: input.clearCredentials, accessToken: input.clearAccessToken });
        if (input.username && input.password)
            saveHomeAssistantSecrets(db, id, { username: input.username, password: input.password });
        if (input.accessToken)
            saveHomeAssistantSecrets(db, id, { accessToken: input.accessToken });
        audit(db, "home_assistant.secrets_updated", user.id, null, {
            id,
            credentialsChanged: Boolean(input.username) || input.clearCredentials,
            accessTokenChanged: Boolean(input.accessToken) || input.clearAccessToken,
        });
        return { item: getHomeAssistantInstance(db, id) };
    });
    app.get("/api/home-assistant/:id/credentials", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        if (!getHomeAssistantInstance(db, id))
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const credentials = getHomeAssistantCredentials(db, id);
        if (!credentials)
            return reply.code(404).send({ error: "Přihlašovací údaje nejsou uložené.", code: "NO_CREDENTIALS" });
        reply.header("Cache-Control", "no-store");
        audit(db, "home_assistant.credentials_revealed", user.id, null, { id });
        return credentials;
    });
    app.post("/api/home-assistant/:id/check", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        if (!getHomeAssistantInstance(db, id))
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        return reply.code(202).send({
            job: jobs.enqueueUniqueByPayload("ha_check", "homeAssistantId", id, user.id, { manual: true }),
        });
    });
    app.post("/api/home-assistant/check", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const existing = jobs.list(200).find((job) => job.kind === "ha_bulk_check" && ["queued", "running"].includes(job.state));
        return reply.code(202).send({ job: existing ?? jobs.enqueue("ha_bulk_check", null, user.id, { manual: true }) });
    });
    app.post("/api/home-assistant/:id/restart", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        const item = getHomeAssistantInstance(db, id);
        if (!item)
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const payload = { id };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "home_assistant_restart", null, payload)) {
            return reply.code(428).send({ error: "Restart Home Assistantu je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        await callHomeAssistantService(db, id, "homeassistant", "restart");
        audit(db, "home_assistant.restarted", user.id, null, { id, name: item.name });
        return { ok: true };
    });
    app.post("/api/home-assistant/:id/updates/:entityId/install", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const params = z.object({ id: homeAssistantIdSchema, entityId: z.string().min(1).max(255) }).parse(request.params);
        const item = getHomeAssistantInstance(db, params.id);
        if (!item)
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const update = item.updates.find((candidate) => candidate.entityId === params.entityId);
        if (!update)
            return reply.code(409).send({ error: "Aktualizace už není dostupná. Nejprve obnovte kontrolu.", code: "UPDATE_NOT_AVAILABLE" });
        z.object({ confirmed: z.literal(true) }).parse(request.body);
        const payload = { id: params.id, entityId: params.entityId };
        const install = await installHomeAssistantUpdate(db, params.id, update);
        audit(db, "home_assistant.update_started", user.id, null, {
            ...payload,
            title: update.title,
            target: update.latestVersion,
            confirmation: "explicit",
            ...install,
        });
        return { ok: true, ...install };
    });
    app.post("/api/home-assistant/updates/install-all", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        z.object({ confirmed: z.literal(true) }).parse(request.body);
        const targets = listHomeAssistantInstances(db)
            .flatMap((item) => item.updates.map((update) => ({ item, update })))
            .sort((left, right) => Number(left.update.category === "core") - Number(right.update.category === "core"));
        if (!targets.length) {
            return reply.code(409).send({ error: "Žádné aktualizace už nejsou dostupné.", code: "UPDATE_NOT_AVAILABLE" });
        }
        const started = [];
        const failed = [];
        for (const target of targets) {
            try {
                const install = await installHomeAssistantUpdate(db, target.item.id, target.update);
                started.push({ id: target.item.id, entityId: target.update.entityId });
                audit(db, "home_assistant.update_started", user.id, null, {
                    id: target.item.id,
                    entityId: target.update.entityId,
                    title: target.update.title,
                    target: target.update.latestVersion,
                    confirmation: "explicit_bulk",
                    ...install,
                });
            }
            catch {
                failed.push({ id: target.item.id, entityId: target.update.entityId });
            }
        }
        audit(db, "home_assistant.update_all_started", user.id, null, { requested: targets.length, started: started.length, failed: failed.length });
        if (!started.length) {
            return reply.code(502).send({ error: "Home Assistant nepřijal žádnou z aktualizací.", code: "HOME_ASSISTANT_UPDATE_FAILED" });
        }
        return { ok: failed.length === 0, requested: targets.length, started: started.length, failed: failed.length };
    });
    app.delete("/api/home-assistant/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const id = homeAssistantIdSchema.parse(request.params.id);
        const item = getHomeAssistantInstance(db, id);
        if (!item)
            return reply.code(404).send({ error: "Home Assistant nebyl nalezen.", code: "NOT_FOUND" });
        const payload = { id };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "home_assistant_delete", null, payload)) {
            return reply.code(428).send({ error: "Smazání Home Assistantu je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        db.prepare("DELETE FROM home_assistant_instances WHERE id=?").run(id);
        audit(db, "home_assistant.deleted", user.id, null, { id, name: item.name });
        return { ok: true };
    });
    app.post("/api/folders", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const input = z.object({
            name: z.string().trim().min(1).max(120),
            description: z.string().max(500).default(""),
            color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#58D73A"),
            parentId: z.string().uuid().nullable().default(null),
        }).strict().parse(request.body);
        if (input.parentId && !db.prepare("SELECT 1 AS ok FROM project_folders WHERE id=?").get(input.parentId)) {
            return reply.code(404).send({ error: "Nadřazená složka nebyla nalezena.", code: "PARENT_FOLDER_NOT_FOUND" });
        }
        const now = new Date().toISOString();
        const id = randomUUID();
        const sortOrder = Number(db.prepare("SELECT COALESCE(MAX(sort_order),-10)+10 AS value FROM project_folders").get().value);
        const usedColors = db.prepare("SELECT color FROM project_folders").all().map((folder) => folder.color);
        const color = new Set(usedColors.map((value) => value.toUpperCase())).has(input.color.toUpperCase())
            ? nextDistinctFolderColor(usedColors)
            : input.color.toUpperCase();
        try {
            db.prepare("INSERT INTO project_folders(id,name,description,color,parent_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
                .run(id, input.name, input.description, color, input.parentId, sortOrder, now, now);
        }
        catch (error) {
            if (error.message.includes("UNIQUE"))
                return reply.code(409).send({ error: "Složka s tímto názvem už existuje.", code: "DUPLICATE_FOLDER" });
            throw error;
        }
        audit(db, "folder.created", user.id, null, { id, name: input.name, parentId: input.parentId });
        return reply.code(201).send({ folder: listProjectFolders(db).find((folder) => folder.id === id) });
    });
    app.patch("/api/folders/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({
            name: z.string().trim().min(1).max(120).optional(),
            description: z.string().max(500).optional(),
            color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            parentId: z.string().uuid().nullable().optional(),
            sortOrder: z.number().int().min(0).max(1_000_000).optional(),
        }).strict().parse(request.body);
        if (input.parentId !== undefined) {
            const folders = listProjectFolders(db);
            if (input.parentId && !folders.some((folder) => folder.id === input.parentId)) {
                return reply.code(404).send({ error: "Nadřazená složka nebyla nalezena.", code: "PARENT_FOLDER_NOT_FOUND" });
            }
            if (wouldCreateProjectFolderCycle(folders, id, input.parentId)) {
                return reply.code(409).send({ error: "Složku nelze vložit do sebe ani do vlastní podsložky.", code: "FOLDER_CYCLE" });
            }
        }
        const normalizedInput = { ...input };
        if (input.color) {
            const usedColors = db.prepare("SELECT color FROM project_folders WHERE id<>?").all(id).map((folder) => folder.color);
            normalizedInput.color = new Set(usedColors.map((value) => value.toUpperCase())).has(input.color.toUpperCase())
                ? nextDistinctFolderColor(usedColors)
                : input.color.toUpperCase();
        }
        const fields = [];
        const values = [];
        const columns = { name: "name", description: "description", color: "color", parentId: "parent_id", sortOrder: "sort_order" };
        for (const [key, value] of Object.entries(normalizedInput)) {
            fields.push(`${columns[key]}=?`);
            values.push(value);
        }
        if (!fields.length)
            return reply.code(400).send({ error: "Není co změnit.", code: "EMPTY_PATCH" });
        fields.push("updated_at=?");
        values.push(new Date().toISOString(), id);
        try {
            const result = db.prepare(`UPDATE project_folders SET ${fields.join(",")} WHERE id=?`).run(...values);
            if (!result.changes)
                return reply.code(404).send({ error: "Složka nebyla nalezena.", code: "NOT_FOUND" });
        }
        catch (error) {
            if (error.message.includes("UNIQUE"))
                return reply.code(409).send({ error: "Složka s tímto názvem už existuje.", code: "DUPLICATE_FOLDER" });
            throw error;
        }
        audit(db, "folder.updated", user.id, null, { id, fields: Object.keys(input) });
        return { folder: listProjectFolders(db).find((folder) => folder.id === id) };
    });
    app.put("/api/folders/:id/members", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({ serials: z.array(serialSchema).max(500) }).strict().parse(request.body);
        const folder = db.prepare("SELECT name FROM project_folders WHERE id=?").get(id);
        if (!folder)
            return reply.code(404).send({ error: "Složka nebyla nalezena.", code: "NOT_FOUND" });
        const serials = Array.from(new Set(input.serials));
        const existing = serials.length
            ? db.prepare(`SELECT serial FROM miniservers WHERE serial IN (${serials.map(() => "?").join(",")})`)
                .all(...serials)
            : [];
        const existingSerials = new Set(existing.map((row) => row.serial));
        const missing = serials.filter((serial) => !existingSerials.has(serial));
        if (missing.length) {
            return reply.code(404).send({
                error: `Některé Miniservery nebyly nalezeny: ${missing.join(", ")}`,
                code: "MINISERVER_NOT_FOUND",
            });
        }
        const assignedServers = replaceProjectFolderMembers(db, id, serials);
        audit(db, "folder.members_replaced", user.id, null, { id, name: folder.name, assignedServers });
        return {
            ok: true,
            assignedServers,
            folder: listProjectFolders(db).find((item) => item.id === id),
        };
    });
    app.delete("/api/folders/:id", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const folder = db.prepare("SELECT name,parent_id AS parentId FROM project_folders WHERE id=?").get(id);
        if (!folder)
            return reply.code(404).send({ error: "Složka nebyla nalezena.", code: "NOT_FOUND" });
        const moved = Number(db.prepare("SELECT COUNT(*) AS count FROM miniservers WHERE folder_id=?").get(id).count);
        const promotedChildren = Number(db.prepare("SELECT COUNT(*) AS count FROM project_folders WHERE parent_id=?").get(id).count);
        transaction(db, () => {
            db.prepare("UPDATE miniservers SET folder_id=NULL,updated_at=? WHERE folder_id=?").run(new Date().toISOString(), id);
            db.prepare("UPDATE project_folders SET parent_id=?,updated_at=? WHERE parent_id=?").run(folder.parentId, new Date().toISOString(), id);
            db.prepare("DELETE FROM project_folders WHERE id=?").run(id);
        });
        audit(db, "folder.deleted", user.id, null, { id, name: folder.name, unassignedServers: moved, promotedChildFolders: promotedChildren });
        return { ok: true, unassignedServers: moved, promotedChildFolders: promotedChildren };
    });
    app.get("/api/miniservers/:serial", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const serial = serialSchema.parse(request.params.serial);
        const server = getMiniserver(db, serial);
        if (!server)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const devices = db
            .prepare(`SELECT device_serial AS serial,parent_serial AS parentSerial,name,type,firmware,online,first_offline_at AS firstOfflineAt,
                last_seen_at AS lastSeenAt,system_message AS systemMessage,device_index AS deviceIndex,source,updated_at AS updatedAt,
                json_extract(payload_json,'$.temperatureC') AS temperatureC,
                json_extract(payload_json,'$.temperatureUpdatedAt') AS temperatureUpdatedAt,
                json_extract(payload_json,'$.airRssiDb') AS airRssiDb,
                json_extract(payload_json,'$.airHops') AS airHops,
                json_extract(payload_json,'$.batteryPercent') AS batteryPercent,
                json_extract(payload_json,'$.productName') AS productName,
                json_extract(payload_json,'$.productNumber') AS productNumber
         FROM device_inventory
         WHERE serial=? AND device_serial NOT GLOB '*[^0-9A-F]*' AND length(device_serial) BETWEEN 6 AND 16
         ORDER BY online,name COLLATE NOCASE`)
            .all(serial);
        const health = db
            .prepare("SELECT * FROM health_snapshots WHERE serial=? ORDER BY checked_at DESC LIMIT 20")
            .all(serial)
            .map((row) => ({ ...row, payload_json: parseJson(String(row.payload_json ?? "{}")) }));
        const projectChanges = db
            .prepare("SELECT * FROM project_changes WHERE serial=? ORDER BY created_at DESC LIMIT 50")
            .all(serial)
            .map((row) => ({ ...row, details_json: parseJson(String(row.details_json ?? "{}")) }));
        const availability = db
            .prepare("SELECT state,error_code,latency_ms,created_at FROM availability_events WHERE serial=? ORDER BY created_at DESC LIMIT 200")
            .all(serial);
        return { server, devices, health, projectChanges, availability };
    });
    app.get("/api/miniservers/:serial/onewire", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const serial = serialSchema.parse(request.params.serial);
        const query = z.object({ range: z.enum(["24h", "7d", "30d", "13m", "5y"]).default("30d") }).parse(request.query);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        return readOneWireHistory(db, serial, query.range);
    });
    app.post("/api/miniservers", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = z
            .object({
            serial: serialSchema,
            type: z.string().min(1).max(80),
            project: z.string().min(1).max(250),
            registered: z.string().max(40).default(""),
            username: z.string().max(200).optional(),
            password: z.string().max(1024).optional(),
            targetFirmware: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
            notes: z.string().max(5000).default(""),
            folderId: z.string().uuid().nullable().optional(),
        })
            .parse(request.body);
        if (input.folderId && !db.prepare("SELECT 1 AS ok FROM project_folders WHERE id=?").get(input.folderId)) {
            return reply.code(404).send({ error: "Vybraná složka neexistuje.", code: "FOLDER_NOT_FOUND" });
        }
        const now = new Date().toISOString();
        try {
            db.prepare(`INSERT INTO miniservers(serial,type,project,registered,credential_source,access_policy,target_firmware,notes,folder_id,created_at,updated_at)
         VALUES(?,?,?,?,'manual','managed',?,?,?,?,?)`).run(input.serial, input.type, input.project, input.registered, input.targetFirmware, input.notes, input.folderId ?? null, now, now);
        }
        catch (error) {
            if (error.message.includes("UNIQUE")) {
                return reply.code(409).send({ error: "Miniserver s tímto SN už existuje.", code: "DUPLICATE_SERIAL" });
            }
            throw error;
        }
        if (input.username && input.password)
            saveCredentials(db, input.serial, input.username, input.password);
        audit(db, "miniserver.created", user.id, input.serial, { type: input.type, project: input.project });
        return reply.code(201).send({ server: getMiniserver(db, input.serial) });
    });
    app.patch("/api/miniservers/:serial", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const input = z
            .object({
            type: z.string().min(1).max(80).optional(),
            project: z.string().min(1).max(250).optional(),
            registered: z.string().max(40).optional(),
            targetFirmware: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/).optional(),
            firmwarePolicy: z.enum(["follow_stable", "pinned"]).optional(),
            firmwareChannel: z.enum(["stable", "beta", "alpha"]).optional(),
            accessPolicy: z.enum(["managed", "manual", "no_access"]).optional(),
            excluded: z.boolean().optional(),
            manualOnly: z.boolean().optional(),
            notes: z.string().max(5000).optional(),
            folderId: z.string().uuid().nullable().optional(),
            gatewayRole: z.enum(["automatic", "standalone", "gateway", "client"]).optional(),
            gatewaySerial: serialSchema.nullable().optional(),
            localUrl: z.string().url().refine(isSafeLocalMiniserverUrl, "Povolená je jen privátní LAN IP bez cesty a parametrů.").nullable().optional(),
        })
            .strict()
            .parse(request.body);
        const existingServer = getMiniserver(db, serial);
        if (!existingServer)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        if (input.firmwarePolicy === "pinned") {
            if (!existingServer.currentFirmware) {
                return reply.code(409).send({ error: "Firmware nelze připnout, dokud nebyla zjištěna aktuální verze.", code: "FIRMWARE_UNKNOWN" });
            }
            input.targetFirmware = existingServer.currentFirmware;
        }
        else if (input.firmwarePolicy === "follow_stable") {
            const release = db.prepare("SELECT value FROM settings WHERE key='target_firmware'").get();
            if (!release?.value) {
                return reply.code(409).send({ error: "Oficiální stabilní verze zatím nebyla načtena.", code: "RELEASE_UNKNOWN" });
            }
            input.targetFirmware = release.value;
            input.firmwareChannel = "stable";
        }
        if (input.folderId && !db.prepare("SELECT 1 AS ok FROM project_folders WHERE id=?").get(input.folderId)) {
            return reply.code(404).send({ error: "Vybraná složka neexistuje.", code: "FOLDER_NOT_FOUND" });
        }
        if (input.gatewaySerial) {
            if (input.gatewaySerial === serial)
                return reply.code(400).send({ error: "Miniserver nemůže být vlastní Gateway.", code: "INVALID_GATEWAY" });
            const gateway = getMiniserver(db, input.gatewaySerial);
            if (!gateway)
                return reply.code(404).send({ error: "Vybraná Gateway neexistuje.", code: "GATEWAY_NOT_FOUND" });
            if (gateway.gatewayRole !== "gateway")
                return reply.code(409).send({ error: "Vybraný Miniserver nemá roli Gateway.", code: "INVALID_GATEWAY_ROLE" });
        }
        const fields = [];
        const values = [];
        const columns = {
            type: "type",
            project: "project",
            registered: "registered",
            targetFirmware: "target_firmware",
            firmwarePolicy: "firmware_policy",
            firmwareChannel: "firmware_channel",
            accessPolicy: "access_policy",
            excluded: "excluded",
            manualOnly: "manual_only",
            notes: "notes",
            folderId: "folder_id",
            localUrl: "local_url",
        };
        for (const [key, value] of Object.entries(input).filter(([key]) => !["gatewayRole", "gatewaySerial"].includes(key))) {
            fields.push(`${columns[key]}=?`);
            values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
        }
        if (input.gatewayRole) {
            if (input.gatewayRole === "automatic") {
                fields.push("gateway_role=COALESCE(gateway_detected_role,'unknown')", "gateway_role_source=CASE WHEN gateway_detected_role IS NULL THEN 'unknown' ELSE 'webservice' END", "gateway_serial=NULL");
            }
            else {
                fields.push("gateway_role=?", "gateway_role_source='manual'", "gateway_serial=?");
                values.push(input.gatewayRole, input.gatewayRole === "client" ? input.gatewaySerial ?? null : null);
            }
        }
        else if (input.gatewaySerial !== undefined) {
            fields.push("gateway_role='client'", "gateway_role_source='manual'", "gateway_serial=?");
            values.push(input.gatewaySerial);
        }
        if (fields.length) {
            fields.push("updated_at=?");
            values.push(new Date().toISOString(), serial);
            db.prepare(`UPDATE miniservers SET ${fields.join(",")} WHERE serial=?`).run(...values);
            audit(db, "miniserver.updated", user.id, serial, { fields: Object.keys(input) });
        }
        return { server: getMiniserver(db, serial) };
    });
    app.put("/api/miniservers/:serial/credentials", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const input = z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(1024) }).parse(request.body);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        saveCredentials(db, serial, input.username, input.password);
        audit(db, "credentials.updated", user.id, serial, {});
        return { ok: true };
    });
    app.get("/api/miniservers/:serial/credentials", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const query = z.object({ purpose: z.enum(["copy", "copy-password", "open-loxone-app"]) }).parse(request.query);
        const credentials = getStoredCredentials(db, serial);
        if (!credentials)
            return reply.code(404).send({ error: "U Miniserveru nejsou uložené přístupy.", code: "CREDENTIALS_MISSING" });
        reply.header("Cache-Control", "no-store, max-age=0");
        reply.header("Pragma", "no-cache");
        audit(db, `credentials.${query.purpose}`, user.id, serial, {});
        if (query.purpose === "copy-password")
            return { password: credentials.password };
        return credentials;
    });
    app.get("/api/miniservers/:serial/config-bridge", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const server = getMiniserver(db, serial);
        if (!server)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const credentials = getStoredCredentials(db, serial);
        const release = exactConfigRelease(db, server.currentFirmware);
        const agent = preferredLauncherAgent(db, user.id);
        reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache");
        audit(db, "miniserver.config_bridge_opened", user.id, serial, { firmware: server.currentFirmware, hasCredentials: Boolean(credentials) });
        return {
            serial,
            project: server.project,
            firmware: server.currentFirmware,
            connectionUrl: server.connectionUrl ?? `https://dns.loxonecloud.com/${serial}`,
            configUrl: release?.configUrl ?? null,
            configVersion: release?.version ?? server.currentFirmware,
            currentProgramUrl: user.role === "admin" ? `/api/miniservers/${serial}/exports/current-program` : null,
            credentials,
            automaticLaunchSupported: Boolean(agent?.available && !agent.updateRequired && server.currentFirmware && credentials),
            launcherAgent: agent,
            launchNote: agent?.available && agent.updateRequired
                ? `Windows Launcher ${agent.helperVersion ?? "neznámé verze"} je zastaralý. V Nastavení stáhněte aktualizaci ${agent.latestHelperVersion}; instalátor zachová existující spárování.`
                : agent?.available
                    ? "Windows Launcher je online. Přístup se mu předá pouze pro tento jednorázový požadavek a neukládá se do fronty ani do příkazové řádky."
                    : "Windows Launcher není online. Spusťte ho ve Windows nebo ho nejprve spárujte v Nastavení.",
        };
    });
    app.post("/api/miniservers/:serial/config-launch", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const server = getMiniserver(db, serial);
        if (!server)
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        if (!server.currentFirmware)
            return reply.code(409).send({ error: "Nejdřív je potřeba zjistit firmware Miniserveru.", code: "FIRMWARE_UNKNOWN" });
        if (!getStoredCredentials(db, serial))
            return reply.code(409).send({ error: "U Miniserveru nejsou uložené přístupy.", code: "CREDENTIALS_MISSING" });
        const agent = preferredLauncherAgent(db, user.id);
        if (!agent?.available)
            return reply.code(409).send({ error: "Windows Launcher není online.", code: "AGENT_OFFLINE" });
        if (agent.updateRequired) {
            return reply.code(409).send({
                error: `Windows Launcher ${agent.helperVersion ?? "neznámé verze"} je zastaralý. V Nastavení stáhněte a spusťte aktualizaci ${agent.latestHelperVersion}; spárování se zachová.`,
                code: "AGENT_UPDATE_REQUIRED",
                requiredHelperVersion: agent.requiredHelperVersion,
                latestHelperVersion: agent.latestHelperVersion,
            });
        }
        const release = exactConfigRelease(db, server.currentFirmware);
        const job = createConfigLaunchJob(db, {
            serial,
            actorUserId: user.id,
            agentId: agent.id,
            requiredVersion: server.currentFirmware,
            connectionUrl: server.connectionUrl ?? `https://dns.loxonecloud.com/${serial}`,
            configUrl: release?.configUrl ?? null,
        });
        audit(db, "config_launcher.launch_requested", user.id, serial, { jobId: job.id, agentId: agent.id, requiredVersion: job.requiredVersion });
        reply.header("Cache-Control", "no-store, max-age=0");
        return reply.code(202).send({ job });
    });
    app.post("/api/miniservers/:serial/check", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const existing = jobs.findActive("bulk_check", null) ?? jobs.findActive("check", serial);
        return reply.code(202).send({ job: existing ?? jobs.enqueueUnique("check", serial, user.id) });
    });
    app.post("/api/fleet/check", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        return reply.code(202).send({ job: jobs.enqueueUnique("bulk_check", null, user.id, { manual: true }) });
    });
    app.post("/api/fleet/discover-topology", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        return reply.code(202).send({ job: jobs.enqueueUnique("topology_discovery", null, user.id, { manual: true }) });
    });
    app.post("/api/miniservers/:serial/update", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "firmware_update", serial, {})) {
            return reply.code(428).send({ error: "Aktualizaci je nutné znovu potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        return reply.code(202).send({ job: jobs.enqueue("firmware_update", serial, user.id, {}, new Date(Date.now() + 30 * 60_000).toISOString()) });
    });
    app.post("/api/fleet/update", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const payload = { all: true };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "bulk_firmware_update", null, payload)) {
            return reply.code(428).send({ error: "Hromadnou aktualizaci je nutné znovu potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        return reply.code(202).send({ job: jobs.enqueue("bulk_firmware_update", null, user.id, payload) });
    });
    app.post("/api/miniservers/:serial/reboot", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "miniserver_reboot", serial, {})) {
            return reply.code(428).send({ error: "Restart je nutné znovu potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        return reply.code(202).send({ job: jobs.enqueue("miniserver_reboot", serial, user.id) });
    });
    app.post("/api/miniservers/:serial/sd-test", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        return reply.code(202).send({ job: jobs.enqueue("sd_test", serial, user.id) });
    });
    app.post("/api/miniservers/:serial/health", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        return { health: await jobs.runHealthNow(serial, user.id) };
    });
    app.post("/api/miniservers/:serial/project-sync", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        return reply.code(202).send({ job: jobs.enqueue("project_sync", serial, user.id) });
    });
    app.post("/api/miniservers/:serial/jwt", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const input = z.object({ permission: z.number().int().min(1).max(255).default(2) }).parse(request.body ?? {});
        const result = await obtainJwt(db, serial, input.permission);
        audit(db, "jwt.created", user.id, serial, { permission: input.permission, validUntil: result.validUntil });
        return result;
    });
    app.post("/api/miniservers/:serial/devices/:deviceSerial/:command", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const params = z
            .object({ serial: serialSchema, deviceSerial: z.string().regex(/^[A-Fa-f0-9]{6,16}$/), command: z.enum(["reboot", "update", "identify"]) })
            .parse(request.params);
        const device = db
            .prepare("SELECT source,device_index FROM device_inventory WHERE serial=? AND device_serial=?")
            .get(params.serial, params.deviceSerial.toUpperCase());
        if (!device)
            return reply.code(404).send({ error: "Prvek nebyl nalezen v posledním ověřeném stavu.", code: "DEVICE_NOT_FOUND" });
        const payload = {
            command: params.command,
            deviceSerial: params.deviceSerial.toUpperCase(),
            source: device.source === "extension" ? "extension" : "device",
            deviceIndex: device.device_index ?? null,
        };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), `device_${params.command}`, params.serial, payload)) {
            return reply.code(428).send({ error: "Zásah do prvku je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await deviceCommand(db, params.serial, { serial: payload.deviceSerial, source: payload.source, deviceIndex: payload.deviceIndex }, params.command);
        audit(db, `device.${params.command}`, user.id, params.serial, payload);
        return { ok: true, result };
    });
    app.get("/api/miniservers/:serial/log", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const log = await readDefinitionLog(db, serial);
        audit(db, "miniserver.log_read", user.id, serial, {});
        reply.header("Cache-Control", "no-store");
        return { log };
    });
    app.get("/api/miniservers/:serial/exports/manifest", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const manifest = await readExportManifest(db, serial);
        audit(db, "miniserver.export_manifest_read", user.id, serial, {
            legacyStatistics: manifest.legacyCount,
            v2Statistics: manifest.v2Count,
        });
        reply.header("Cache-Control", "no-store, max-age=0");
        return { manifest };
    });
    app.get("/api/miniservers/:serial/exports/loxapp3", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const exported = await readLoxApp3Export(db, serial);
        audit(db, "miniserver.loxapp3_exported", user.id, serial, { bytes: exported.content.length });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/system-statistics", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const exported = await readSystemStatisticsExport(db, serial);
        audit(db, "miniserver.system_statistics_exported", user.id, serial, { bytes: exported.content.length });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/statistics-catalog", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const exported = await readStatisticsCatalogExport(db, serial);
        audit(db, "miniserver.statistics_catalog_exported", user.id, serial, { bytes: exported.content.length });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/statistics/legacy/:uuid/:period", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const params = z.object({
            serial: serialSchema,
            uuid: z.string().regex(/^[A-Fa-f0-9-]{20,40}$/),
            period: z.string().regex(/^\d{6}(?:\d{2})?$/),
        }).parse(request.params);
        if (!getMiniserver(db, params.serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const exported = await readLegacyStatisticExport(db, params.serial, params.uuid, params.period);
        audit(db, "miniserver.legacy_statistics_exported", user.id, params.serial, {
            controlUuid: params.uuid,
            period: params.period,
            bytes: exported.content.length,
        });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/statistics/v2/:uuid", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const params = z.object({ serial: serialSchema, uuid: z.string().regex(/^[A-Fa-f0-9-]{20,40}$/) }).parse(request.params);
        const query = z.object({
            from: z.coerce.number().int().min(0),
            to: z.coerce.number().int().min(1),
            dataPointUnit: z.enum(["all", "hour", "day", "month", "year"]),
            groupId: z.coerce.number().int().min(0),
            outputName: z.string().trim().min(1).max(200),
        }).parse(request.query);
        if (!getMiniserver(db, params.serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const exported = await readV2StatisticExport(db, params.serial, { controlUuid: params.uuid, ...query });
        audit(db, "miniserver.v2_statistics_exported", user.id, params.serial, {
            controlUuid: params.uuid,
            from: query.from,
            to: query.to,
            dataPointUnit: query.dataPointUnit,
            groupId: query.groupId,
            outputName: query.outputName,
            bytes: exported.content.length,
        });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/current-program", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        let exported;
        try {
            exported = await readCurrentProgramArchive(db, serial);
            recordOperationalResult(db, {
                kind: "program_backup", serial, actorUserId: user.id, state: "succeeded",
                message: "Aktuální program Miniserveru byl bezpečně stažen.",
                details: { mode: "current", fileName: exported.fileName },
            });
        }
        catch (error) {
            const failure = operationalFailure(error);
            recordOperationalResult(db, {
                kind: "program_backup", serial, actorUserId: user.id, state: "failed",
                message: failure.message, errorCode: failure.code, details: { mode: "current" },
            });
            throw error;
        }
        audit(db, "miniserver.current_program_exported", user.id, serial, {
            fileName: exported.fileName,
            bytes: exported.content.length,
            verification: exported.programVerification ?? "unknown",
            sourceFileName: exported.sourceFileName ?? null,
        });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/exports/program-backups", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        if (!getMiniserver(db, serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        const items = await readProgramBackupCatalog(db, serial);
        audit(db, "miniserver.program_backup_catalog_read", user.id, serial, { count: items.length });
        return { items };
    });
    app.get("/api/miniservers/:serial/exports/program-backups/:fileName", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const params = z.object({ serial: serialSchema, fileName: programBackupFileSchema }).parse(request.params);
        if (!getMiniserver(db, params.serial))
            return reply.code(404).send({ error: "Miniserver nebyl nalezen.", code: "NOT_FOUND" });
        let exported;
        try {
            exported = await readSelectedProgramBackup(db, params.serial, params.fileName);
            recordOperationalResult(db, {
                kind: "program_backup", serial: params.serial, actorUserId: user.id, state: "succeeded",
                message: "Vybraná záloha programu byla bezpečně stažena.",
                details: { mode: "selected", fileName: params.fileName },
            });
        }
        catch (error) {
            const failure = operationalFailure(error);
            recordOperationalResult(db, {
                kind: "program_backup", serial: params.serial, actorUserId: user.id, state: "failed",
                message: failure.message, errorCode: failure.code, details: { mode: "selected", fileName: params.fileName },
            });
            throw error;
        }
        audit(db, "miniserver.program_backup_exported", user.id, params.serial, {
            fileName: exported.fileName,
            sourceFileName: exported.sourceFileName ?? params.fileName,
            bytes: exported.content.length,
            verification: exported.programVerification,
        });
        return sendDownload(reply, exported);
    });
    app.get("/api/miniservers/:serial/controls/:uuid/history", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const params = request.params;
        const serial = serialSchema.parse(params.serial);
        return { history: await readControlHistory(db, serial, params.uuid) };
    });
    app.get("/api/miniservers/:serial/statistics/:uuid", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const params = request.params;
        const serial = serialSchema.parse(params.serial);
        return { info: await readStatisticInfo(db, serial, params.uuid) };
    });
    app.post("/api/miniservers/:serial/statistics/:uuid/raw", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const params = request.params;
        const serial = serialSchema.parse(params.serial);
        const input = z
            .object({
            from: z.number().int().min(0),
            to: z.number().int().min(1),
            dataPointUnit: z.enum(["all", "hour", "day", "month", "year"]),
            groupId: z.number().int().min(0),
            outputName: z.string().trim().min(1).max(200),
        })
            .parse(request.body);
        const exported = await readV2StatisticExport(db, serial, { controlUuid: params.uuid, ...input });
        audit(db, "miniserver.v2_statistics_exported", user.id, serial, {
            controlUuid: params.uuid,
            ...input,
            bytes: exported.content.length,
            compatibilityRoute: true,
        });
        return sendDownload(reply, exported);
    });
    app.post("/api/miniservers/:serial/user-audit", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const result = await readUserAudit(db, serial);
        const id = randomUUID();
        db.prepare(`INSERT INTO user_audit_snapshots(id,serial,created_at,admin_count,weak_password_count,expired_count,summary_json,payload_json)
       VALUES(?,?,?,?,?,?,?,?)`).run(id, serial, new Date().toISOString(), result.summary.admins, result.summary.weakPasswords, result.summary.expired, JSON.stringify(result.summary), encryptSecret(JSON.stringify(result), config.masterKey, `${serial}:user-audit:${id}`));
        audit(db, "miniserver.user_audit", user.id, serial, result.summary);
        return result;
    });
    app.get("/api/miniservers/:serial/operating-modes", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const serial = serialSchema.parse(request.params.serial);
        const [modes, schedule] = await Promise.all([readOperatingModes(db, serial), readOperatingModeSchedule(db, serial)]);
        return { modes, schedule };
    });
    app.post("/api/miniservers/:serial/operating-modes/:operation", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const params = z.object({ serial: serialSchema, operation: z.enum(["create", "update", "delete"]) }).parse(request.params);
        const entry = z
            .object({
            uuid: z.string().optional(),
            name: z.string().min(1).max(120),
            operatingMode: z.number().int(),
            calendarMode: z.number().int().min(0).max(5),
            calendarModeAttributes: z.string().regex(/^[0-9/-]{1,64}$/),
        })
            .parse(request.body);
        const payload = { operation: params.operation, entry };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "operating_mode_change", params.serial, payload)) {
            return reply.code(428).send({ error: "Změnu kalendáře je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const result = await mutateOperatingModeSchedule(db, params.serial, params.operation, entry);
        audit(db, `operating_mode.${params.operation}`, user.id, params.serial, { entry: { ...entry, name: entry.name } });
        return { ok: true, result };
    });
    app.get("/api/lan-targets", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: db.prepare("SELECT * FROM lan_probe_targets ORDER BY name").all() };
    });
    app.post("/api/lan-targets", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const input = z.object({ serial: serialSchema, name: z.string().min(1).max(120), address: z.union([z.ipv4(), z.ipv6()]), webservice: z.string().startsWith("/") }).parse(request.body);
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare("INSERT INTO lan_probe_targets(id,serial,name,url,enabled,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(id, input.serial, input.name, JSON.stringify({ address: input.address, webservice: input.webservice }), now, now);
        audit(db, "lan_target.created", user.id, input.serial, { id, name: input.name, address: input.address });
        return reply.code(201).send({ id });
    });
    app.post("/api/lan-targets/:id/probe", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const row = db.prepare("SELECT * FROM lan_probe_targets WHERE id=? AND enabled=1").get(id);
        if (!row)
            return reply.code(404).send({ error: "LAN cíl nebyl nalezen.", code: "NOT_FOUND" });
        const payload = { targetId: id };
        if (!requireConfirmation(db, user, confirmationHeader(request.headers), "lan_probe", row.serial, payload)) {
            return reply.code(428).send({ error: "LAN dotaz je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        const target = JSON.parse(row.url);
        const result = await sendAllowedWebservice(db, row.serial, target);
        audit(db, "lan_target.probed", user.id, row.serial, { id, name: row.name, address: target.address });
        return { result };
    });
    app.post("/api/miniservers/:serial/service-bundle", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const serial = serialSchema.parse(request.params.serial);
        const input = z.object({ anonymized: z.boolean().default(true) }).parse(request.body ?? {});
        let bundle;
        try {
            bundle = await createServiceBundle(db, serial, user.id, input.anonymized);
            recordOperationalResult(db, {
                kind: "service_bundle", serial, actorUserId: user.id, state: "succeeded",
                message: "Servisní balíček byl vytvořen.", details: { anonymized: input.anonymized, bundleId: bundle.id },
            });
        }
        catch (error) {
            const failure = operationalFailure(error);
            recordOperationalResult(db, {
                kind: "service_bundle", serial, actorUserId: user.id, state: "failed",
                message: failure.message, errorCode: failure.code, details: { anonymized: input.anonymized },
            });
            throw error;
        }
        return reply.code(201).send({ id: bundle.id, fileName: bundle.fileName, sha256: bundle.sha256, size: bundle.size, expiresAt: bundle.expiresAt });
    });
    app.get("/api/service-bundles/:id/download", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const id = z.string().uuid().parse(request.params.id);
        const bundle = getServiceBundle(db, id);
        if (!bundle)
            return reply.code(404).send({ error: "Balíček neexistuje nebo vypršel.", code: "NOT_FOUND" });
        audit(db, "service_bundle.downloaded", user.id, null, { id, sha256: bundle.sha256 });
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="${bundle.fileName.replace(/["\r\n]/g, "")}"`);
        reply.header("Cache-Control", "no-store");
        return reply.send(serviceBundleStream(bundle));
    });
    app.get("/api/jobs", async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
        return { items: jobs.list(query.limit) };
    });
    app.get("/api/jobs/:id", async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        const id = z.string().uuid().parse(request.params.id);
        const job = jobs.get(id);
        if (!job)
            return reply.code(404).send({ error: "Úloha nebyla nalezena.", code: "NOT_FOUND" });
        const steps = db.prepare("SELECT step,state,message,created_at AS createdAt FROM action_steps WHERE job_id=? ORDER BY id").all(id);
        return { job, steps };
    });
    app.get("/api/audit", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        const items = db
            .prepare(`SELECT a.id,u.email AS actor,a.action,a.serial,a.details,a.created_at AS createdAt
         FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 500`)
            .all()
            .map((row) => ({ ...row, details: parseJson(String(row.details ?? "{}")) }));
        return { items };
    });
    app.get("/api/users", async (request, reply) => {
        const user = requireRole(request, reply, ["admin"]);
        if (!user)
            return;
        return {
            items: db
                .prepare("SELECT id,email,display_name AS displayName,role,immutable,active,mfa_enabled AS mfaEnabled,avatar_mime AS avatarMime,avatar_updated_at AS avatarUpdatedAt,last_login_at AS lastLoginAt,created_at AS createdAt FROM users ORDER BY display_name COLLATE NOCASE,email")
                .all()
                .map((row) => {
                const user = row;
                return {
                    ...user,
                    immutable: user.immutable === 1,
                    active: user.active === 1,
                    mfaEnabled: user.mfaEnabled === 1,
                    hasAvatar: Boolean(user.avatarMime),
                };
            }),
        };
    });
    app.get("/api/users/:id/avatar", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        const id = appUserIdSchema.parse(request.params.id);
        const row = db.prepare("SELECT avatar_mime AS mime,avatar_data AS data,avatar_updated_at AS updatedAt FROM users WHERE id=?").get(id);
        if (!row?.mime || !row.data)
            return reply.code(404).send({ error: "Profilová fotografie není nastavena.", code: "AVATAR_NOT_FOUND" });
        const image = Buffer.from(row.data, "base64");
        return reply
            .header("Cache-Control", "private, no-store")
            .header("Content-Length", String(image.length))
            .header("X-Content-Type-Options", "nosniff")
            .type(row.mime)
            .send(image);
    });
    const saveUserAvatar = (targetUserId, body, actorUserId, reply) => {
        const target = db.prepare("SELECT id FROM users WHERE id=?").get(targetUserId);
        if (!target)
            return reply.code(404).send({ error: "Uživatel nebyl nalezen.", code: "USER_NOT_FOUND" });
        const input = z.object({
            mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
            data: z.string().min(8).max(1_500_000),
        }).strict().parse(body);
        const data = Buffer.from(input.data, "base64");
        if (!data.length || data.length > 1_000_000)
            return reply.code(413).send({ error: "Fotografie může mít nejvýše 1 MB.", code: "AVATAR_TOO_LARGE" });
        const valid = input.mime === "image/png" ? data.subarray(0, 4).toString("hex") === "89504e47"
            : input.mime === "image/jpeg" ? data.subarray(0, 3).toString("hex") === "ffd8ff"
                : data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
        if (!valid)
            return reply.code(400).send({ error: "Soubor neodpovídá zvolenému formátu fotografie.", code: "INVALID_AVATAR" });
        const now = new Date().toISOString();
        db.prepare("UPDATE users SET avatar_mime=?,avatar_data=?,avatar_updated_at=?,updated_at=? WHERE id=?")
            .run(input.mime, data.toString("base64"), now, now, targetUserId);
        audit(db, "user.avatar_updated", actorUserId, null, { targetUserId, mime: input.mime, bytes: data.length });
        return { ok: true, avatarUpdatedAt: now };
    };
    const removeUserAvatar = (targetUserId, actorUserId, reply) => {
        const target = db.prepare("SELECT id FROM users WHERE id=?").get(targetUserId);
        if (!target)
            return reply.code(404).send({ error: "Uživatel nebyl nalezen.", code: "USER_NOT_FOUND" });
        const now = new Date().toISOString();
        db.prepare("UPDATE users SET avatar_mime=NULL,avatar_data=NULL,avatar_updated_at=NULL,updated_at=? WHERE id=?")
            .run(now, targetUserId);
        audit(db, "user.avatar_removed", actorUserId, null, { targetUserId });
        return { ok: true };
    };
    app.put("/api/users/me/avatar", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        return saveUserAvatar(user.id, request.body, user.id, reply);
    });
    app.delete("/api/users/me/avatar", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        return removeUserAvatar(user.id, user.id, reply);
    });
    app.put("/api/users/:id/avatar", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const id = appUserIdSchema.parse(request.params.id);
        return saveUserAvatar(id, request.body, actor.id, reply);
    });
    app.delete("/api/users/:id/avatar", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const id = appUserIdSchema.parse(request.params.id);
        return removeUserAvatar(id, actor.id, reply);
    });
    app.post("/api/users", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const input = z
            .object({
            email: z.string().email().refine((value) => value.toLowerCase().endsWith("@evorasmart.cz"), "Je povolený jen firemní e-mail."),
            displayName: z.string().trim().max(160).refine((value) => [...value].every((character) => {
                const code = character.charCodeAt(0);
                return code >= 32 && code !== 127;
            })).default(""),
            password: z.string().min(14).max(256),
            role: z.enum(["admin", "technician", "viewer"]),
        })
            .parse(request.body);
        const id = randomUUID();
        const now = new Date().toISOString();
        try {
            db.prepare(`INSERT INTO users(id,email,display_name,password_hash,role,immutable,active,created_at,updated_at,mfa_enabled)
         VALUES(?,?,?,?,?,0,1,?,?,0)`).run(id, input.email.toLowerCase(), input.displayName, await hashPassword(input.password), input.role, now, now);
        }
        catch (error) {
            if (error.message.includes("UNIQUE"))
                return reply.code(409).send({ error: "Uživatel už existuje.", code: "DUPLICATE_USER" });
            throw error;
        }
        audit(db, "user.created", actor.id, null, { id, email: input.email.toLowerCase(), role: input.role });
        return reply.code(201).send({ id });
    });
    app.patch("/api/users/:id", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const id = appUserIdSchema.parse(request.params.id);
        const input = z.object({
            displayName: z.string().trim().max(160).refine((value) => [...value].every((character) => {
                const code = character.charCodeAt(0);
                return code >= 32 && code !== 127;
            })).optional(),
            role: z.enum(["admin", "technician", "viewer"]).optional(),
            active: z.boolean().optional(),
        }).parse(request.body);
        const target = db.prepare("SELECT immutable FROM users WHERE id=?").get(id);
        if (!target)
            return reply.code(404).send({ error: "Uživatel nebyl nalezen.", code: "NOT_FOUND" });
        if (target.immutable === 1 && (input.role || input.active === false)) {
            return reply.code(409).send({ error: "Hlavní správce nejde deaktivovat ani změnit.", code: "IMMUTABLE_USER" });
        }
        if (input.displayName !== undefined)
            db.prepare("UPDATE users SET display_name=?,updated_at=? WHERE id=?").run(input.displayName, new Date().toISOString(), id);
        if (input.role)
            db.prepare("UPDATE users SET role=?,updated_at=? WHERE id=?").run(input.role, new Date().toISOString(), id);
        if (input.active !== undefined)
            db.prepare("UPDATE users SET active=?,updated_at=? WHERE id=?").run(input.active ? 1 : 0, new Date().toISOString(), id);
        if (input.active === false)
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        audit(db, "user.updated", actor.id, null, { id, fields: Object.keys(input) });
        return { ok: true };
    });
    app.delete("/api/users/:id", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const id = appUserIdSchema.parse(request.params.id);
        const target = db.prepare("SELECT email,immutable FROM users WHERE id=?").get(id);
        if (!target)
            return reply.code(404).send({ error: "Uživatel nebyl nalezen.", code: "NOT_FOUND" });
        if (target.immutable === 1 || id === actor.id)
            return reply.code(409).send({ error: "Tento účet nejde smazat.", code: "IMMUTABLE_USER" });
        const payload = { userId: id };
        if (!requireConfirmation(db, actor, confirmationHeader(request.headers), "app_user_delete", null, payload)) {
            return reply.code(428).send({ error: "Smazání uživatele je nutné potvrdit heslem.", code: "CONFIRMATION_REQUIRED" });
        }
        transaction(db, () => db.prepare("DELETE FROM users WHERE id=?").run(id));
        audit(db, "user.deleted", actor.id, null, { id, email: target.email });
        return { ok: true };
    });
    app.get("/api/capabilities", async (request, reply) => {
        if (!requireRole(request, reply, ["admin"]))
            return;
        return {
            features: {
                remoteConnect: true,
                legacyCloudDnsFallback: true,
                jwt: true,
                firmware: true,
                health: true,
                sdTest: true,
                definitionLog: true,
                devices: true,
                loxApp3: true,
                history: true,
                statistics: true,
                userAudit: true,
                trust: true,
                operatingModeSchedule: true,
                lanWebservice: true,
                serviceBundle: true,
                homeAssistantMonitoring: true,
                mfa: true,
                mcp: false,
            },
            documentation: {
                api: "https://www.loxone.com/enen/kb/api/",
                webservices: "https://www.loxone.com/enen/kb/web-services/",
                appUrlScheme: "https://www.loxone.com/enen/kb/visualisation/",
            },
        };
    });
    app.post("/api/internal/tick", async (request, reply) => {
        if (!config.cronSecret || request.headers.authorization !== `Bearer ${config.cronSecret}`) {
            return reply.code(401).send({ error: "Neplatné oprávnění.", code: "AUTH_REQUIRED" });
        }
        await jobs.tick();
        cleanupServiceBundles(db);
        refreshIncidents(db);
        await processServiceTaskReminders(db);
        return { ok: true };
    });
}
