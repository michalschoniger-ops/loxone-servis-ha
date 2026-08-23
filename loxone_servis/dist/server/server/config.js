import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
const optionsSchema = z.object({
    credentials_master_key: z.string().optional(),
    bootstrap_admin_email: z.string().email().optional(),
    bootstrap_admin_display_name: z.string().max(160).optional(),
    bootstrap_admin_password_hash: z.string().optional(),
    cron_secret: z.string().optional(),
    local_setup_allowed: z.boolean().optional(),
    trusted_proxies: z.array(z.string()).optional(),
    ha_notify_service: z.string().optional(),
    public_base_url: z.string().optional(),
    canonical_base_url: z.string().optional(),
    backup_encryption_key: z.string().optional(),
    backup_pull_token: z.string().optional(),
});
function readOptions(path) {
    try {
        return optionsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return {};
        throw new Error(`Neplatná chráněná konfigurace ${path}: ${error.message}`);
    }
}
function optionalHttpsUrl(value, name) {
    const normalized = value?.trim() ?? "";
    if (!normalized)
        return "";
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:")
        throw new Error(`${name} musí používat HTTPS.`);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`${name} nesmí obsahovat přihlašovací údaje, parametry ani fragment.`);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
}
const dataDirectory = resolve(process.env.DATA_DIRECTORY ?? "/data");
export const optionsPath = resolve(process.env.OPTIONS_PATH ?? `${dataDirectory}/options.json`);
const options = readOptions(optionsPath);
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
const canonicalBaseUrl = optionalHttpsUrl(process.env.CANONICAL_BASE_URL ?? options.canonical_base_url, "CANONICAL_BASE_URL");
const publicBaseUrl = optionalHttpsUrl(process.env.PUBLIC_BASE_URL ?? options.public_base_url, "PUBLIC_BASE_URL");
const masterKeyBase64 = process.env.CREDENTIALS_MASTER_KEY ?? options.credentials_master_key ?? "";
const masterKey = masterKeyBase64 ? Buffer.from(masterKeyBase64, "base64") : Buffer.alloc(0);
if (!canonicalBaseUrl && masterKey.length !== 32) {
    throw new Error("CREDENTIALS_MASTER_KEY musí být standardní Base64 kódování přesně 32 bajtů.");
}
if (canonicalBaseUrl && masterKey.length !== 0 && masterKey.length !== 32) {
    throw new Error("CREDENTIALS_MASTER_KEY musí být prázdný nebo standardní Base64 kódování přesně 32 bajtů.");
}
const backupEncryptionKeyBase64 = process.env.BACKUP_ENCRYPTION_KEY ?? options.backup_encryption_key ?? "";
const backupEncryptionKey = backupEncryptionKeyBase64 ? Buffer.from(backupEncryptionKeyBase64, "base64") : Buffer.alloc(0);
const backupPullToken = process.env.BACKUP_PULL_TOKEN ?? options.backup_pull_token ?? "";
if (!canonicalBaseUrl && (backupEncryptionKey.length > 0 || backupPullToken)) {
    if (backupEncryptionKey.length !== 32) {
        throw new Error("BACKUP_ENCRYPTION_KEY musí být standardní Base64 kódování přesně 32 bajtů.");
    }
    if (backupPullToken.length < 32)
        throw new Error("BACKUP_PULL_TOKEN musí mít alespoň 32 znaků.");
}
export const config = {
    port: Number(process.env.PORT ?? 8099),
    host: process.env.HOST ?? "0.0.0.0",
    logLevel: process.env.LOG_LEVEL ?? "info",
    dataDirectory,
    databasePath: resolve(process.env.DATABASE_PATH ?? `${dataDirectory}/loxone-fleet.sqlite`),
    legacyStateDirectory: resolve(process.env.LEGACY_STATE_DIRECTORY ?? `${dataDirectory}/wrangler-state`),
    masterKey,
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? options.bootstrap_admin_email ?? "schoniger@evorasmart.cz",
    bootstrapAdminDisplayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME ?? options.bootstrap_admin_display_name ?? "",
    bootstrapAdminPasswordHash: process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH ?? options.bootstrap_admin_password_hash ?? "",
    localSetupAllowed: (process.env.LOCAL_SETUP_ALLOWED ?? String(options.local_setup_allowed ?? false)).toLowerCase() === "true",
    cronSecret: process.env.CRON_SECRET ?? options.cron_secret ?? "",
    trustProxy: (process.env.TRUST_PROXY ?? "false").toLowerCase() === "true",
    secureCookies: (process.env.SECURE_COOKIES ?? "auto").toLowerCase(),
    checkConcurrency: Math.max(1, Math.min(10, Number(process.env.CHECK_CONCURRENCY ?? 2))),
    fullCheckIntervalMinutes: Math.max(30, Number(process.env.FULL_CHECK_INTERVAL_MINUTES ?? 120)),
    requestTimeoutMs: Math.max(3_000, Number(process.env.LOXONE_REQUEST_TIMEOUT_MS ?? 18_000)),
    appVersion: process.env.APP_VERSION ?? "3.0.1",
    appUuid: process.env.LOXONE_APP_UUID ?? "1bfb0d5e-3d6e-4e77-9ed4-fc2b2f0682ba",
    appInfo: process.env.LOXONE_APP_INFO ?? "Evora Smart Hub",
    schedulerEnabled: (process.env.SCHEDULER_ENABLED ?? "true").toLowerCase() === "true",
    haNotifyService: process.env.HA_NOTIFY_SERVICE ?? options.ha_notify_service ?? "",
    publicBaseUrl,
    canonicalBaseUrl,
    installationRole: canonicalBaseUrl ? "client" : "main",
    backupEncryptionKey,
    backupPullToken,
    backupEnabled: !canonicalBaseUrl && backupEncryptionKey.length === 32 && backupPullToken.length >= 32,
};
