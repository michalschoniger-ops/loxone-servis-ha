import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { config, optionsPath } from "./config.js";
import { encryptBackupPayload } from "./backup-format.js";
import { getServiceTaskExcelDiagnostic, ServiceTaskExcelError, syncServiceTasksFromExcel, } from "./service-tasks-excel.js";
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
export async function registerEncryptedBackup(app, db) {
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
}
