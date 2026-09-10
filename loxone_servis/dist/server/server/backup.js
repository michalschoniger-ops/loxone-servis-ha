import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { config, optionsPath } from "./config.js";
import { encryptBackupPayload } from "./backup-format.js";
import { getServiceTaskExcelDiagnostic, importUploadedServiceTaskWorkbook, ServiceTaskExcelError, syncServiceTasksFromExcel, } from "./service-tasks-excel.js";
const EXCEL_WORKBOOK_LIMIT = 25 * 1024 * 1024;
function quoteSqlitePath(path) {
    return `'${path.replaceAll("'", "''")}'`;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function tokenMatches(value) {
    if (!config.backupPullToken || !value)
        return false;
    const expected = createHash("sha256").update(config.backupPullToken).digest();
    const received = createHash("sha256").update(value).digest();
    return timingSafeEqual(expected, received);
}
function backupRequestAuthorized(authorization) {
    const value = authorization ?? "";
    return tokenMatches(value.startsWith("Bearer ") ? value.slice(7) : "");
}
const temporarySnapshotPattern = /^backup-snapshot-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.sqlite$/i;
const temporarySnapshotMinimumAgeMs = 60 * 60_000;
function orphanedTemporarySnapshots(now = Date.now()) {
    return readdirSync(config.dataDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && temporarySnapshotPattern.test(entry.name))
        .map((entry) => {
        const path = join(config.dataDirectory, entry.name);
        const stat = statSync(path);
        return { path, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), modifiedMs: stat.mtimeMs };
    })
        .filter((entry) => now - entry.modifiedMs >= temporarySnapshotMinimumAgeMs)
        .map(({ path, bytes, modifiedAt }) => ({ path, bytes, modifiedAt }));
}
function fileSize(path) {
    try {
        return statSync(path).size;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return 0;
        throw error;
    }
}
function databaseStorageDiagnostic(db) {
    const numberPragma = (name) => Number(db.prepare(`PRAGMA ${name}`).get()?.[name] ?? 0);
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name).filter((name) => /^[a-zA-Z0-9_]+$/.test(name));
    const sizeByName = new Map();
    let dbstatAvailable = true;
    try {
        const rows = db.prepare("SELECT name,SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all();
        for (const row of rows)
            sizeByName.set(row.name, Number(row.bytes));
    }
    catch {
        dbstatAvailable = false;
    }
    const indexOwners = new Map();
    for (const row of db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all()) {
        indexOwners.set(row.tbl_name, [...(indexOwners.get(row.tbl_name) ?? []), row.name]);
    }
    const tables = tableNames.map((table) => {
        const rows = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
        const tableBytes = dbstatAvailable ? (sizeByName.get(table) ?? 0) : null;
        const indexesBytes = dbstatAvailable
            ? (indexOwners.get(table) ?? []).reduce((total, index) => total + (sizeByName.get(index) ?? 0), 0)
            : null;
        return { table, rows, tableBytes, indexesBytes };
    }).sort((left, right) => ((right.tableBytes ?? 0) + (right.indexesBytes ?? 0)) - ((left.tableBytes ?? 0) + (left.indexesBytes ?? 0)));
    const pageCount = numberPragma("page_count");
    const freePages = numberPragma("freelist_count");
    const pageSize = numberPragma("page_size");
    const temporarySnapshots = orphanedTemporarySnapshots();
    return {
        generatedAt: new Date().toISOString(),
        files: {
            databaseBytes: fileSize(config.databasePath),
            walBytes: fileSize(`${config.databasePath}-wal`),
            shmBytes: fileSize(`${config.databasePath}-shm`),
        },
        pages: {
            pageSize,
            pageCount,
            freePages,
            allocatedBytes: pageSize * pageCount,
            reusableBytes: pageSize * freePages,
        },
        dbstatAvailable,
        unusedTemporaryBackups: {
            count: temporarySnapshots.length,
            bytes: temporarySnapshots.reduce((total, entry) => total + entry.bytes, 0),
            oldestModifiedAt: temporarySnapshots.map((entry) => entry.modifiedAt).sort()[0] ?? null,
        },
        tables,
    };
}
function projectSnapshotCleanupCount(db) {
    return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT ROW_NUMBER() OVER (PARTITION BY serial ORDER BY created_at DESC,id DESC) AS position
      FROM project_snapshots
    ) WHERE position > 2
  `).get().count);
}
function cleanupUnusedProjectSnapshots(db) {
    const before = databaseStorageDiagnostic(db);
    const temporarySnapshots = orphanedTemporarySnapshots();
    let removedTemporaryBackupBytes = 0;
    for (const snapshot of temporarySnapshots) {
        unlinkSync(snapshot.path);
        removedTemporaryBackupBytes += snapshot.bytes;
    }
    const removableSnapshots = projectSnapshotCleanupCount(db);
    let removedSnapshots = 0;
    if (removableSnapshots > 0) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const result = db.prepare(`
        DELETE FROM project_snapshots WHERE id IN (
          SELECT id FROM (
            SELECT id,ROW_NUMBER() OVER (PARTITION BY serial ORDER BY created_at DESC,id DESC) AS position
            FROM project_snapshots
          ) WHERE position > 2
        )
      `).run();
            removedSnapshots = Number(result.changes);
            db.exec("COMMIT");
        }
        catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }
    db.exec("PRAGMA optimize");
    let vacuumed = false;
    try {
        db.exec("VACUUM");
        vacuumed = true;
    }
    catch {
        // Smazané stránky jsou i bez VACUUM znovu použitelné databází. Samotné
        // zmenšení souboru lze bezpečně zopakovat později po uvolnění dalšího místa.
    }
    return {
        removedTemporaryBackups: temporarySnapshots.length,
        removedTemporaryBackupBytes,
        removedSnapshots,
        keptSnapshotsPerMiniserver: 2,
        vacuumed,
        before,
        after: databaseStorageDiagnostic(db),
    };
}
export async function registerEncryptedBackup(app, db) {
    app.addContentTypeParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { parseAs: "buffer", bodyLimit: EXCEL_WORKBOOK_LIMIT }, (_request, body, done) => done(null, body));
    app.get("/api/system/encrypted-backup", {
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        if (!config.backupEnabled) {
            return reply.code(503).send({ error: "Šifrované zálohy nejsou nakonfigurované.", code: "BACKUP_DISABLED" });
        }
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro zálohu.", code: "UNAUTHORIZED" });
        }
        const snapshotPath = `${config.dataDirectory}/backup-snapshot-${randomUUID()}.sqlite`;
        try {
            db.exec(`VACUUM INTO ${quoteSqlitePath(snapshotPath)}`);
            const database = readFileSync(snapshotPath);
            const options = existsSync(optionsPath) ? readFileSync(optionsPath) : Buffer.from("{}", "utf8");
            const createdAt = new Date().toISOString();
            const payload = Buffer.from(JSON.stringify({
                format: "loxone-servis-backup-payload-v1",
                createdAt,
                appVersion: config.appVersion,
                installationRole: "main",
                files: {
                    "loxone-fleet.sqlite": { sha256: sha256(database), data: database.toString("base64") },
                    "options.json": { sha256: sha256(options), data: options.toString("base64") },
                },
            }), "utf8");
            const encrypted = encryptBackupPayload(gzipSync(payload, { level: 9 }), config.backupEncryptionKey, createdAt);
            const stamp = createdAt.replace(/[:.]/g, "-");
            reply.header("Cache-Control", "no-store, max-age=0");
            reply.header("Content-Type", "application/octet-stream");
            reply.header("Content-Disposition", `attachment; filename="loxone-servis-${stamp}.lxbak"`);
            return reply.send(encrypted);
        }
        finally {
            if (existsSync(snapshotPath))
                unlinkSync(snapshotPath);
        }
    });
    app.get("/api/system/storage-diagnostic", {
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro diagnostiku.", code: "UNAUTHORIZED" });
        }
        reply.header("Cache-Control", "no-store, max-age=0");
        return databaseStorageDiagnostic(db);
    });
    app.post("/api/system/storage-cleanup", {
        config: { rateLimit: { max: 2, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro údržbu.", code: "UNAUTHORIZED" });
        }
        const body = request.body && typeof request.body === "object" ? request.body : {};
        const removableSnapshots = projectSnapshotCleanupCount(db);
        const temporarySnapshots = orphanedTemporarySnapshots();
        if (body.confirm !== "DELETE_UNUSED_PROJECT_SNAPSHOTS") {
            reply.header("Cache-Control", "no-store, max-age=0");
            return {
                apply: false,
                removableTemporaryBackups: temporarySnapshots.length,
                removableTemporaryBackupBytes: temporarySnapshots.reduce((total, entry) => total + entry.bytes, 0),
                removableSnapshots,
                keptSnapshotsPerMiniserver: 2,
                preserved: ["latest_two_project_snapshots", "project_change_summaries", "credentials", "settings", "jobs", "audit"],
            };
        }
        reply.header("Cache-Control", "no-store, max-age=0");
        return { apply: true, ...cleanupUnusedProjectSnapshots(db) };
    });
    app.get("/api/system/service-tasks-excel/status", {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        if (!config.backupEnabled) {
            return reply.code(503).send({ error: "Interní diagnostika není nakonfigurovaná.", code: "DIAGNOSTIC_DISABLED" });
        }
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro diagnostiku.", code: "UNAUTHORIZED" });
        }
        reply.header("Cache-Control", "no-store, max-age=0");
        return getServiceTaskExcelDiagnostic(db);
    });
    app.post("/api/system/service-tasks-excel/sync", {
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        if (!config.backupEnabled) {
            return reply.code(503).send({ error: "Interní diagnostika není nakonfigurovaná.", code: "DIAGNOSTIC_DISABLED" });
        }
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro diagnostiku.", code: "UNAUTHORIZED" });
        }
        try {
            await syncServiceTasksFromExcel(db);
            reply.header("Cache-Control", "no-store, max-age=0");
            return getServiceTaskExcelDiagnostic(db);
        }
        catch (error) {
            const known = error instanceof ServiceTaskExcelError ? error : null;
            return reply.code(known?.code === "NOT_CONFIGURED" ? 409 : 502).send({
                error: known?.message ?? "Synchronizace Excelu se nezdařila.",
                code: known?.code ?? "SYNC_FAILED",
            });
        }
    });
    app.post("/api/system/service-tasks-excel/import", {
        config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
        bodyLimit: EXCEL_WORKBOOK_LIMIT,
    }, async (request, reply) => {
        if (!config.backupEnabled) {
            return reply.code(503).send({ error: "Interní import není nakonfigurovaný.", code: "IMPORT_DISABLED" });
        }
        if (!backupRequestAuthorized(request.headers.authorization)) {
            reply.header("WWW-Authenticate", "Bearer");
            return reply.code(401).send({ error: "Neplatné oprávnění pro import.", code: "UNAUTHORIZED" });
        }
        if (!Buffer.isBuffer(request.body)) {
            return reply.code(415).send({ error: "Import vyžaduje původní soubor XLSX.", code: "WORKBOOK_CONTENT_TYPE_REQUIRED" });
        }
        try {
            importUploadedServiceTaskWorkbook(db, request.body);
            reply.header("Cache-Control", "no-store, max-age=0");
            return getServiceTaskExcelDiagnostic(db);
        }
        catch (error) {
            const known = error instanceof ServiceTaskExcelError ? error : null;
            return reply.code(422).send({
                error: known?.message ?? "Import Excelu se nezdařil.",
                code: known?.code ?? "IMPORT_FAILED",
            });
        }
    });
}
