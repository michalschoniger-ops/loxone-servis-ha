import { randomUUID } from "node:crypto";
import { audit, setSetting, transaction } from "./database.js";
import { checkMiniserver, miniserverCommand, readGatewayTopology, readHealth, readLoxApp3, } from "./loxone/client.js";
import { config } from "./config.js";
import { encryptSecret } from "./crypto.js";
import { firmwareRelation } from "./version.js";
import { notifyHomeAssistant } from "./home-assistant.js";
function mapJob(row) {
    return {
        id: row.id,
        kind: row.kind,
        serial: row.serial,
        state: row.state,
        progress: row.progress,
        message: row.message,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        deadlineAt: row.deadline_at,
        actorEmail: row.actor_email ?? null,
    };
}
function safeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
function updateDevices(db, serial, result, now) {
    const seen = new Set(result.devices.map((device) => device.serial));
    const upsert = db.prepare(`INSERT INTO device_inventory(serial,device_serial,parent_serial,name,type,firmware,online,first_offline_at,last_seen_at,
       system_message,device_index,source,payload_json,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(serial,device_serial) DO UPDATE SET parent_serial=excluded.parent_serial,name=excluded.name,type=excluded.type,
       firmware=excluded.firmware,online=excluded.online,
       first_offline_at=CASE WHEN excluded.online=0 THEN COALESCE(device_inventory.first_offline_at,excluded.first_offline_at) ELSE NULL END,
       last_seen_at=excluded.last_seen_at,system_message=excluded.system_message,device_index=excluded.device_index,
       source=excluded.source,payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
    for (const device of result.devices) {
        upsert.run(serial, device.serial, device.parentSerial, device.name, device.type, device.firmware, device.online ? 1 : 0, device.online ? null : now, device.online ? now : null, device.systemMessage, device.deviceIndex, device.source, "{}", now);
    }
    if (seen.size) {
        for (const row of db.prepare("SELECT device_serial FROM device_inventory WHERE serial=?").all(serial)) {
            if (!seen.has(row.device_serial)) {
                db.prepare("UPDATE device_inventory SET online=0,first_offline_at=COALESCE(first_offline_at,?),updated_at=? WHERE serial=? AND device_serial=?").run(now, now, serial, row.device_serial);
            }
        }
    }
}
function persistCheck(db, serial, result) {
    const now = new Date().toISOString();
    transaction(db, () => {
        db.prepare(`UPDATE miniservers SET current_firmware=COALESCE(?,current_firmware),connection_state=?,last_checked_at=?,last_error=?,
       elements_online=?,elements_total=?,elements_offline_detail=?,elements_checked_at=?,elements_error=?,
       connection_url=COALESCE(?,connection_url),connection_transport=COALESCE(?,connection_transport),
       connection_resolved_at=CASE WHEN ? IS NOT NULL THEN ? ELSE connection_resolved_at END,last_latency_ms=?,
       last_success_at=CASE WHEN ?='online' THEN ? ELSE last_success_at END,
       consecutive_failures=CASE WHEN ?='online' THEN 0 ELSE consecutive_failures+1 END,
       next_check_at=?,updated_at=? WHERE serial=?`).run(result.firmware, result.state, now, result.errorCode, result.elementsOnline, result.elementsTotal, JSON.stringify(result.rawStatusSummary), now, result.elementsTotal === null ? result.errorCode : null, result.connection?.baseUrl ?? null, result.connection?.source ?? null, result.connection?.baseUrl ?? null, now, result.latencyMs, result.state, now, result.state, new Date(Date.now() + config.fullCheckIntervalMinutes * 60_000).toISOString(), now, serial);
        db.prepare("INSERT INTO availability_events(serial,state,error_code,latency_ms,created_at) VALUES(?,?,?,?,?)").run(serial, result.state, result.errorCode, result.latencyMs, now);
        updateDevices(db, serial, result, now);
    });
}
export class JobQueue {
    db;
    running = 0;
    timer = null;
    ticking = false;
    constructor(db) {
        this.db = db;
        db.prepare("UPDATE action_jobs SET state='queued',message='Obnoveno po restartu',started_at=NULL WHERE state='running'").run();
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => void this.tick(), 30_000);
        this.timer.unref();
        void this.tick();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    enqueue(kind, serial, actorUserId, payload = {}, deadlineAt = null) {
        const id = randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`INSERT INTO action_jobs(id,kind,serial,state,progress,message,payload_json,result_json,actor_user_id,created_at,deadline_at)
       VALUES(?,?,?,'queued',0,'Čeká ve frontě',?,'{}',?,?,?)`).run(id, kind, serial, JSON.stringify(payload), actorUserId, now, deadlineAt);
        const job = this.get(id);
        queueMicrotask(() => void this.tick());
        return job;
    }
    get(id) {
        const row = this.db
            .prepare(`SELECT j.*,u.email AS actor_email FROM action_jobs j LEFT JOIN users u ON u.id=j.actor_user_id WHERE j.id=?`)
            .get(id);
        return row ? mapJob(row) : null;
    }
    list(limit = 100) {
        return this.db
            .prepare(`SELECT j.*,u.email AS actor_email FROM action_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
           ORDER BY j.created_at DESC LIMIT ?`)
            .all(Math.max(1, Math.min(500, limit))).map(mapJob);
    }
    async tick(forceFullCheck = false) {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            await this.pollFirmwareUpdates();
            await this.maybeRefreshRelease();
            await this.maybeScheduleFullCheck(forceFullCheck);
            await this.maybeScheduleTopologyDiscovery();
            while (this.running < config.checkConcurrency) {
                const next = this.db
                    .prepare("SELECT * FROM action_jobs WHERE state='queued' ORDER BY created_at LIMIT 1")
                    .get();
                if (!next)
                    break;
                this.running += 1;
                this.db.prepare("UPDATE action_jobs SET state='running',started_at=?,message='Probíhá' WHERE id=? AND state='queued'").run(new Date().toISOString(), next.id);
                void this.execute(next).finally(() => {
                    this.running -= 1;
                    queueMicrotask(() => void this.tick());
                });
            }
        }
        finally {
            this.ticking = false;
        }
    }
    async maybeRefreshRelease() {
        const row = this.db.prepare("SELECT checked_at FROM firmware_releases WHERE channel='stable'").get();
        if (row && Date.now() - Date.parse(row.checked_at) < 6 * 60 * 60_000)
            return;
        const existing = this.db
            .prepare("SELECT 1 AS ok FROM action_jobs WHERE kind='check' AND state IN ('queued','running') AND serial IS NULL")
            .get();
        if (!existing?.ok)
            this.enqueue("check", null, null, { releaseOnly: true });
    }
    async maybeScheduleFullCheck(force) {
        const last = this.db.prepare("SELECT value FROM settings WHERE key='last_full_check_at'").get();
        const due = !last?.value || Date.now() - Date.parse(last.value) >= config.fullCheckIntervalMinutes * 60_000;
        if (!force && !due)
            return;
        const existing = this.db
            .prepare("SELECT 1 AS ok FROM action_jobs WHERE kind='bulk_check' AND state IN ('queued','running')")
            .get();
        if (!existing?.ok)
            this.enqueue("bulk_check", null, null, { scheduled: !force });
    }
    async maybeScheduleTopologyDiscovery() {
        const fleetCheck = this.db
            .prepare("SELECT 1 AS ok FROM action_jobs WHERE kind='bulk_check' AND state IN ('queued','running')")
            .get();
        if (fleetCheck?.ok)
            return;
        const last = this.db.prepare("SELECT value FROM settings WHERE key='last_topology_discovery_at'").get();
        if (last?.value && Date.now() - Date.parse(last.value) < 24 * 60 * 60_000)
            return;
        const existing = this.db
            .prepare("SELECT 1 AS ok FROM action_jobs WHERE kind='topology_discovery' AND state IN ('queued','running')")
            .get();
        if (!existing?.ok)
            this.enqueue("topology_discovery", null, null, { scheduled: true });
    }
    finish(id, state, message, result = {}, errorCode = null) {
        this.db.prepare(`UPDATE action_jobs SET state=?,progress=?,message=?,result_json=?,error_code=?,finished_at=? WHERE id=?`).run(state, state === "succeeded" ? 100 : 0, message, JSON.stringify(result), errorCode, new Date().toISOString(), id);
    }
    step(jobId, step, state, message) {
        this.db.prepare("INSERT INTO action_steps(job_id,step,state,message,created_at) VALUES(?,?,?,?,?)").run(jobId, step, state, message, new Date().toISOString());
    }
    async execute(job) {
        try {
            const payload = safeJson(job.payload_json);
            switch (job.kind) {
                case "check":
                    if (!job.serial && payload.releaseOnly) {
                        const { refreshOfficialReleases } = await import("./release.js");
                        await refreshOfficialReleases(this.db);
                        this.finish(job.id, "succeeded", "Oficiální verze byly aktualizovány.");
                        return;
                    }
                    if (!job.serial)
                        throw new Error("Chybí SN Miniserveru.");
                    await this.executeCheck(job, job.serial);
                    return;
                case "bulk_check":
                    await this.executeBulkCheck(job);
                    return;
                case "firmware_update":
                    if (!job.serial)
                        throw new Error("Chybí SN Miniserveru.");
                    await this.executeFirmwareUpdate(job, job.serial);
                    return;
                case "bulk_firmware_update":
                    await this.executeBulkFirmwareUpdate(job);
                    return;
                case "miniserver_reboot":
                    if (!job.serial)
                        throw new Error("Chybí SN Miniserveru.");
                    await miniserverCommand(this.db, job.serial, "reboot");
                    audit(this.db, "miniserver.reboot_sent", job.actor_user_id, job.serial, { jobId: job.id });
                    this.finish(job.id, "succeeded", "Příkaz restartu byl odeslán.");
                    return;
                case "sd_test":
                    if (!job.serial)
                        throw new Error("Chybí SN Miniserveru.");
                    await this.executeSdTest(job, job.serial);
                    return;
                case "project_sync":
                    if (!job.serial)
                        throw new Error("Chybí SN Miniserveru.");
                    await this.executeProjectSync(job, job.serial);
                    return;
                case "topology_discovery":
                    await this.executeTopologyDiscovery(job);
                    return;
                default:
                    throw new Error(`Úloha ${job.kind} zatím nemá obsluhu.`);
            }
        }
        catch (error) {
            const code = error.code ?? "job_failed";
            this.step(job.id, "error", "failed", error.message);
            this.finish(job.id, "failed", error.message, {}, code);
            audit(this.db, `job.${job.kind}.failed`, job.actor_user_id, job.serial, { jobId: job.id, code });
        }
    }
    async executeCheck(job, serial) {
        this.step(job.id, "resolve", "running", "Ověřuji Remote Connect a přihlášení.");
        const result = await checkMiniserver(this.db, serial);
        persistCheck(this.db, serial, result);
        if (result.state === "online") {
            this.step(job.id, "status", "succeeded", `Firmware ${result.firmware}; prvky ${result.elementsOnline ?? "?"}/${result.elementsTotal ?? "?"}.`);
            this.finish(job.id, "succeeded", `Online, FW ${result.firmware}.`, result);
        }
        else {
            this.finish(job.id, "failed", result.state === "no_access" ? "Miniserver odmítl přihlášení." : "Miniserver není dostupný.", result, result.errorCode);
        }
    }
    async executeBulkCheck(job) {
        const rows = this.db
            .prepare("SELECT serial FROM miniservers ORDER BY serial")
            .all();
        let completed = 0;
        let online = 0;
        for (let offset = 0; offset < rows.length; offset += config.checkConcurrency) {
            const batch = rows.slice(offset, offset + config.checkConcurrency);
            const results = await Promise.all(batch.map(async ({ serial }) => ({ serial, result: await checkMiniserver(this.db, serial) })));
            for (const { serial, result } of results) {
                persistCheck(this.db, serial, result);
                completed += 1;
                if (result.state === "online")
                    online += 1;
            }
            this.db.prepare("UPDATE action_jobs SET progress=?,message=? WHERE id=?").run(Math.floor((completed / Math.max(1, rows.length)) * 100), `Zkontrolováno ${completed}/${rows.length}`, job.id);
        }
        const now = new Date().toISOString();
        setSetting(this.db, "last_full_check_at", now);
        this.finish(job.id, "succeeded", `Kontrola dokončena: ${online}/${rows.length} online.`, { online, total: rows.length });
        audit(this.db, "fleet.check_completed", job.actor_user_id, null, { online, total: rows.length, jobId: job.id });
        if (online < rows.length) {
            void notifyHomeAssistant({
                id: "fleet_problem",
                title: "Loxone Servis: kontrola flotily",
                message: `${online}/${rows.length} Miniserverů odpovědělo. Zkontrolujte nedostupné a chybné přístupy.`,
                path: "/",
            });
        }
    }
    async executeFirmwareUpdate(job, serial) {
        const server = this.db
            .prepare("SELECT current_firmware,target_firmware,excluded,manual_only,firmware_channel FROM miniservers WHERE serial=?")
            .get(serial);
        if (server.excluded || server.manual_only || server.firmware_channel !== "stable") {
            throw new Error("Miniserver je vyřazený z automatických aktualizací.");
        }
        if (firmwareRelation(server.current_firmware, server.target_firmware) !== "older") {
            this.finish(job.id, "succeeded", "Aktualizace není potřeba.");
            return;
        }
        this.step(job.id, "update-command", "running", "Odesílám oficiální příkaz aktualizace.");
        await miniserverCommand(this.db, serial, "update");
        const now = new Date();
        const deadline = new Date(now.getTime() + 30 * 60_000).toISOString();
        this.db.prepare(`UPDATE miniservers SET update_status='waiting',update_started_at=?,update_deadline_at=?,updated_at=? WHERE serial=?`).run(now.toISOString(), deadline, now.toISOString(), serial);
        this.db.prepare(`UPDATE action_jobs SET state='waiting',progress=10,message='Příkaz odeslán, čekám na nový firmware',deadline_at=? WHERE id=?`).run(deadline, job.id);
        audit(this.db, "miniserver.update_sent", job.actor_user_id, serial, { jobId: job.id, target: server.target_firmware });
    }
    async executeBulkFirmwareUpdate(job) {
        const candidates = this.db
            .prepare(`SELECT serial,current_firmware,target_firmware FROM miniservers
         WHERE excluded=0 AND manual_only=0 AND firmware_channel='stable' AND connection_state='online'`)
            .all();
        const outdated = candidates.filter((row) => firmwareRelation(row.current_firmware, row.target_firmware) === "older");
        for (const row of outdated) {
            const existing = this.db
                .prepare("SELECT 1 AS ok FROM action_jobs WHERE serial=? AND kind='firmware_update' AND state IN ('queued','running','waiting')")
                .get(row.serial);
            if (!existing?.ok)
                this.enqueue("firmware_update", row.serial, job.actor_user_id, { parentJobId: job.id });
        }
        this.finish(job.id, "succeeded", `Do fronty přidáno ${outdated.length} aktualizací.`, { count: outdated.length });
        audit(this.db, "fleet.update_queued", job.actor_user_id, null, { count: outdated.length, jobId: job.id });
    }
    async pollFirmwareUpdates() {
        const jobs = this.db
            .prepare("SELECT * FROM action_jobs WHERE kind='firmware_update' AND state='waiting' ORDER BY created_at")
            .all();
        for (const job of jobs.slice(0, config.checkConcurrency)) {
            if (!job.serial)
                continue;
            if (job.deadline_at && Date.parse(job.deadline_at) <= Date.now()) {
                this.db.prepare("UPDATE miniservers SET update_status='failed',updated_at=? WHERE serial=?").run(new Date().toISOString(), job.serial);
                this.finish(job.id, "failed", "Ani po 30 minutách nebyl ověřen cílový firmware.", {}, "update_timeout");
                audit(this.db, "miniserver.update_timeout", job.actor_user_id, job.serial, { jobId: job.id });
                void notifyHomeAssistant({
                    id: `update_${job.serial}`,
                    title: "Loxone aktualizace se nepotvrdila",
                    message: `Miniserver ${job.serial} ani po 30 minutách nepotvrdil cílový firmware.`,
                    path: `/?serial=${job.serial}`,
                });
                continue;
            }
            const result = await checkMiniserver(this.db, job.serial);
            persistCheck(this.db, job.serial, result);
            if (result.state !== "online")
                continue;
            const target = this.db.prepare("SELECT target_firmware FROM miniservers WHERE serial=?").get(job.serial);
            const relation = firmwareRelation(result.firmware, target.target_firmware);
            if (relation === "current" || relation === "newer") {
                this.db.prepare("UPDATE miniservers SET update_status='done',updated_at=? WHERE serial=?").run(new Date().toISOString(), job.serial);
                this.finish(job.id, "succeeded", `Firmware ${result.firmware} ověřen.`, result);
                audit(this.db, "miniserver.update_verified", job.actor_user_id, job.serial, {
                    jobId: job.id,
                    firmware: result.firmware,
                });
            }
            else {
                this.db.prepare("UPDATE action_jobs SET progress=50,message=? WHERE id=?").run(`Miniserver odpovídá na FW ${result.firmware}; čekám na dokončení`, job.id);
            }
        }
    }
    async executeSdTest(job, serial) {
        const result = await miniserverCommand(this.db, serial, "sdtest");
        const text = String(result);
        const usage = Number(text.match(/Usage[^0-9]*(\d+(?:\.\d+)?)/i)?.[1] ?? NaN);
        const verdict = /defect|damage|worn|error/i.test(text) ? "critical" : Number.isFinite(usage) && usage > 60 ? "warning" : "ok";
        this.db.prepare(`INSERT INTO health_snapshots(serial,checked_at,verdict,sd_state,payload_json) VALUES(?,?,?,?,?)`).run(serial, new Date().toISOString(), verdict, text.slice(0, 1000), JSON.stringify({ usage: Number.isFinite(usage) ? usage : null }));
        this.db.prepare("UPDATE miniservers SET health_verdict=?,updated_at=? WHERE serial=?").run(verdict, new Date().toISOString(), serial);
        this.finish(job.id, "succeeded", Number.isFinite(usage) ? `SD test: využití ${usage} %.` : "SD test dokončen.", { usage, verdict });
        audit(this.db, "miniserver.sd_test", job.actor_user_id, serial, { jobId: job.id, usage, verdict });
    }
    async runHealthNow(serial, actorUserId) {
        const health = await readHealth(this.db, serial);
        const cpu = typeof health.cpuLoadNumeric === "number" ? health.cpuLoadNumeric : null;
        const taskCount = typeof health.taskCountNumeric === "number" ? health.taskCountNumeric : null;
        const verdict = cpu !== null && cpu > 90 ? "warning" : "ok";
        const now = new Date().toISOString();
        this.db.prepare(`INSERT INTO health_snapshots(serial,checked_at,verdict,plc_state,cpu_load,task_count,payload_json)
       VALUES(?,?,?,?,?,?,?)`).run(serial, now, verdict, String(health.plcState ?? ""), cpu, taskCount, JSON.stringify(health));
        this.db.prepare("UPDATE miniservers SET health_verdict=?,updated_at=? WHERE serial=?").run(verdict, now, serial);
        audit(this.db, "miniserver.health_read", actorUserId, serial, { verdict });
        return health;
    }
    async executeProjectSync(job, serial) {
        const snapshot = await readLoxApp3(this.db, serial);
        const payload = snapshot.payload;
        const summary = {
            controls: payload.controls && typeof payload.controls === "object" ? Object.keys(payload.controls).length : 0,
            rooms: payload.rooms && typeof payload.rooms === "object" ? Object.keys(payload.rooms).length : 0,
            categories: payload.cats && typeof payload.cats === "object" ? Object.keys(payload.cats).length : 0,
            msName: typeof payload.msInfo === "object" && payload.msInfo ? payload.msInfo.msName ?? null : null,
        };
        const existing = this.db
            .prepare("SELECT id,content_hash FROM project_snapshots WHERE serial=? ORDER BY created_at DESC LIMIT 1")
            .get(serial);
        if (existing?.content_hash === snapshot.hash) {
            this.db.prepare("UPDATE miniservers SET loxapp_version=?,current_project_hash=?,updated_at=? WHERE serial=?").run(snapshot.version, snapshot.hash, new Date().toISOString(), serial);
            this.finish(job.id, "succeeded", "Projekt se od posledního snímku nezměnil.", summary);
            return;
        }
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const encryptedPayload = encryptSecret(JSON.stringify(payload), config.masterKey, `${serial}:project:${id}`);
        transaction(this.db, () => {
            this.db.prepare(`INSERT INTO project_snapshots(id,serial,loxapp_version,content_hash,summary_json,payload_json,created_at)
         VALUES(?,?,?,?,?,?,?)`).run(id, serial, snapshot.version, snapshot.hash, JSON.stringify(summary), encryptedPayload, createdAt);
            this.db.prepare(`INSERT INTO project_changes(serial,from_snapshot_id,to_snapshot_id,change_type,summary,details_json,created_at)
         VALUES(?,?,?,?,?,?,?)`).run(serial, existing?.id ?? null, id, existing ? "changed" : "initial", existing ? "LoxAPP3 se změnil." : "První snímek projektu.", JSON.stringify(summary), createdAt);
            this.db.prepare("UPDATE miniservers SET loxapp_version=?,current_project_hash=?,updated_at=? WHERE serial=?").run(snapshot.version, snapshot.hash, createdAt, serial);
        });
        this.finish(job.id, "succeeded", existing ? "Změna projektu byla zaznamenána." : "Projekt byl načten.", summary);
        audit(this.db, "project.snapshot", job.actor_user_id, serial, { jobId: job.id, changed: Boolean(existing), hash: snapshot.hash });
    }
    async executeTopologyDiscovery(job) {
        const rows = this.db.prepare("SELECT serial FROM miniservers ORDER BY serial").all();
        const knownSerials = new Set(rows.map((row) => row.serial));
        const detected = new Map();
        const errors = [];
        let completed = 0;
        for (let offset = 0; offset < rows.length; offset += config.checkConcurrency) {
            const batch = rows.slice(offset, offset + config.checkConcurrency);
            const results = await Promise.all(batch.map(async ({ serial }) => {
                try {
                    return { serial, topology: await readGatewayTopology(this.db, serial, knownSerials), error: null };
                }
                catch (error) {
                    return { serial, topology: null, error: error.code ?? "topology_failed" };
                }
            }));
            for (const result of results) {
                completed += 1;
                if (result.topology)
                    detected.set(result.serial, result.topology);
                else
                    errors.push({ serial: result.serial, code: result.error ?? "topology_failed" });
            }
            this.db.prepare("UPDATE action_jobs SET progress=?,message=? WHERE id=?").run(Math.floor((completed / Math.max(1, rows.length)) * 100), `Zjištěna struktura ${completed}/${rows.length}`, job.id);
        }
        const owners = new Map();
        for (const [gatewaySerial, topology] of detected) {
            if (topology.role !== "gateway")
                continue;
            for (const clientSerial of topology.referencedSerials) {
                if (detected.get(clientSerial)?.role !== "client")
                    continue;
                owners.set(clientSerial, [...(owners.get(clientSerial) ?? []), gatewaySerial]);
            }
        }
        const now = new Date().toISOString();
        let gateways = 0;
        let clients = 0;
        let standalone = 0;
        let assignedClients = 0;
        let ambiguousClients = 0;
        transaction(this.db, () => {
            for (const [serial, topology] of detected) {
                if (topology.role === "gateway")
                    gateways += 1;
                else if (topology.role === "client")
                    clients += 1;
                else if (topology.role === "standalone")
                    standalone += 1;
                const gatewayCandidates = topology.role === "client" ? owners.get(serial) ?? [] : [];
                const gatewaySerial = gatewayCandidates.length === 1 ? gatewayCandidates[0] : null;
                if (topology.role === "client" && gatewaySerial)
                    assignedClients += 1;
                if (topology.role === "client" && gatewayCandidates.length > 1)
                    ambiguousClients += 1;
                this.db.prepare(`UPDATE miniservers SET gateway_detected_role=?,gateway_detected_at=?,
             gateway_role=CASE WHEN gateway_role_source='manual' THEN gateway_role ELSE ? END,
             gateway_role_source=CASE WHEN gateway_role_source='manual' THEN gateway_role_source ELSE 'webservice' END,
             gateway_serial=CASE WHEN gateway_role_source='manual' THEN gateway_serial ELSE ? END,
             updated_at=? WHERE serial=?`).run(topology.role, now, topology.role, gatewaySerial, now, serial);
            }
            setSetting(this.db, "last_topology_discovery_at", now);
        });
        const result = {
            total: rows.length,
            detected: detected.size,
            errors: errors.length,
            gateways,
            clients,
            standalone,
            assignedClients,
            unassignedClients: clients - assignedClients,
            ambiguousClients,
        };
        this.finish(job.id, "succeeded", `Struktura načtena: ${gateways} Gateway, ${clients} Client, ${errors.length} bez odpovědi.`, result);
        audit(this.db, "fleet.topology_discovered", job.actor_user_id, null, { ...result, jobId: job.id });
    }
}
//# sourceMappingURL=jobs.js.map