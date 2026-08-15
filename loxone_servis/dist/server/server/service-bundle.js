import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { config } from "./config.js";
import { readDefinitionLog } from "./loxone/client.js";
import { redactSensitiveText } from "./crypto.js";
import { audit } from "./database.js";
function anonymize(value, prefix) {
    return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}
function json(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
function replaceKnownIdentifiers(value, replacements) {
    let result = value;
    for (const [source, replacement] of Object.entries(replacements)) {
        if (source)
            result = result.replaceAll(source, replacement);
    }
    return redactSensitiveText(result);
}
export function redactServiceBundleSecrets(value) {
    if (Array.isArray(value))
        return value.map(redactServiceBundleSecrets);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (/password|secret|token|credential|authorization|jwt/i.test(key))
                return [key, "[REDACTED]"];
            if (typeof item === "string" && /_json$/i.test(key)) {
                try {
                    return [key, JSON.stringify(redactServiceBundleSecrets(JSON.parse(item)))];
                }
                catch {
                    return [key, redactSensitiveText(item)];
                }
            }
            return [key, redactServiceBundleSecrets(item)];
        }));
    }
    return typeof value === "string" ? redactSensitiveText(value) : value;
}
export function anonymizeServiceBundleValue(value, context) {
    if (Array.isArray(value))
        return value.map((item) => anonymizeServiceBundleValue(item, context));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (/password|secret|token|credential|authorization|jwt/i.test(key))
                return [key, "[REDACTED]"];
            if (typeof item === "string" && /(?:^|_)(?:ip|address|url|host)(?:_|$)/i.test(key))
                return [key, "[REDACTED]"];
            if (typeof item === "string" && /_json$/i.test(key)) {
                try {
                    return [key, JSON.stringify(anonymizeServiceBundleValue(JSON.parse(item), context))];
                }
                catch {
                    return [key, replaceKnownIdentifiers(item, context.replacements)];
                }
            }
            if (typeof item === "string" && /(?:^|_)(?:serial|name|project|room|category)(?:_|$)/i.test(key)) {
                const knownReplacement = context.replacements[item];
                return [key, knownReplacement ?? anonymize(replaceKnownIdentifiers(item, context.replacements), key.replaceAll("_", "-"))];
            }
            return [key, anonymizeServiceBundleValue(item, context)];
        }));
    }
    return typeof value === "string" ? replaceKnownIdentifiers(value, context.replacements) : value;
}
export async function createServiceBundle(db, serial, actorUserId, anonymized = true) {
    const server = db
        .prepare(`SELECT serial,type,project,registered,target_firmware,current_firmware,connection_state,last_checked_at,last_error,
              elements_online,elements_total,update_status,notes,gateway_serial,last_latency_ms,health_verdict,loxapp_version
       FROM miniservers WHERE serial=?`)
        .get(serial);
    if (!server)
        throw new Error("Miniserver nebyl nalezen.");
    const bundleDirectory = join(config.dataDirectory, "service-bundles");
    mkdirSync(bundleDirectory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const anonymousSerial = anonymize(serial, "miniserver");
    const anonymousProject = anonymize(String(server.project ?? "project"), "projekt");
    const redactionContext = {
        replacements: {
            [serial]: anonymousSerial,
            [String(server.project ?? "")]: anonymousProject,
        },
    };
    const fileSerial = anonymized ? anonymousSerial : serial;
    const fileName = `loxone-servis-${fileSerial}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    const filePath = join(bundleDirectory, `${id}.zip`);
    const output = createWriteStream(filePath, { mode: 0o600 });
    const archive = archiver("zip", { zlib: { level: 9 } });
    const completion = new Promise((resolve, reject) => {
        output.on("close", resolve);
        output.on("error", reject);
        archive.on("error", reject);
    });
    archive.pipe(output);
    const safeServer = anonymized ? anonymizeServiceBundleValue(server, redactionContext) : redactServiceBundleSecrets(server);
    archive.append(json({
        generatedAt: new Date().toISOString(),
        generator: `Evora Smart Hub ${config.appVersion}`,
        anonymized,
        containsCredentials: false,
        containsTokens: false,
        containsCustomerIdentifiers: !anonymized,
        files: ["miniserver.json", "health.json", "devices.json", "availability.json", "project-changes.json", "def.log"],
    }), { name: "manifest.json" });
    archive.append(json(safeServer), { name: "miniserver.json" });
    const health = db
        .prepare("SELECT * FROM health_snapshots WHERE serial=? ORDER BY checked_at DESC LIMIT 25")
        .all(serial);
    archive.append(json(anonymized ? anonymizeServiceBundleValue(health, redactionContext) : redactServiceBundleSecrets(health)), { name: "health.json" });
    const devices = db
        .prepare(`SELECT device_serial,parent_serial,name,type,firmware,online,first_offline_at,last_seen_at,system_message,source,updated_at
       FROM device_inventory WHERE serial=? ORDER BY online,name`)
        .all(serial);
    const safeDevices = anonymized ? anonymizeServiceBundleValue(devices, redactionContext) : redactServiceBundleSecrets(devices);
    archive.append(json(safeDevices), { name: "devices.json" });
    const availability = db
        .prepare("SELECT state,error_code,latency_ms,created_at FROM availability_events WHERE serial=? ORDER BY created_at DESC LIMIT 500")
        .all(serial);
    archive.append(json(redactServiceBundleSecrets(availability)), { name: "availability.json" });
    const projectChanges = db
        .prepare(`SELECT change_type,summary,details_json,created_at FROM project_changes WHERE serial=? ORDER BY created_at DESC LIMIT 100`)
        .all(serial);
    archive.append(json(anonymized ? anonymizeServiceBundleValue(projectChanges, redactionContext) : redactServiceBundleSecrets(projectChanges)), { name: "project-changes.json" });
    try {
        const definitionLog = await readDefinitionLog(db, serial);
        const safeDefinitionLog = redactSensitiveText(definitionLog);
        archive.append(anonymized ? replaceKnownIdentifiers(safeDefinitionLog, redactionContext.replacements) : safeDefinitionLog, { name: "def.log" });
    }
    catch (error) {
        archive.append(`Log se nepodařilo načíst: ${error.code ?? "error"}\n`, { name: "def.log.error.txt" });
    }
    await archive.finalize();
    await completion;
    const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    db.prepare(`INSERT INTO service_bundles(id,serial,file_name,sha256,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)`).run(id, serial, fileName, sha256, expiresAt, actorUserId, new Date().toISOString());
    audit(db, "service_bundle.created", actorUserId, serial, { id, anonymized, sha256 });
    return { id, filePath, fileName, sha256, size: statSync(filePath).size, expiresAt };
}
export function getServiceBundle(db, id) {
    const row = db.prepare("SELECT * FROM service_bundles WHERE id=?").get(id);
    if (!row || Date.parse(row.expires_at) <= Date.now())
        return null;
    const filePath = join(config.dataDirectory, "service-bundles", `${id}.zip`);
    if (!existsSync(filePath))
        return null;
    return {
        id,
        filePath,
        fileName: row.file_name,
        sha256: row.sha256,
        size: statSync(filePath).size,
        expiresAt: row.expires_at,
    };
}
export function serviceBundleStream(bundle) {
    return createReadStream(bundle.filePath);
}
export function cleanupServiceBundles(db) {
    const expired = db.prepare("SELECT id FROM service_bundles WHERE expires_at<=?").all(new Date().toISOString());
    for (const { id } of expired) {
        const filePath = join(config.dataDirectory, "service-bundles", `${id}.zip`);
        if (existsSync(filePath))
            rmSync(filePath, { force: true });
        db.prepare("DELETE FROM service_bundles WHERE id=?").run(id);
    }
}
