import { config } from "./config.js";
const CACHE_TTL_MS = 45_000;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
let cached = null;
let refreshInFlight = null;
function baseSummary(baseUrl, state, checkedAt, errorCode) {
    return {
        configured: Boolean(baseUrl),
        state,
        publicUrl: baseUrl || null,
        version: null,
        patternsReady: null,
        catalogProducts: null,
        catalogRefreshing: null,
        checkedAt,
        errorCode,
        windowsValidation: "pending_external",
    };
}
function builderErrorCode(error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError"
        ? "BUILDER_TIMEOUT"
        : "BUILDER_UNREACHABLE";
}
function healthPayload(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const payload = value;
    if (payload.status !== "ok" && payload.status !== "degraded")
        return null;
    if (typeof payload.version !== "string" || !payload.version.trim() || payload.version.length > 100)
        return null;
    if (typeof payload.patterns !== "boolean")
        return null;
    if (!Number.isSafeInteger(payload.catalog_products) || Number(payload.catalog_products) < 0)
        return null;
    if (typeof payload.catalog_refreshing !== "boolean")
        return null;
    if (!Array.isArray(payload.errors) || !payload.errors.every((item) => typeof item === "string"))
        return null;
    return {
        status: payload.status,
        version: payload.version.trim(),
        patterns: payload.patterns,
        catalogProducts: Number(payload.catalog_products),
        catalogRefreshing: payload.catalog_refreshing,
        errors: payload.errors,
    };
}
export async function probeLoxoneBuilder(baseUrl, fetchImpl = fetch, now = () => new Date()) {
    if (!baseUrl)
        return baseSummary("", "not_configured", null, null);
    const checkedAt = now().toISOString();
    try {
        const response = await fetchImpl(new URL("healthz", `${baseUrl}/`), {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                Accept: "application/json",
                "User-Agent": `Evora-Smart-Hub/${config.appVersion}`,
            },
        });
        if (!response.ok || response.status < 200 || response.status >= 300) {
            await response.body?.cancel().catch(() => undefined);
            return baseSummary(baseUrl, "offline", checkedAt, "BUILDER_HTTP_STATUS");
        }
        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredSize) && declaredSize > MAX_HEALTH_RESPONSE_BYTES) {
            await response.body?.cancel().catch(() => undefined);
            return baseSummary(baseUrl, "invalid_response", checkedAt, "BUILDER_RESPONSE_TOO_LARGE");
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_HEALTH_RESPONSE_BYTES) {
            return baseSummary(baseUrl, "invalid_response", checkedAt, "BUILDER_RESPONSE_TOO_LARGE");
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return baseSummary(baseUrl, "invalid_response", checkedAt, "BUILDER_INVALID_JSON");
        }
        const payload = healthPayload(parsed);
        if (!payload)
            return baseSummary(baseUrl, "invalid_response", checkedAt, "BUILDER_INVALID_HEALTH");
        const healthy = payload.status === "ok"
            && payload.patterns
            && payload.catalogProducts > 0
            && payload.errors.length === 0;
        return {
            ...baseSummary(baseUrl, healthy ? "online" : "degraded", checkedAt, healthy ? null : "BUILDER_DEGRADED"),
            version: payload.version,
            patternsReady: payload.patterns,
            catalogProducts: payload.catalogProducts,
            catalogRefreshing: payload.catalogRefreshing,
        };
    }
    catch (error) {
        return baseSummary(baseUrl, "offline", checkedAt, builderErrorCode(error));
    }
}
export function cachedLoxoneBuilderStatus() {
    if (!config.loxoneBuilderUrl)
        return baseSummary("", "not_configured", null, null);
    return cached?.value ?? baseSummary(config.loxoneBuilderUrl, "checking", null, null);
}
export async function loxoneBuilderStatus(options = {}) {
    if (!config.loxoneBuilderUrl)
        return baseSummary("", "not_configured", null, null);
    if (!options.force && cached && cached.expiresAt > Date.now())
        return cached.value;
    if (refreshInFlight)
        return refreshInFlight;
    refreshInFlight = probeLoxoneBuilder(config.loxoneBuilderUrl).then((value) => {
        cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
        return value;
    }).finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}
export function resetLoxoneBuilderCacheForTests() {
    cached = null;
    refreshInFlight = null;
}
