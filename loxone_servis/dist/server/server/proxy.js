import { config } from "./config.js";
const skippedRequestHeaders = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]);
const skippedResponseHeaders = new Set(["connection", "content-length", "transfer-encoding", "content-encoding", "set-cookie"]);
function targetUrl(rawUrl) {
    const safeRelative = rawUrl.startsWith("/") ? rawUrl.slice(1) : rawUrl;
    return new URL(safeRelative, `${config.canonicalBaseUrl}/`);
}
function requestBody(request) {
    if (["GET", "HEAD"].includes(request.method))
        return undefined;
    if (request.body === undefined || request.body === null)
        return undefined;
    if (typeof request.body === "string")
        return request.body;
    if (request.body instanceof Uint8Array)
        return Buffer.from(request.body);
    return JSON.stringify(request.body);
}
async function forward(request, reply) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
        if (skippedRequestHeaders.has(name.toLowerCase()) || value === undefined)
            continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
    headers.set("accept-encoding", "identity");
    headers.set("x-loxone-servis-client", "ha-domov");
    let response;
    try {
        response = await fetch(targetUrl(request.raw.url ?? request.url), {
            method: request.method,
            headers,
            body: requestBody(request),
            redirect: "manual",
            signal: AbortSignal.timeout(120_000),
        });
    }
    catch (error) {
        request.log.warn({ err: error }, "canonical server unavailable");
        return reply.code(502).send({
            error: "Hlavní Loxone Servis na HA Práce není dostupný.",
            code: "CANONICAL_UNAVAILABLE",
        });
    }
    reply.code(response.status);
    response.headers.forEach((value, name) => {
        if (!skippedResponseHeaders.has(name.toLowerCase()))
            reply.header(name, value);
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length)
        reply.header("set-cookie", setCookies);
    const location = response.headers.get("location");
    if (location) {
        try {
            const resolved = new URL(location, config.canonicalBaseUrl);
            const canonical = new URL(config.canonicalBaseUrl);
            reply.header("location", resolved.origin === canonical.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : location);
        }
        catch {
            reply.header("location", location);
        }
    }
    return reply.send(Buffer.from(await response.arrayBuffer()));
}
export async function registerCanonicalProxy(app) {
    app.get("/healthz", async (_request, reply) => {
        try {
            const response = await fetch(`${config.canonicalBaseUrl}/healthz`, {
                headers: { "accept": "application/json", "x-loxone-servis-client": "ha-domov" },
                signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const canonical = await response.json();
            return { status: "ok", version: config.appVersion, mode: "client", canonical };
        }
        catch {
            return reply.code(503).send({ status: "degraded", version: config.appVersion, mode: "client", canonical: "unavailable" });
        }
    });
    app.all("/", forward);
    app.all("/*", forward);
}
//# sourceMappingURL=proxy.js.map