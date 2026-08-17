import { ZodError } from "zod";
import { LoxoneError } from "./loxone/client.js";
function validationIssues(error) {
    if (error instanceof ZodError)
        return error.issues;
    if (!error || typeof error !== "object")
        return null;
    const candidate = error;
    if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues))
        return null;
    if (!candidate.issues.every((issue) => {
        if (!issue || typeof issue !== "object")
            return false;
        const value = issue;
        return Array.isArray(value.path) && typeof value.message === "string";
    }))
        return null;
    return candidate.issues;
}
function clientError(error) {
    if (!error || typeof error !== "object")
        return null;
    const candidate = error;
    if (!Number.isInteger(candidate.statusCode) || Number(candidate.statusCode) < 400 || Number(candidate.statusCode) > 499)
        return null;
    const status = Number(candidate.statusCode);
    if (status === 415 || candidate.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
        return { status: 415, message: "Typ odeslaných dat není podporován.", code: "UNSUPPORTED_MEDIA_TYPE" };
    }
    return { status, message: "Požadavek nelze zpracovat.", code: "BAD_REQUEST" };
}
export function registerApplicationErrorHandler(app) {
    app.setErrorHandler(async (error, request, reply) => {
        const requestId = request.id;
        const issues = validationIssues(error);
        if (issues) {
            return reply.code(400).send({
                error: "Požadavek obsahuje neplatná data.",
                code: "VALIDATION_ERROR",
                issues: issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
                requestId,
            });
        }
        if (error instanceof LoxoneError) {
            const status = error.code === "no_access" ? 403 : error.code === "unsupported" ? 409 : error.code === "export_busy" ? 429 : 502;
            return reply.code(status).send({ error: error.message, code: error.code, requestId });
        }
        const safeClientError = clientError(error);
        if (safeClientError) {
            request.log.warn({ err: error }, "client request rejected");
            return reply.code(safeClientError.status).send({
                error: safeClientError.message,
                code: safeClientError.code,
                requestId,
            });
        }
        request.log.error({ err: error }, "request failed");
        return reply.code(500).send({ error: "Vnitřní chyba aplikace.", code: "INTERNAL_ERROR", requestId });
    });
}
