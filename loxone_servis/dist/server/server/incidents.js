import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { getMiniserverProfile } from "./miniserver-profiles.js";
export function recordOperationalAttempt(db, input) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO action_jobs(
      id,kind,serial,state,progress,message,payload_json,result_json,error_code,actor_user_id,created_at,started_at,finished_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.kind, input.serial, input.state, input.state === "succeeded" ? 100 : 0, input.message, JSON.stringify(input.details ?? {}), "{}", input.errorCode ?? null, input.actorUserId, now, now, now);
    return id;
}
function json(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function incidentEvents(db, incidentId) {
    return db.prepare(`SELECT e.id,e.event_type,e.message,e.author_user_id,e.details_json,e.created_at,u.display_name,u.email
     FROM incident_events e LEFT JOIN users u ON u.id=e.author_user_id
     WHERE e.incident_id=? ORDER BY e.created_at DESC,e.id DESC`).all(incidentId).map((row) => ({
        id: Number(row.id), type: row.event_type, message: row.message, authorUserId: row.author_user_id,
        authorName: row.author_user_id ? row.display_name?.trim() || row.email || "Uživatel" : "Evora Smart Hub",
        createdAt: row.created_at, details: json(row.details_json),
    }));
}
function mapIncident(db, row, detail) {
    return {
        id: row.id, fingerprint: row.fingerprint, type: row.type, severity: row.severity, status: row.status,
        title: row.title, summary: row.summary, serial: row.serial, project: row.project,
        assigneeUserId: row.assignee_user_id, assigneeName: row.assignee_name ?? "", slaDueAt: row.sla_due_at,
        firstDetectedAt: row.first_detected_at, lastDetectedAt: row.last_detected_at, resolvedAt: row.resolved_at,
        source: row.source, details: json(row.details_json), events: detail ? incidentEvents(db, row.id) : [],
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
const select = `SELECT i.*,m.project,
  COALESCE(NULLIF(u.display_name,''),u.email,'') AS assignee_name
  FROM incidents i LEFT JOIN miniservers m ON m.serial=i.serial LEFT JOIN users u ON u.id=i.assignee_user_id`;
export function listIncidents(db) {
    return db.prepare(`${select} ORDER BY
    CASE i.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
    CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    i.last_detected_at DESC`).all().map((row) => mapIncident(db, row, false));
}
export function getIncident(db, id) {
    const row = db.prepare(`${select} WHERE i.id=?`).get(id);
    return row ? mapIncident(db, row, true) : null;
}
function addEvent(db, incidentId, type, message, actor, details = {}) {
    db.prepare("INSERT INTO incident_events(incident_id,event_type,message,author_user_id,details_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(incidentId, type, message, actor, JSON.stringify(details), new Date().toISOString());
}
function slaDue(db, detection, timestamp) {
    const profileHours = detection.serial ? getMiniserverProfile(db, detection.serial)?.slaHours : null;
    const hours = profileHours ?? (detection.severity === "critical" ? 4 : detection.severity === "warning" ? 24 : 72);
    return new Date(Date.parse(timestamp) + hours * 60 * 60_000).toISOString();
}
function upsertDetection(db, detection, now) {
    const current = db.prepare("SELECT id,status,severity,title,summary FROM incidents WHERE fingerprint=?")
        .get(detection.fingerprint);
    if (!current) {
        const id = randomUUID();
        db.prepare(`INSERT INTO incidents(id,fingerprint,type,severity,status,title,summary,serial,ha_instance_id,launcher_agent_id,
       sla_due_at,first_detected_at,last_detected_at,source,details_json,created_at,updated_at)
       VALUES(?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, detection.fingerprint, detection.type, detection.severity, detection.title, detection.summary, detection.serial ?? null, detection.haInstanceId ?? null, detection.launcherAgentId ?? null, slaDue(db, detection, now), now, now, detection.source, JSON.stringify(detection.details ?? {}), now, now);
        addEvent(db, id, "detected", "Hub založil incident z monitoringu.", null, detection.details);
        return id;
    }
    const reopen = current.status === "resolved";
    db.prepare(`UPDATE incidents SET type=?,severity=?,status=?,title=?,summary=?,serial=?,ha_instance_id=?,launcher_agent_id=?,
     last_detected_at=?,resolved_at=NULL,source=?,details_json=?,updated_at=?,sla_due_at=CASE WHEN ? THEN ? ELSE sla_due_at END WHERE id=?`).run(detection.type, detection.severity, reopen ? "open" : current.status, detection.title, detection.summary, detection.serial ?? null, detection.haInstanceId ?? null, detection.launcherAgentId ?? null, now, detection.source, JSON.stringify(detection.details ?? {}), now, reopen ? 1 : 0, slaDue(db, detection, now), current.id);
    if (reopen)
        addEvent(db, current.id, "reopened", "Podmínka incidentu se znovu objevila.", null, detection.details);
    else if (current.severity !== detection.severity || current.title !== detection.title || current.summary !== detection.summary) {
        addEvent(db, current.id, "changed", "Monitoring aktualizoval stav incidentu.", null, detection.details);
    }
    return current.id;
}
function availabilityDetections(db) {
    const rows = db.prepare("SELECT serial,project,connection_state,consecutive_failures,last_error,last_checked_at FROM miniservers WHERE excluded=0").all();
    const detections = [];
    for (const row of rows) {
        if (row.connection_state === "no_access")
            detections.push({
                fingerprint: `authentication_rejected:${row.serial}`, type: "authentication_rejected", severity: "critical",
                title: `${row.project}: přihlášení odmítnuto`, summary: "Miniserver odmítl uložené přihlašovací údaje.", serial: row.serial,
                source: "miniserver", details: { errorCode: row.last_error, checkedAt: row.last_checked_at }, autoResolve: true,
            });
        if (["unavailable", "error"].includes(row.connection_state))
            detections.push({
                fingerprint: `miniserver_unavailable:${row.serial}`, type: "miniserver_unavailable", severity: "critical",
                title: `${row.project}: Miniserver neodpovídá`, summary: `Poslední kontrola selhala${row.last_error ? ` (${row.last_error})` : ""}.`,
                serial: row.serial, source: "miniserver", details: { errorCode: row.last_error, checkedAt: row.last_checked_at }, autoResolve: true,
            });
        const changes = db.prepare(`WITH recent AS (
        SELECT state,LAG(state) OVER (ORDER BY created_at,id) AS previous_state
        FROM availability_events WHERE serial=? AND created_at>=?
      ) SELECT COALESCE(SUM(CASE WHEN previous_state IS NOT NULL AND state<>previous_state THEN 1 ELSE 0 END),0) AS count FROM recent`).get(row.serial, new Date(Date.now() - 2 * 60 * 60_000).toISOString());
        if (Number(changes.count) >= 4)
            detections.push({
                fingerprint: `unstable_connection:${row.serial}`, type: "unstable_connection", severity: "warning",
                title: `${row.project}: nestabilní připojení`, summary: `${changes.count} změn dostupnosti během posledních 2 hodin.`,
                serial: row.serial, source: "availability", details: { stateChanges: Number(changes.count), failures: Number(row.consecutive_failures) }, autoResolve: true,
            });
    }
    return detections;
}
function deviceDetections(db) {
    const rows = db.prepare(`SELECT d.serial,m.project,d.device_serial,d.name,d.online,d.first_offline_at,d.payload_json
     FROM device_inventory d JOIN miniservers m ON m.serial=d.serial
     WHERE d.device_serial NOT GLOB '*[^0-9A-F]*' AND length(d.device_serial) BETWEEN 6 AND 16`).all();
    const grouped = new Map();
    for (const row of rows) {
        const group = grouped.get(row.serial) ?? { project: row.project, offline: [], lowBattery: [], weakAir: [] };
        const payload = json(row.payload_json);
        if (row.online === 0 && row.first_offline_at && Date.now() - Date.parse(row.first_offline_at) >= 30 * 60_000)
            group.offline.push(row.name || row.device_serial);
        const battery = Number(payload.batteryPercent);
        if (Number.isFinite(battery) && battery >= 0 && battery <= 15)
            group.lowBattery.push(`${row.name || row.device_serial} (${battery} %)`);
        const rssi = Number(payload.airRssiDb);
        if (Number.isFinite(rssi) && rssi <= -85)
            group.weakAir.push(`${row.name || row.device_serial} (${rssi} dB)`);
        grouped.set(row.serial, group);
    }
    const detections = [];
    for (const [serial, group] of grouped) {
        if (group.offline.length)
            detections.push({
                fingerprint: `device_repeatedly_offline:${serial}`, type: "device_repeatedly_offline", severity: "warning",
                title: `${group.project}: opakovaně offline prvky`, summary: `${group.offline.length} prvků je offline déle než 30 minut.`, serial,
                source: "device_inventory", details: { devices: group.offline.slice(0, 20), count: group.offline.length }, autoResolve: true,
            });
        if (group.lowBattery.length)
            detections.push({
                fingerprint: `low_battery:${serial}`, type: "low_battery", severity: "warning", title: `${group.project}: nízká baterie`,
                summary: `${group.lowBattery.length} prvků má baterii nejvýše 15 %.`, serial, source: "device_inventory",
                details: { devices: group.lowBattery.slice(0, 20), count: group.lowBattery.length }, autoResolve: true,
            });
        if (group.weakAir.length)
            detections.push({
                fingerprint: `weak_air_signal:${serial}`, type: "weak_air_signal", severity: "warning", title: `${group.project}: slabý Air signál`,
                summary: `${group.weakAir.length} prvků má Air signál -85 dB nebo horší.`, serial, source: "device_inventory",
                details: { devices: group.weakAir.slice(0, 20), count: group.weakAir.length }, autoResolve: true,
            });
    }
    return detections;
}
function otherDetections(db) {
    const detections = [];
    const health = db.prepare(`SELECT h.serial,m.project,h.sd_state,h.verdict,h.checked_at FROM health_snapshots h
     JOIN miniservers m ON m.serial=h.serial
     WHERE h.id=(SELECT MAX(x.id) FROM health_snapshots x WHERE x.serial=h.serial)`).all();
    for (const row of health) {
        const value = (row.sd_state ?? "").toLowerCase();
        if (value && !["ok", "good", "healthy", "0"].includes(value))
            detections.push({
                fingerprint: `sd_degradation:${row.serial}`, type: "sd_degradation", severity: "critical",
                title: `${row.project}: zhoršení SD karty`, summary: `Health Check hlásí stav SD: ${row.sd_state}.`, serial: row.serial,
                source: "health", details: { sdState: row.sd_state, verdict: row.verdict, checkedAt: row.checked_at }, autoResolve: true,
            });
    }
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const changes = db.prepare("SELECT c.id,c.serial,c.summary,c.created_at,m.project FROM project_changes c JOIN miniservers m ON m.serial=c.serial WHERE c.created_at>=? ORDER BY c.created_at DESC,c.id DESC").all(since);
    const latestChanges = new Map();
    for (const row of changes)
        if (!latestChanges.has(row.serial))
            latestChanges.set(row.serial, row);
    for (const row of latestChanges.values())
        detections.push({
            fingerprint: `project_changed:${row.serial}`, type: "project_changed", severity: "info", title: `${row.project}: změna projektu`,
            summary: row.summary, serial: row.serial, source: "loxapp3", details: { changeId: row.id, changedAt: row.created_at }, autoResolve: false,
        });
    const operations = db.prepare(`SELECT j.id,j.kind,j.serial,j.state,j.error_code,j.message,j.finished_at,m.project
     FROM action_jobs j LEFT JOIN miniservers m ON m.serial=j.serial
     WHERE j.kind IN ('program_backup','service_bundle') AND j.state IN ('succeeded','failed') AND j.finished_at>=?
     ORDER BY j.finished_at DESC,j.id DESC`).all(since);
    const latestOperations = new Map();
    for (const row of operations) {
        const key = `${row.kind}:${row.serial ?? "fleet"}`;
        if (!latestOperations.has(key))
            latestOperations.set(key, row);
    }
    for (const row of latestOperations.values()) {
        if (row.state !== "failed")
            continue;
        const backup = row.kind === "program_backup";
        detections.push({
            fingerprint: `${backup ? "backup_failed" : "service_bundle_failed"}:${row.serial ?? "fleet"}`,
            type: backup ? "backup_failed" : "service_bundle_failed",
            severity: "warning",
            title: `${row.project ?? row.serial ?? "Flotila"}: ${backup ? "selhání zálohy programu" : "selhání servisního balíčku"}`,
            summary: row.message,
            serial: row.serial,
            source: row.kind,
            details: { jobId: row.id, errorCode: row.error_code, finishedAt: row.finished_at },
            autoResolve: true,
        });
    }
    const launcher = db.prepare(`SELECT j.id,j.serial,j.agent_id,j.message,j.error_code,j.finished_at,m.project FROM config_launch_jobs j
     LEFT JOIN miniservers m ON m.serial=j.serial WHERE j.state IN ('failed','missing_config') AND j.finished_at>=? ORDER BY j.finished_at DESC`).all(since);
    const latestLauncher = new Map();
    for (const row of launcher) {
        const key = `${row.agent_id}:${row.serial}`;
        if (!latestLauncher.has(key))
            latestLauncher.set(key, row);
    }
    for (const row of latestLauncher.values())
        detections.push({
            fingerprint: `launcher_failed:${row.agent_id}:${row.serial}`, type: "launcher_failed", severity: "warning", title: `${row.project ?? row.serial}: Launcher selhal`,
            summary: row.message, serial: row.serial, launcherAgentId: row.agent_id, source: "launcher",
            details: { jobId: row.id, errorCode: row.error_code, finishedAt: row.finished_at }, autoResolve: false,
        });
    const homeAssistant = db.prepare("SELECT id,name,connection_state,auth_state,last_error,last_checked_at FROM home_assistant_instances WHERE monitoring_enabled=1").all();
    for (const row of homeAssistant)
        if (["unavailable", "error", "no_access"].includes(row.connection_state) || row.auth_state === "invalid")
            detections.push({
                fingerprint: `home_assistant_failed:${row.id}`, type: "home_assistant_failed", severity: "critical", title: `${row.name}: Home Assistant není dostupný`,
                summary: row.auth_state === "invalid" ? "Home Assistant odmítl přihlášení." : `Kontrola selhala${row.last_error ? ` (${row.last_error})` : ""}.`,
                haInstanceId: row.id, source: "home_assistant", details: { connectionState: row.connection_state, authState: row.auth_state, errorCode: row.last_error, checkedAt: row.last_checked_at }, autoResolve: true,
            });
    return detections;
}
export function refreshIncidents(db) {
    return transaction(db, () => {
        const now = new Date().toISOString();
        const detections = [...availabilityDetections(db), ...deviceDetections(db), ...otherDetections(db)];
        const activeFingerprints = new Set(detections.map((item) => item.fingerprint));
        for (const detection of detections)
            upsertDetection(db, detection, now);
        const autoTypes = [
            "miniserver_unavailable", "unstable_connection", "authentication_rejected", "sd_degradation",
            "device_repeatedly_offline", "low_battery", "weak_air_signal", "backup_failed", "service_bundle_failed",
            "home_assistant_failed",
        ];
        const open = db.prepare(`SELECT id,fingerprint FROM incidents WHERE status<>'resolved' AND type IN (${autoTypes.map(() => "?").join(",")})`).all(...autoTypes);
        for (const incident of open) {
            if (activeFingerprints.has(incident.fingerprint))
                continue;
            db.prepare("UPDATE incidents SET status='resolved',resolved_at=?,updated_at=? WHERE id=?").run(now, now, incident.id);
            addEvent(db, incident.id, "auto_resolved", "Monitoring potvrdil, že podmínka incidentu už netrvá.", null);
        }
        return listIncidents(db);
    });
}
export function updateIncident(db, id, actorUserId, input) {
    const current = getIncident(db, id);
    if (!current)
        return null;
    const now = new Date().toISOString();
    const fields = [];
    const values = [];
    if (input.status !== undefined) {
        fields.push("status=?", "resolved_at=?");
        values.push(input.status, input.status === "resolved" ? now : null);
    }
    if (input.severity !== undefined) {
        fields.push("severity=?");
        values.push(input.severity);
    }
    if ("assigneeUserId" in input) {
        fields.push("assignee_user_id=?");
        values.push(input.assigneeUserId ?? null);
    }
    if ("slaDueAt" in input) {
        fields.push("sla_due_at=?");
        values.push(input.slaDueAt ?? null);
    }
    if (fields.length) {
        fields.push("updated_at=?");
        values.push(now);
        db.prepare(`UPDATE incidents SET ${fields.join(",")} WHERE id=?`).run(...values, id);
        addEvent(db, id, "updated", input.status && input.status !== current.status ? `Stav změněn na ${input.status}.` : "Incident byl upraven.", actorUserId, input);
    }
    if (input.comment)
        addEvent(db, id, "comment", input.comment, actorUserId);
    return getIncident(db, id);
}
