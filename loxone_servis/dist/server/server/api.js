import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actionPayloadHash, consumeConfirmation, requireRole, requireUser } from "./auth.js";
import { audit, transaction } from "./database.js";
import { config } from "./config.js";
import { encryptSecret, hashPassword } from "./crypto.js";
import { fleetOverview, getMiniserver, getStoredCredentials, listMiniservers, listProjectFolders, listReleaseArchive, saveCredentials } from "./repository.js";
import { deviceCommand, obtainJwt, readControlHistory, readDefinitionLog, readOperatingModes, readOperatingModeSchedule, readStatisticInfo, readUserAudit, sendAllowedWebservice, mutateOperatingModeSchedule, isSafeLocalMiniserverUrl, } from "./loxone/client.js";
import { readCurrentProgramArchive, readExportManifest, readLegacyStatisticExport, readLoxApp3Export, readStatisticsCatalogExport, readSystemStatisticsExport, readV2StatisticExport, } from "./loxone/exports.js";
import { cleanupServiceBundles, createServiceBundle, getServiceBundle, serviceBundleStream } from "./service-bundle.js";
import { replaceProjectFolderMembers } from "./folder-members.js";
import { wouldCreateProjectFolderCycle } from "../shared/folder-hierarchy.js";
import { clearHomeAssistantSecrets, getHomeAssistantCredentials, getHomeAssistantInstance, listHomeAssistantInstances, normalizeHomeAssistantUrl, saveHomeAssistantSecrets, } from "./home-assistant.js";
import { readOneWireHistory } from "./onewire-history.js";
const serialSchema = z.string().regex(/^[A-Fa-f0-9]{12}$/).transform((value) => value.toUpperCase());
const homeAssistantIdSchema = z.string().uuid();
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
export async function registerApi(app, db, jobs) {
    app.get("/api/overview", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return fleetOverview(db);
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
    app.get("/api/folders", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listProjectFolders(db) };
    });
    app.get("/api/home-assistant", async (request, reply) => {
        if (!requireUser(request, reply))
            return;
        return { items: listHomeAssistantInstances(db) };
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
            parentId: z.string().uuid().nullable().default(null),
        }).strict().parse(request.body);
        if (input.parentId && !db.prepare("SELECT 1 AS ok FROM project_folders WHERE id=?").get(input.parentId)) {
            return reply.code(404).send({ error: "Nadřazená složka nebyla nalezena.", code: "PARENT_FOLDER_NOT_FOUND" });
        }
        const now = new Date().toISOString();
        const id = randomUUID();
        const sortOrder = Number(db.prepare("SELECT COALESCE(MAX(sort_order),-10)+10 AS value FROM project_folders").get().value);
        try {
            db.prepare("INSERT INTO project_folders(id,name,description,parent_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
                .run(id, input.name, input.description, input.parentId, sortOrder, now, now);
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
        const fields = [];
        const values = [];
        const columns = { name: "name", description: "description", parentId: "parent_id", sortOrder: "sort_order" };
        for (const [key, value] of Object.entries(input)) {
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
                json_extract(payload_json,'$.temperatureUpdatedAt') AS temperatureUpdatedAt
         FROM device_inventory WHERE serial=? ORDER BY online,name COLLATE NOCASE`)
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
        const exported = await readCurrentProgramArchive(db, serial);
        audit(db, "miniserver.current_program_exported", user.id, serial, {
            fileName: exported.fileName,
            bytes: exported.content.length,
            verifiedAgainstLiveLoxApp3: true,
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
        const bundle = await createServiceBundle(db, serial, user.id, input.anonymized);
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
                .prepare("SELECT id,email,role,immutable,active,mfa_enabled AS mfaEnabled,last_login_at AS lastLoginAt,created_at AS createdAt FROM users ORDER BY email")
                .all()
                .map((row) => {
                const user = row;
                return {
                    ...user,
                    immutable: user.immutable === 1,
                    active: user.active === 1,
                    mfaEnabled: user.mfaEnabled === 1,
                };
            }),
        };
    });
    app.post("/api/users", async (request, reply) => {
        const actor = requireRole(request, reply, ["admin"]);
        if (!actor)
            return;
        const input = z
            .object({
            email: z.string().email().refine((value) => value.toLowerCase().endsWith("@evorasmart.cz"), "Je povolený jen firemní e-mail."),
            password: z.string().min(14).max(256),
            role: z.enum(["admin", "technician", "viewer"]),
        })
            .parse(request.body);
        const id = randomUUID();
        const now = new Date().toISOString();
        try {
            db.prepare(`INSERT INTO users(id,email,password_hash,role,immutable,active,created_at,updated_at,mfa_enabled)
         VALUES(?,?,?,?,0,1,?,?,0)`).run(id, input.email.toLowerCase(), await hashPassword(input.password), input.role, now, now);
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
        const id = z.string().uuid().parse(request.params.id);
        const input = z.object({ role: z.enum(["admin", "technician", "viewer"]).optional(), active: z.boolean().optional() }).parse(request.body);
        const target = db.prepare("SELECT immutable FROM users WHERE id=?").get(id);
        if (!target)
            return reply.code(404).send({ error: "Uživatel nebyl nalezen.", code: "NOT_FOUND" });
        if (target.immutable === 1 && (input.role || input.active === false)) {
            return reply.code(409).send({ error: "Hlavní správce nejde deaktivovat ani změnit.", code: "IMMUTABLE_USER" });
        }
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
        const id = z.string().uuid().parse(request.params.id);
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
        return { ok: true };
    });
}
