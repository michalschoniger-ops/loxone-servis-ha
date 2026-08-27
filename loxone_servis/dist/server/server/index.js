import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { config } from "./config.js";
import { openDatabase } from "./database.js";
import { registerAuth } from "./auth.js";
import { registerApi } from "./api.js";
import { JobQueue } from "./jobs.js";
import { registerEncryptedBackup } from "./backup.js";
import { registerCanonicalProxy } from "./proxy.js";
import { registerApplicationErrorHandler } from "./error-handler.js";
import { cacheControlForStaticPath, isSpaNavigationRequest } from "./static-assets.js";
import { requestLogSerializer } from "./logging.js";
import { startCameraVideoGatewayKeepWarm, stopCameraVideoGateway } from "./camera-video-gateway.js";
import { PUBLISHED_CAMERA_CHANNEL_ID, prewarmPublishedCameraSnapshot, startCameraIntegrationMonitor, stopCameraIntegrationMonitor, } from "./cameras.js";
const app = Fastify({
    logger: {
        level: config.logLevel,
        redact: {
            paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.headers['x-csrf-token']",
                "req.headers['x-action-confirmation']",
                "res.headers['set-cookie']",
                "body.password",
                "body.openUrl",
                "body.closeUrl",
                "body.nvrPassword",
                "body.portalPassword",
                "body.currentPassword",
                "body.newPassword",
                "body.username",
                "body.accessToken",
                "body.secret",
                "body.code",
            ],
            censor: "[REDACTED]",
        },
        serializers: {
            req: requestLogSerializer,
        },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120_000,
});
// Fastify's root error handler must exist before awaited plugin registration.
// Otherwise errors thrown by already-registered routes can fall back to the
// framework's default response and expose internal validation details.
registerApplicationErrorHandler(app);
await app.register(cookie);
await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
await app.register(helmet, {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https://pim.loxone.com"],
            frameSrc: ["'self'", "https://www.loxone.com"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            frameAncestors: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null,
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
});
let database = null;
let jobs = null;
if (config.installationRole === "client") {
    await registerCanonicalProxy(app);
}
else {
    database = openDatabase();
    jobs = new JobQueue(database);
    app.get("/healthz", async () => ({
        status: "ok",
        version: config.appVersion,
        mode: "main",
        database: "ready",
        databaseSchema: 25,
        oneWireHistory: "ready",
        oneWireSampleIntervalMinutes: 10,
        homeAssistantServiceMonitors: Number(database.prepare("SELECT COUNT(*) AS count FROM home_assistant_monitors WHERE enabled=1").get().count),
        encryptedBackup: config.backupEnabled ? "ready" : "disabled",
    }));
    await registerEncryptedBackup(app, database);
    await registerAuth(app, database);
    await registerApi(app, database, jobs);
    const moduleDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const clientDirectoryCandidates = [
        resolve(moduleDirectory, "../client"),
        resolve(process.cwd(), "dist/client"),
    ];
    const clientDirectory = clientDirectoryCandidates.find(existsSync);
    if (clientDirectory) {
        await app.register(staticFiles, {
            root: clientDirectory,
            prefix: "/",
            wildcard: false,
            cacheControl: false,
            immutable: false,
            setHeaders(reply, path) {
                const cacheControl = cacheControlForStaticPath(path);
                reply.header("Cache-Control", cacheControl);
                if (cacheControl === "no-cache")
                    reply.header("Pragma", "no-cache");
            },
        });
        app.setNotFoundHandler(async (request, reply) => {
            if (request.url.startsWith("/api/"))
                return reply.code(404).send({ error: "API cesta neexistuje.", code: "NOT_FOUND" });
            if (!isSpaNavigationRequest(request.url, request.headers.accept)) {
                return reply.code(404).send({ error: "Soubor nebyl nalezen.", code: "NOT_FOUND" });
            }
            reply.header("Cache-Control", "no-cache");
            return reply.sendFile("index.html");
        });
    }
}
await app.listen({ host: config.host, port: config.port });
if (database) {
    startCameraIntegrationMonitor(database);
    startCameraVideoGatewayKeepWarm(database, PUBLISHED_CAMERA_CHANNEL_ID);
    void prewarmPublishedCameraSnapshot(database).catch(() => undefined);
}
if (config.schedulerEnabled)
    jobs?.start();
async function shutdown(signal) {
    app.log.info({ signal }, "shutting down");
    jobs?.stop();
    if (database)
        stopCameraIntegrationMonitor(database);
    await stopCameraVideoGateway();
    await app.close();
    database?.close();
    process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
