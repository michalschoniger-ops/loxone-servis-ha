import { createHash, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { config } from "./config.js";
import { getSetting, setSetting, transaction } from "./database.js";
import { readZipEntry } from "./loxone/exports.js";
import { downloadServiceTaskWorkbookViaGraph, getServiceTaskExcelGraphStatus, serviceTaskExcelGraphReady, ServiceTaskExcelGraphError, } from "./service-tasks-excel-graph.js";
const TARGET_SHEET = "PROGRAMOVÁNÍ - DOKONČOVÁNÍ";
const SYNC_INTERVAL_MS = 60 * 60_000;
const ERROR_RETRY_MS = 5 * 60_000;
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const READ_ONLY_MESSAGE = "Excel se synchronizuje pouze směrem do Hubu; zápis zpět je nyní vypnutý.";
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
});
export class ServiceTaskExcelError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "ServiceTaskExcelError";
    }
}
function array(value) {
    if (value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function nodeText(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string" || typeof value === "number")
        return String(value);
    if (Array.isArray(value))
        return value.map(nodeText).join("");
    const source = record(value);
    if ("t" in source)
        return nodeText(source.t);
    if ("r" in source)
        return nodeText(source.r);
    return Object.entries(source).filter(([key]) => !key.startsWith("@")).map(([, item]) => nodeText(item)).join("");
}
function normalized(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-")
        .replace(/\s+/g, " ").trim().toLocaleLowerCase("cs");
}
function hash(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
function textSimilarity(leftValue, rightValue) {
    const left = normalized(leftValue).slice(0, 500);
    const right = normalized(rightValue).slice(0, 500);
    if (left === right)
        return 1;
    if (!left || !right)
        return 0;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
        }
        previous = current;
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
}
function requestFromExistingTask(link) {
    const prefix = `${link.contact_name}:`;
    return link.title.startsWith(prefix) ? link.title.slice(prefix.length).trim() : link.title;
}
function taskIdentitySimilarity(link, task) {
    const place = textSimilarity(link.contact_name, task.identityPlace);
    const request = textSimilarity(requestFromExistingTask(link), task.identityRequest);
    const combined = textSimilarity(`${link.contact_name}\n${requestFromExistingTask(link)}`, `${task.identityPlace}\n${task.identityRequest}`);
    return Math.max(combined, place * 0.35 + request * 0.65);
}
function entry(workbook, name) {
    const result = readZipEntry(workbook, name, MAX_XML_BYTES);
    if (!result)
        throw new ServiceTaskExcelError("Excel nemá očekávanou vnitřní strukturu.", "WORKBOOK_ENTRY_MISSING");
    return result;
}
function relationshipTarget(workbook, relationshipId) {
    const document = record(parser.parse(entry(workbook, "xl/_rels/workbook.xml.rels").toString("utf8")));
    const relationships = array(record(document.Relationships).Relationship);
    const relationship = relationships.find((item) => String(record(item)["@Id"] ?? "") === relationshipId);
    const target = String(record(relationship)["@Target"] ?? "").replaceAll("\\", "/");
    const fullPath = target.startsWith("/xl/") ? target.slice(1) : `xl/${target.replace(/^\/+/, "")}`;
    if (!/^xl\/[A-Za-z0-9_./-]+$/.test(fullPath) || fullPath.includes("../")) {
        throw new ServiceTaskExcelError("Excel obsahuje neplatnou cestu k listu.", "WORKBOOK_RELATIONSHIP_INVALID");
    }
    return fullPath;
}
function sharedStrings(workbook) {
    const raw = readZipEntry(workbook, "xl/sharedStrings.xml", MAX_XML_BYTES);
    if (!raw)
        return [];
    const document = record(parser.parse(raw.toString("utf8")));
    return array(record(document.sst).si).map(nodeText);
}
function columnIndex(reference) {
    const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
    let result = 0;
    for (const letter of letters)
        result = result * 26 + letter.charCodeAt(0) - 64;
    return result - 1;
}
function cellValue(cellValue, strings) {
    const cell = record(cellValue);
    const type = String(cell["@t"] ?? "");
    if (type === "inlineStr")
        return nodeText(cell.is).trim();
    const value = nodeText(cell.v).trim();
    if (type === "s")
        return strings[Number(value)] ?? "";
    if (type === "b")
        return value === "1" ? "ANO" : "NE";
    return value;
}
function sheetRows(workbook, sheetPath, strings) {
    const document = record(parser.parse(entry(workbook, sheetPath).toString("utf8")));
    const rows = array(record(record(document.worksheet).sheetData).row);
    return rows.map((rowValue, index) => {
        const row = record(rowValue);
        const rowNumber = Number(row["@r"] ?? index + 1);
        const values = ["", "", "", "", "", "", "", ""];
        for (const cellValueNode of array(row.c)) {
            const cell = record(cellValueNode);
            const position = columnIndex(String(cell["@r"] ?? ""));
            if (position >= 0 && position < values.length)
                values[position] = cellValue(cell, strings).trim();
        }
        return { rowNumber, values };
    });
}
export function parseServiceTaskWorkbook(workbook) {
    if (workbook.length < 4 || workbook.readUInt32LE(0) !== 0x04034b50) {
        throw new ServiceTaskExcelError("Stažený soubor není platný Excel XLSX.", "WORKBOOK_INVALID");
    }
    const document = record(parser.parse(entry(workbook, "xl/workbook.xml").toString("utf8")));
    const sheets = array(record(record(document.workbook).sheets).sheet);
    const target = sheets.find((item) => normalized(String(record(item)["@name"] ?? "")) === normalized(TARGET_SHEET));
    if (!target)
        throw new ServiceTaskExcelError(`V Excelu chybí list „${TARGET_SHEET}“.`, "SHEET_MISSING");
    const sheetName = String(record(target)["@name"] ?? TARGET_SHEET);
    const relationshipId = String(record(target)["@id"] ?? "");
    if (!relationshipId)
        throw new ServiceTaskExcelError("Excel nemá vazbu na požadovaný list.", "SHEET_RELATIONSHIP_MISSING");
    const rows = sheetRows(workbook, relationshipTarget(workbook, relationshipId), sharedStrings(workbook));
    const header = rows.find((row) => row.rowNumber === 1)?.values ?? [];
    const expected = ["datum zapsani", "datum potreby dokonceni", "misto realizace", "pozadavek"];
    if (!expected.every((value, index) => normalized(String(header[index] ?? "")) === value)) {
        throw new ServiceTaskExcelError("List má jiné sloupce než očekávané úkoly.", "SHEET_SCHEMA_MISMATCH");
    }
    const finishIndex = rows.findIndex((row) => row.rowNumber > 1
        && normalized(row.values[0]) === "hotovo"
        && row.values.slice(1).every((value) => !value.trim()));
    const active = (finishIndex >= 0 ? rows.slice(0, finishIndex) : rows)
        .filter((row) => row.rowNumber > 1 && row.values[3].trim());
    return { sheetName, rows: active };
}
function excelDate(value) {
    const serial = Number(value.replace(",", "."));
    if (Number.isFinite(serial) && serial > 10_000 && serial < 100_000) {
        return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString();
    }
    const match = value.trim().match(/^(\d{1,2})[./]\s*(\d{1,2})[./]\s*(\d{4})$/);
    if (match)
        return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))).toISOString();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function taskStatus(values) {
    const state = normalized([values[4], values[6], values[7]].join(" "));
    if (/\b(hotovo|dokonceno|uzavreno|splneno)\b/.test(state))
        return "done";
    if (/\b(ceka|cekame|objednano|pozastaven|az bude|po dodani)\b/.test(state))
        return "waiting";
    if (/\b(resi se|rozprac|probiha|pracuji|domluveno)\b/.test(state))
        return "in_progress";
    return "new";
}
function taskPriority(values) {
    const text = normalized(values.join(" "));
    if (!/neni akutni|není akutní/.test(values.join(" ").toLocaleLowerCase("cs")) && /\b(urgent|akutni|ihned|havar)\b/.test(text))
        return "urgent";
    if (/\b(nutne|co nejdrive|priorit)\b/.test(text))
        return "high";
    return "normal";
}
function matchingAssignee(db, value) {
    const needle = normalized(value);
    if (!needle)
        return null;
    const aliases = needle.includes("michal") || needle.includes("misa") ? ["michal", "schoniger"]
        : needle.includes("luky") || needle.includes("lukas") ? ["lukas", "majer"]
            : needle.includes("jirka") || needle.includes("jiri") ? ["jiri", "vaverka"] : [];
    const users = db.prepare("SELECT id,email,display_name FROM users WHERE active=1 ORDER BY immutable DESC,email")
        .all();
    for (const user of users) {
        const candidate = normalized(`${user.display_name} ${user.email}`);
        if (aliases.some((alias) => candidate.includes(alias)))
            return user.id;
        const nameParts = normalized(user.display_name).split(" ").filter((part) => part.length > 2);
        if (nameParts.some((part) => needle.includes(part)))
            return user.id;
    }
    return null;
}
function taskFromRow(db, row) {
    const [created, due, place, request, completion, assignee, noteOne, noteTwo] = row.values;
    const cleanPlace = place.replace(/\s+/g, " ").trim() || "Bez místa";
    const cleanRequest = request.replace(/\s+/g, " ").trim();
    const title = `${cleanPlace}: ${cleanRequest}`.slice(0, 240);
    const notes = [
        `Požadavek: ${request.trim()}`,
        completion.trim() ? `Průběh / dokončení: ${completion.trim()}` : "",
        assignee.trim() ? `Kdo řeší: ${assignee.trim()}` : "",
        noteOne.trim() ? `Poznámka: ${noteOne.trim()}` : "",
        noteTwo.trim() && normalized(noteTwo) !== normalized(noteOne) ? `Další poznámka: ${noteTwo.trim()}` : "",
        `Zdroj: Excel · list ${TARGET_SHEET} · řádek ${row.rowNumber}`,
    ].filter(Boolean);
    return {
        title,
        description: notes.join("\n\n").slice(0, 20_000),
        status: taskStatus(row.values),
        priority: taskPriority(row.values),
        assigneeUserId: matchingAssignee(db, assignee),
        contactName: cleanPlace,
        dueAt: excelDate(due),
        sourceFingerprint: hash(`${normalized(cleanPlace)}\n${normalized(cleanRequest)}`),
        rowHash: hash([created, due, place, request, completion, assignee, noteOne, noteTwo].map(normalized).join("\n")),
        identityPlace: cleanPlace,
        identityRequest: cleanRequest,
    };
}
function systemUserId(db) {
    const row = db.prepare("SELECT id FROM users WHERE active=1 ORDER BY immutable DESC,CASE role WHEN 'admin' THEN 0 ELSE 1 END,created_at,id LIMIT 1").get();
    if (!row?.id)
        throw new ServiceTaskExcelError("Hub nemá aktivního uživatele pro vlastnictví importovaných úkolů.", "IMPORT_OWNER_MISSING");
    return row.id;
}
function insertEvent(db, taskId, message, now) {
    db.prepare("INSERT INTO service_task_events(task_id,event_type,message,author_user_id,details_json,created_at) VALUES(?, 'excel_import', ?, NULL, '{}', ?)")
        .run(taskId, message, now);
}
function createImportedTask(db, ownerId, task, now) {
    const id = randomUUID();
    const number = Number(db.prepare("SELECT COALESCE(MAX(number),0)+1 AS next FROM service_tasks").get().next);
    const publicId = `ESH-${new Date(now).getFullYear()}-${String(number).padStart(4, "0")}`;
    db.prepare(`INSERT INTO service_tasks(id,number,public_id,title,description,status,priority,assignee_user_id,created_by_user_id,
     serial,incident_id,source,contact_name,contact_phone,contact_email,due_at,reminder_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,'excel',?,'','',?,NULL,?,?)`).run(id, number, publicId, task.title, task.description, task.status, task.priority, task.assigneeUserId, ownerId, task.contactName, task.dueAt, now, now);
    insertEvent(db, id, "Úkol byl načten ze sdíleného Excelu.", now);
    return id;
}
function persistRows(db, parsed, workbookHash) {
    const now = new Date().toISOString();
    const ownerId = systemUserId(db);
    const prepared = parsed.rows.map((row) => ({ row, task: taskFromRow(db, row) }));
    const existingLinks = db.prepare(`SELECT links.task_id,links.row_number,links.source_fingerprint,links.row_hash,links.local_status_dirty,
            tasks.contact_name,tasks.title
     FROM service_task_excel_links links JOIN service_tasks tasks ON tasks.id=links.task_id
     WHERE links.sheet_name=?`).all(parsed.sheetName);
    const plannedMatches = new Map();
    const reservedTaskIds = new Set();
    for (const item of prepared) {
        const match = existingLinks
            .filter((link) => link.source_fingerprint === item.task.sourceFingerprint && !reservedTaskIds.has(link.task_id))
            .sort((left, right) => Math.abs(left.row_number - item.row.rowNumber) - Math.abs(right.row_number - item.row.rowNumber))[0];
        if (!match)
            continue;
        plannedMatches.set(item.row.rowNumber, match);
        reservedTaskIds.add(match.task_id);
    }
    const fuzzyCandidates = prepared
        .filter((item) => !plannedMatches.has(item.row.rowNumber))
        .flatMap((item) => existingLinks
        .filter((link) => !reservedTaskIds.has(link.task_id))
        .map((link) => ({
        item,
        link,
        distance: Math.abs(link.row_number - item.row.rowNumber),
        score: taskIdentitySimilarity(link, item.task),
    })))
        .filter((candidate) => candidate.score >= 0.7 && (candidate.distance <= 5 || candidate.score >= 0.9))
        .sort((left, right) => right.score - left.score || left.distance - right.distance || left.item.row.rowNumber - right.item.row.rowNumber);
    for (const candidate of fuzzyCandidates) {
        if (plannedMatches.has(candidate.item.row.rowNumber) || reservedTaskIds.has(candidate.link.task_id))
            continue;
        plannedMatches.set(candidate.item.row.rowNumber, candidate.link);
        reservedTaskIds.add(candidate.link.task_id);
    }
    const seen = new Set();
    let created = 0;
    let updated = 0;
    let completed = 0;
    transaction(db, () => {
        for (const { row, task } of prepared) {
            const link = plannedMatches.get(row.rowNumber);
            let taskId;
            if (!link) {
                taskId = createImportedTask(db, ownerId, task, now);
                created += 1;
            }
            else {
                taskId = link.task_id;
                const status = link.local_status_dirty ? db.prepare("SELECT status FROM service_tasks WHERE id=?").get(taskId).status : task.status;
                db.prepare(`UPDATE service_tasks SET title=?,description=?,status=?,priority=?,assignee_user_id=?,contact_name=?,due_at=?,
           completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at,?) ELSE NULL END,updated_at=? WHERE id=?`).run(task.title, task.description, status, task.priority, task.assigneeUserId, task.contactName, task.dueAt, status, now, now, taskId);
                if (link.row_hash !== task.rowHash)
                    insertEvent(db, taskId, "Úkol byl aktualizován podle změny v Excelu.", now);
                updated += 1;
            }
            seen.add(taskId);
            db.prepare(`INSERT INTO service_task_excel_links(task_id,sheet_name,row_number,source_fingerprint,row_hash,last_imported_at,writeback_state,writeback_error)
         VALUES(?,?,?,?,?,?,'current',NULL)
         ON CONFLICT(task_id) DO UPDATE SET sheet_name=excluded.sheet_name,row_number=excluded.row_number,
           source_fingerprint=excluded.source_fingerprint,row_hash=excluded.row_hash,last_imported_at=excluded.last_imported_at,
           writeback_state=CASE WHEN service_task_excel_links.local_status_dirty=1 THEN service_task_excel_links.writeback_state ELSE 'current' END,
           writeback_error=CASE WHEN service_task_excel_links.local_status_dirty=1 THEN service_task_excel_links.writeback_error ELSE NULL END`).run(taskId, parsed.sheetName, row.rowNumber, task.sourceFingerprint, task.rowHash, now);
        }
        const existing = db.prepare("SELECT task_id,local_status_dirty FROM service_task_excel_links WHERE sheet_name=?").all(parsed.sheetName);
        for (const link of existing) {
            if (seen.has(link.task_id) || link.local_status_dirty)
                continue;
            const result = db.prepare("UPDATE service_tasks SET status='done',completed_at=COALESCE(completed_at,?),updated_at=? WHERE id=? AND status NOT IN ('done','cancelled')").run(now, now, link.task_id);
            if (Number(result.changes) > 0) {
                insertEvent(db, link.task_id, "Řádek už není v aktivní části Excelu; úkol byl označen jako hotový.", now);
                completed += 1;
            }
        }
        setSetting(db, "service_tasks_excel_workbook_hash", workbookHash);
    });
    return { activeRows: parsed.rows.length, created, updated, completed };
}
export function importServiceTasksFromWorkbook(db, workbook) {
    return persistRows(db, parseServiceTaskWorkbook(workbook), createHash("sha256").update(workbook).digest("hex"));
}
function recordSuccessfulImport(db, outcome) {
    const now = new Date().toISOString();
    setSetting(db, "service_tasks_excel_last_success_at", now);
    setSetting(db, "service_tasks_excel_last_error", "");
    setSetting(db, "service_tasks_excel_imported_count", String(outcome.activeRows));
    setSetting(db, "service_tasks_excel_active_rows", String(outcome.activeRows));
    setSetting(db, "service_tasks_excel_last_result", JSON.stringify(outcome));
}
export function importUploadedServiceTaskWorkbook(db, workbook) {
    setSetting(db, "service_tasks_excel_last_attempt_at", new Date().toISOString());
    try {
        const outcome = importServiceTasksFromWorkbook(db, workbook);
        recordSuccessfulImport(db, outcome);
        return getServiceTaskExcelSyncStatus(db);
    }
    catch (error) {
        const message = error instanceof ServiceTaskExcelError ? error.message : "Excel se nepodařilo bezpečně zpracovat.";
        setSetting(db, "service_tasks_excel_last_error", message);
        throw error instanceof ServiceTaskExcelError ? error : new ServiceTaskExcelError(message, "IMPORT_FAILED");
    }
}
async function downloadWorkbook(db) {
    if (!config.serviceTasksExcelShareUrl)
        throw new ServiceTaskExcelError("Zdrojový Excel zatím není v nastavení Hubu připojen.", "NOT_CONFIGURED");
    const graph = getServiceTaskExcelGraphStatus(db);
    if (graph.configured) {
        if (!serviceTaskExcelGraphReady(db)) {
            throw new ServiceTaskExcelError("Automatická synchronizace čeká na připojení Microsoft 365.", "GRAPH_AUTH_REQUIRED");
        }
        try {
            return await downloadServiceTaskWorkbookViaGraph(db);
        }
        catch (error) {
            if (error instanceof ServiceTaskExcelGraphError)
                throw new ServiceTaskExcelError(error.message, error.code);
            throw new ServiceTaskExcelError("Microsoft Graph nedokázal načíst zdrojový Excel.", "GRAPH_SYNC_FAILED");
        }
    }
    let response;
    try {
        response = await fetch(config.serviceTasksExcelShareUrl, {
            signal: AbortSignal.timeout(30_000),
            redirect: "follow",
            cache: "no-store",
            headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        });
    }
    catch {
        throw new ServiceTaskExcelError("SharePoint s Excelem není právě dostupný.", "DOWNLOAD_FAILED");
    }
    if (!response.ok)
        throw new ServiceTaskExcelError(`SharePoint odmítl načtení Excelu (HTTP ${response.status}).`, "DOWNLOAD_REJECTED");
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_WORKBOOK_BYTES)
        throw new ServiceTaskExcelError("Zdrojový Excel překračuje bezpečný limit 25 MB.", "WORKBOOK_TOO_LARGE");
    const workbook = Buffer.from(await response.arrayBuffer());
    if (workbook.length > MAX_WORKBOOK_BYTES)
        throw new ServiceTaskExcelError("Zdrojový Excel překračuje bezpečný limit 25 MB.", "WORKBOOK_TOO_LARGE");
    return workbook;
}
function storedNumber(db, key) {
    const value = Number(getSetting(db, key) ?? 0);
    return Number.isFinite(value) ? value : 0;
}
export function serviceTasksExcelSyncDue(db, now = Date.now()) {
    if (!config.serviceTasksExcelShareUrl)
        return false;
    if (getServiceTaskExcelGraphStatus(db).configured && !serviceTaskExcelGraphReady(db))
        return false;
    const lastAttemptAt = getSetting(db, "service_tasks_excel_last_attempt_at");
    if (!lastAttemptAt)
        return true;
    const parsed = Date.parse(lastAttemptAt);
    if (!Number.isFinite(parsed))
        return true;
    const interval = getSetting(db, "service_tasks_excel_last_error") ? ERROR_RETRY_MS : SYNC_INTERVAL_MS;
    return now - parsed >= interval;
}
export function getServiceTaskExcelSyncStatus(db, options = {}) {
    const lastAttemptAt = getSetting(db, "service_tasks_excel_last_attempt_at");
    const lastSuccessAt = getSetting(db, "service_tasks_excel_last_success_at");
    const remoteConfigured = Boolean(config.serviceTasksExcelShareUrl);
    const graphStatus = getServiceTaskExcelGraphStatus(db);
    const graph = options.includeGraphVerification ? graphStatus : { ...graphStatus, verification: null };
    const remoteReady = remoteConfigured && (!graph.configured || serviceTaskExcelGraphReady(db));
    const configured = remoteConfigured || Boolean(lastSuccessAt);
    const lastError = getSetting(db, "service_tasks_excel_last_error") || null;
    const interval = lastError ? ERROR_RETRY_MS : SYNC_INTERVAL_MS;
    const nextSyncAt = remoteReady && lastAttemptAt && Number.isFinite(Date.parse(lastAttemptAt))
        ? new Date(Date.parse(lastAttemptAt) + interval).toISOString() : null;
    const pendingWriteback = countRows(db, "SELECT COUNT(*) AS value FROM service_task_excel_links WHERE local_status_dirty=1");
    return {
        configured,
        state: !configured ? "not_configured" : lastError ? "error" : "current",
        lastAttemptAt,
        lastSuccessAt,
        lastError,
        nextSyncAt,
        importedCount: storedNumber(db, "service_tasks_excel_imported_count"),
        activeRows: storedNumber(db, "service_tasks_excel_active_rows"),
        remoteReady,
        pendingWriteback,
        writeback: "read_only",
        writebackMessage: pendingWriteback > 0
            ? `${pendingWriteback} dokončení zůstává uložených v Hubu; zápis do Excelu je nyní vypnutý.`
            : graph.configured && !remoteReady
                ? "Microsoft 365 zatím není připojené; hodinové čtení čeká na autorizaci. Zápis do Excelu je vypnutý."
                : READ_ONLY_MESSAGE,
        graph,
    };
}
function countRows(db, sql) {
    const row = db.prepare(sql).get();
    return Number(row?.value ?? 0);
}
export function getServiceTaskExcelDiagnostic(db) {
    const count = (sql) => {
        const row = db.prepare(sql).get();
        return Number(row?.value ?? 0);
    };
    return {
        status: getServiceTaskExcelSyncStatus(db),
        counts: {
            totalTasks: count("SELECT COUNT(*) AS value FROM service_tasks"),
            excelTasks: count("SELECT COUNT(*) AS value FROM service_tasks WHERE source='excel'"),
            activeExcelTasks: count("SELECT COUNT(*) AS value FROM service_tasks WHERE source='excel' AND status NOT IN ('done','cancelled')"),
            excelLinks: count("SELECT COUNT(*) AS value FROM service_task_excel_links"),
            pendingWriteback: count("SELECT COUNT(*) AS value FROM service_task_excel_links WHERE local_status_dirty=1"),
        },
    };
}
export async function syncServiceTasksFromExcel(db) {
    setSetting(db, "service_tasks_excel_last_attempt_at", new Date().toISOString());
    try {
        const workbook = await downloadWorkbook(db);
        const outcome = importServiceTasksFromWorkbook(db, workbook);
        recordSuccessfulImport(db, outcome);
        return getServiceTaskExcelSyncStatus(db);
    }
    catch (error) {
        const message = error instanceof ServiceTaskExcelError ? error.message : "Excel se nepodařilo bezpečně stáhnout nebo zpracovat.";
        setSetting(db, "service_tasks_excel_last_error", message);
        throw error instanceof ServiceTaskExcelError ? error : new ServiceTaskExcelError(message, "SYNC_FAILED");
    }
}
export function markExcelTaskForWriteback(db, taskId) {
    db.prepare(`UPDATE service_task_excel_links SET local_status_dirty=1,writeback_state='pending',writeback_error=? WHERE task_id=?`).run("Dokončení je uložené pouze v Hubu; zápis do původního Excelu je nyní vypnutý.", taskId);
}
