import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { transaction } from "./database.js";
import { notifyHomeAssistant } from "./home-assistant.js";
import { getMiniserverProfile } from "./miniserver-profiles.js";
import { markExcelTaskForWriteback } from "./service-tasks-excel.js";
const MAX_TASK_ATTACHMENTS = 20;
const MAX_TASK_ATTACHMENT_BYTES = 64 * 1024 * 1024;
function displayName(name, email = "") { return name?.trim() || email; }
function jsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function comments(db, taskId) {
    return db.prepare(`SELECT c.id,c.body,c.author_user_id,c.created_at,u.display_name,u.email FROM service_task_comments c
     JOIN users u ON u.id=c.author_user_id WHERE c.task_id=? ORDER BY c.created_at`).all(taskId).map((row) => ({
        id: row.id, body: row.body, authorUserId: row.author_user_id, authorName: displayName(row.display_name, row.email), createdAt: row.created_at,
    }));
}
function attachments(db, taskId) {
    return db.prepare(`SELECT a.id,a.file_name,a.mime_type,a.size_bytes,a.uploaded_by,a.created_at,u.display_name,u.email
     FROM service_task_attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.task_id=? ORDER BY a.created_at`).all(taskId).map((row) => ({
        id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), uploadedBy: row.uploaded_by,
        uploadedByName: displayName(row.display_name, row.email), createdAt: row.created_at,
    }));
}
function events(db, taskId) {
    return db.prepare(`SELECT e.id,e.event_type,e.message,e.author_user_id,e.details_json,e.created_at,u.display_name,u.email
     FROM service_task_events e LEFT JOIN users u ON u.id=e.author_user_id WHERE e.task_id=? ORDER BY e.created_at DESC,e.id DESC`).all(taskId).map((row) => ({
        id: Number(row.id), type: row.event_type, message: row.message, authorUserId: row.author_user_id,
        authorName: row.author_user_id ? displayName(row.display_name, row.email ?? "") : "Evora Smart Hub",
        createdAt: row.created_at, details: jsonObject(row.details_json),
    }));
}
function tags(db, taskId) {
    return db.prepare(`SELECT t.id,t.name,t.color FROM tags t JOIN service_task_tags st ON st.tag_id=t.id
     WHERE st.task_id=? ORDER BY t.name COLLATE NOCASE`).all(taskId);
}
function mapTask(db, row, detail) {
    return {
        id: row.id, number: Number(row.number), publicId: row.public_id, title: row.title, description: row.description,
        status: row.status, priority: row.priority, assigneeUserId: row.assignee_user_id,
        assigneeName: displayName(row.assignee_name), createdByUserId: row.created_by_user_id,
        createdByName: displayName(row.created_by_name), serial: row.serial, project: row.project, incidentId: row.incident_id,
        source: row.source, contactName: row.contact_name, contactPhone: row.contact_phone, contactEmail: row.contact_email,
        dueAt: row.due_at, reminderAt: row.reminder_at, completedAt: row.completed_at, tags: tags(db, row.id),
        comments: detail ? comments(db, row.id) : [], attachments: detail ? attachments(db, row.id) : [],
        events: detail ? events(db, row.id) : [], createdAt: row.created_at, updatedAt: row.updated_at,
        externalSync: row.excel_sheet_name && row.excel_row_number && row.excel_writeback_state && row.excel_last_imported_at ? {
            source: "excel", sheetName: row.excel_sheet_name, rowNumber: Number(row.excel_row_number), state: row.excel_writeback_state,
            message: row.excel_writeback_error || (row.excel_writeback_state === "synced"
                ? `Dokončení bylo zapsáno do původního Excelu a ověřeno${row.excel_last_writeback_at ? ` · ${row.excel_last_writeback_at}` : ""}.`
                : "Úkol je načtený ze sdíleného Excelu; změny v Hubu se nyní do Excelu nezapisují."),
            lastImportedAt: row.excel_last_imported_at,
        } : null,
    };
}
const taskSelect = `SELECT t.*,m.project,
  COALESCE(NULLIF(assignee.display_name,''),assignee.email,'') AS assignee_name,
  COALESCE(NULLIF(creator.display_name,''),creator.email,'') AS created_by_name,
  excel.sheet_name AS excel_sheet_name,excel.row_number AS excel_row_number,
  excel.writeback_state AS excel_writeback_state,excel.writeback_error AS excel_writeback_error,
  excel.last_imported_at AS excel_last_imported_at,excel.last_writeback_at AS excel_last_writeback_at
  FROM service_tasks t
  LEFT JOIN miniservers m ON m.serial=t.serial
  LEFT JOIN users assignee ON assignee.id=t.assignee_user_id
  JOIN users creator ON creator.id=t.created_by_user_id
  LEFT JOIN service_task_excel_links excel ON excel.task_id=t.id`;
export function listServiceTasks(db) {
    return db.prepare(`${taskSelect} ORDER BY
    CASE t.status WHEN 'in_progress' THEN 0 WHEN 'new' THEN 1 WHEN 'planned' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    COALESCE(t.due_at,'9999-12-31'),t.updated_at DESC`).all().map((row) => mapTask(db, row, false));
}
export function getServiceTask(db, id) {
    const row = db.prepare(`${taskSelect} WHERE t.id=?`).get(id);
    return row ? mapTask(db, row, true) : null;
}
function setTaskTags(db, taskId, input, now) {
    db.prepare("DELETE FROM service_task_tags WHERE task_id=?").run(taskId);
    const upsert = db.prepare(`INSERT INTO tags(id,name,color,created_at,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(name) DO UPDATE SET color=excluded.color,updated_at=excluded.updated_at`);
    const find = db.prepare("SELECT id FROM tags WHERE name=? COLLATE NOCASE");
    const link = db.prepare("INSERT OR IGNORE INTO service_task_tags(task_id,tag_id) VALUES(?,?)");
    for (const tag of input.slice(0, 20)) {
        upsert.run(tag.id || randomUUID(), tag.name, tag.color, now, now);
        link.run(taskId, find.get(tag.name).id);
    }
}
function event(db, taskId, type, message, actor, details = {}) {
    db.prepare("INSERT INTO service_task_events(task_id,event_type,message,author_user_id,details_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(taskId, type, message, actor, JSON.stringify(details), new Date().toISOString());
}
export function createServiceTask(db, actorUserId, input) {
    const now = new Date().toISOString();
    const id = randomUUID();
    let number = 0;
    transaction(db, () => {
        number = Number(db.prepare("SELECT COALESCE(MAX(number),0)+1 AS next FROM service_tasks").get().next);
        const publicId = `ESH-${new Date(now).getFullYear()}-${String(number).padStart(4, "0")}`;
        const profile = input.serial ? getMiniserverProfile(db, input.serial) : null;
        db.prepare(`INSERT INTO service_tasks(id,number,public_id,title,description,status,priority,assignee_user_id,created_by_user_id,
       serial,incident_id,source,contact_name,contact_phone,contact_email,due_at,reminder_at,created_at,updated_at)
       VALUES(?,?,?, ?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, number, publicId, input.title, input.description, input.priority, input.assigneeUserId, actorUserId, input.serial, input.incidentId, input.source, input.contactName || profile?.contactName || "", input.contactPhone || profile?.contactPhone || "", input.contactEmail || profile?.contactEmail || "", input.dueAt, input.reminderAt, now, now);
        setTaskTags(db, id, input.tags, now);
        event(db, id, "created", "Servisní úkol byl vytvořen.", actorUserId, { priority: input.priority });
    });
    return getServiceTask(db, id);
}
export function updateServiceTask(db, id, actorUserId, input) {
    const current = getServiceTask(db, id);
    if (!current)
        return null;
    const now = new Date().toISOString();
    transaction(db, () => {
        const fields = [];
        const values = [];
        const columns = {
            title: "title", description: "description", priority: "priority", assigneeUserId: "assignee_user_id", serial: "serial",
            source: "source", contactName: "contact_name", contactPhone: "contact_phone", contactEmail: "contact_email",
            dueAt: "due_at", reminderAt: "reminder_at", status: "status",
        };
        for (const [key, column] of Object.entries(columns)) {
            if (!(key in input))
                continue;
            fields.push(`${column}=?`);
            values.push(input[key] ?? null);
        }
        if (input.status !== undefined) {
            fields.push("completed_at=?");
            values.push(input.status === "done" ? current.completedAt ?? now : null);
        }
        if ("reminderAt" in input) {
            fields.push("reminder_sent_at=?");
            values.push(null);
        }
        fields.push("updated_at=?");
        values.push(now);
        db.prepare(`UPDATE service_tasks SET ${fields.join(",")} WHERE id=?`).run(...values, id);
        if (input.tags)
            setTaskTags(db, id, input.tags, now);
        event(db, id, "updated", input.status && input.status !== current.status ? `Stav změněn na ${input.status}.` : "Servisní úkol byl upraven.", actorUserId, input);
    });
    if (input.status === "done" && current.status !== "done" && current.externalSync)
        markExcelTaskForWriteback(db, id);
    return getServiceTask(db, id);
}
export function addServiceTaskComment(db, taskId, actorUserId, body) {
    if (!getServiceTask(db, taskId))
        return null;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO service_task_comments(id,task_id,author_user_id,body,created_at) VALUES(?,?,?,?,?)")
        .run(randomUUID(), taskId, actorUserId, body, now);
    db.prepare("UPDATE service_tasks SET updated_at=? WHERE id=?").run(now, taskId);
    event(db, taskId, "comment", "Přidán komentář.", actorUserId);
    return getServiceTask(db, taskId);
}
export function addServiceTaskAttachment(db, taskId, actorUserId, input) {
    if (!getServiceTask(db, taskId))
        return null;
    const usage = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes FROM service_task_attachments WHERE task_id=?").get(taskId);
    if (Number(usage.count) >= MAX_TASK_ATTACHMENTS || Number(usage.bytes) + input.data.length > MAX_TASK_ATTACHMENT_BYTES) {
        throw Object.assign(new Error("Úkol může obsahovat nejvýše 20 příloh a celkem 64 MB dat."), { code: "ATTACHMENT_LIMIT" });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const encrypted = encryptSecret(input.data.toString("base64"), config.masterKey, `service-task-attachment:${id}`);
    db.prepare("INSERT INTO service_task_attachments(id,task_id,file_name,mime_type,size_bytes,data_encrypted,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)").run(id, taskId, input.fileName, input.mimeType, input.data.length, encrypted, actorUserId, now);
    db.prepare("UPDATE service_tasks SET updated_at=? WHERE id=?").run(now, taskId);
    event(db, taskId, "attachment", `Přiložen soubor ${input.fileName}.`, actorUserId, { attachmentId: id, sizeBytes: input.data.length });
    return getServiceTask(db, taskId);
}
export function readServiceTaskAttachment(db, taskId, id) {
    const row = db.prepare("SELECT file_name,mime_type,data_encrypted FROM service_task_attachments WHERE id=? AND task_id=?")
        .get(id, taskId);
    if (!row)
        return null;
    return {
        fileName: row.file_name,
        mimeType: row.mime_type,
        data: Buffer.from(decryptSecret(row.data_encrypted, config.masterKey, `service-task-attachment:${id}`), "base64"),
    };
}
export async function processServiceTaskReminders(db) {
    const now = new Date().toISOString();
    const rows = db.prepare(`SELECT t.id,t.public_id,t.title,t.due_at,u.display_name,u.email FROM service_tasks t
     LEFT JOIN users u ON u.id=t.assignee_user_id
     WHERE t.status NOT IN ('done','cancelled') AND t.reminder_at IS NOT NULL AND t.reminder_at<=? AND t.reminder_sent_at IS NULL`).all(now);
    for (const row of rows) {
        const assignee = displayName(row.display_name, row.email ?? "") || "bez přiřazení";
        const delivered = await notifyHomeAssistant({
            id: `service_task_${row.id}`, title: `${row.public_id}: ${row.title}`,
            message: `Připomínka servisního úkolu. Odpovědná osoba: ${assignee}${row.due_at ? `. Termín: ${row.due_at}` : ""}.`,
            path: `/?page=service_tasks&task=${encodeURIComponent(row.id)}`,
        });
        if (!delivered)
            continue;
        db.prepare("UPDATE service_tasks SET reminder_sent_at=?,updated_at=? WHERE id=? AND reminder_sent_at IS NULL").run(now, now, row.id);
        event(db, row.id, "reminder", "Bylo odesláno upozornění na termín.", null);
    }
}
