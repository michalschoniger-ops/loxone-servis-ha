import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import { openDatabase } from "./database.js";
import { registerAuth } from "./auth.js";
import { registerApi } from "./api.js";
import { JobQueue } from "./jobs.js";
import { LoxoneError } from "./loxone/client.js";
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
                "body.currentPassword",
                "body.newPassword",
                "body.username",
                "body.secret",
            ],
            censor: "[REDACTED]",
        },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120_000,
});
const database = openDatabase();
const jobs = new JobQueue(database);
await app.register(cookie);
await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
await app.register(helmet, {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            frameAncestors: ["'self'", "http://homeassistant.local:8123", "https:"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
});
app.get("/healthz", async () => ({ status: "ok", version: config.appVersion, database: "ready" }));
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
        cacheControl: true,
        maxAge: "1h",
        immutable: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith("/api/"))
            return reply.code(404).send({ error: "API cesta neexistuje.", code: "NOT_FOUND" });
        reply.header("Cache-Control", "no-cache");
        return reply.sendFile("index.html");
    });
}
app.setErrorHandler(async (error, request, reply) => {
    const requestId = request.id;
    if (error instanceof ZodError) {
        return reply.code(400).send({
            error: "Požadavek obsahuje neplatná data.",
            code: "VALIDATION_ERROR",
            issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
            requestId,
        });
    }
    if (error instanceof LoxoneError) {
        const status = error.code === "no_access" ? 403 : error.code === "unsupported" ? 409 : 502;
        return reply.code(status).send({ error: error.message, code: error.code, requestId });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "Vnitřní chyba aplikace.", code: "INTERNAL_ERROR", requestId });
});
await app.listen({ host: config.host, port: config.port });
if (config.schedulerEnabled)
    jobs.start();
async function shutdown(signal) {
    app.log.info({ signal }, "shutting down");
    jobs.stop();
    await app.close();
    database.close();
    process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
//# sourceMappingURL=index.js.map