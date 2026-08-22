import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { preferredLauncherAgent } from "./config-launcher.js";
import { getStoredCredentials } from "./repository.js";
import { getPortalSyncStatus } from "./portal-sync.js";
import { checkMiniserver, getLoxoneContext, LoxoneError, readHealth, readLoxApp3, requestLoxone, resolveConnection, } from "./loxone/client.js";
function errorCode(error) {
    if (error instanceof LoxoneError)
        return error.code;
    return error.code || "INTERNAL_ERROR";
}
function safeMessage(error) {
    if (error instanceof LoxoneError)
        return error.message;
    return "Test skončil interní chybou Hubu.";
}
async function runStep(steps, key, label, operation) {
    const started = Date.now();
    try {
        const result = await operation();
        steps.push({ key, label, state: result.state ?? "passed", code: result.code ?? null, message: result.message, durationMs: Date.now() - started });
    }
    catch (error) {
        steps.push({ key, label, state: "failed", code: errorCode(error), message: safeMessage(error), durationMs: Date.now() - started });
    }
}
export async function runConnectionTest(db, serial, actorUserId) {
    const normalized = serial.toUpperCase();
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const steps = [];
    const server = db.prepare("SELECT serial,local_url FROM miniservers WHERE serial=?").get(normalized);
    if (!server)
        throw Object.assign(new Error("Miniserver nebyl nalezen."), { code: "NOT_FOUND" });
    await runStep(steps, "network", "DNS a síť Hubu", async () => {
        const result = await lookup("dns.loxonecloud.com");
        return { message: `DNS funguje; resolver vrátil ${result.family === 6 ? "IPv6" : "IPv4"} adresu.` };
    });
    let resolved = null;
    await runStep(steps, "remote_connect", "Remote Connect", async () => {
        if (server.local_url)
            return { state: "skipped", code: "LOCAL_ROUTE_CONFIGURED", message: "Je nastavena lokální adresa; Remote Connect není pro tento test nutný." };
        resolved = await resolveConnection(normalized);
        return { message: `Remote Connect poskytl platnou ${resolved.source === "legacy" ? "CloudDNS" : "Connect"} trasu.` };
    });
    let check = null;
    await runStep(steps, "miniserver", "Dosažitelnost Miniserveru", async () => {
        check = await checkMiniserver(db, normalized);
        if (check.state === "online")
            return { message: `Miniserver odpověděl za ${check.latencyMs ?? 0} ms.` };
        const message = check.errorCode === "credentials_missing"
            ? "Přístup není nastaven; síťovou cestu bez přihlášení nelze úplně ověřit."
            : check.errorCode === "no_access"
                ? "Síťová cesta funguje, ale Miniserver odmítl přihlášení."
                : check.errorCode?.startsWith("resolver_")
                    ? "Nepodařilo se získat vzdálenou trasu k Miniserveru."
                    : "Síťová cesta nebo Miniserver neodpovídá.";
        return { state: "failed", code: check.errorCode ?? "MINISERVER_UNAVAILABLE", message };
    });
    await runStep(steps, "tls", "TLS", async () => {
        const connection = check?.connection ?? resolved;
        if (!connection)
            return { state: "skipped", code: "NO_ROUTE", message: "TLS nelze ověřit bez dostupné trasy." };
        if (check?.errorCode === "tls_error")
            return { state: "failed", code: "tls_error", message: "TLS certifikát vzdálené trasy nelze ověřit." };
        if (!connection.baseUrl.startsWith("https://"))
            return { state: "skipped", code: "LOCAL_HTTP", message: "Lokální přístup používá HTTP; vzdálené TLS se neuplatní." };
        if (check?.state !== "online")
            return { state: "skipped", code: "CONNECTION_NOT_VERIFIED", message: "TLS nelze samostatně potvrdit, protože spojení nebylo dokončeno." };
        return { message: "HTTPS spojení a certifikát byly přijaty." };
    });
    await runStep(steps, "credentials", "Přihlašovací údaje", async () => {
        if (!getStoredCredentials(db, normalized))
            return { state: "failed", code: "credentials_missing", message: "Přístup není nastaven." };
        if (check?.state === "no_access" || check?.errorCode === "no_access")
            return { state: "failed", code: "no_access", message: "Miniserver přihlašovací údaje odmítl." };
        if (check?.state !== "online")
            return { state: "skipped", code: "NETWORK_NOT_VERIFIED", message: "Heslo nelze posoudit, dokud není funkční síťová cesta." };
        return { message: "Miniserver přihlašovací údaje přijal." };
    });
    const canRead = steps.find((step) => step.key === "miniserver")?.state === "passed";
    await runStep(steps, "status", "/data/status", async () => {
        if (!canRead)
            return { state: "skipped", code: "MINISERVER_NOT_AUTHENTICATED", message: "Stav nelze načíst bez funkčního přihlášení." };
        const context = await getLoxoneContext(db, normalized);
        await requestLoxone(context.connection, context.credentials, "/data/status", { raw: true, accept: "application/xml, text/xml, text/plain" });
        return { message: "/data/status je dostupný a čitelný." };
    });
    await runStep(steps, "loxapp_health", "LoxAPP3 a Health Check", async () => {
        if (!canRead)
            return { state: "skipped", code: "MINISERVER_NOT_AUTHENTICATED", message: "Projekt a zdraví nelze načíst bez funkčního přihlášení." };
        const loxApp = await readLoxApp3(db, normalized);
        const health = await readHealth(db, normalized);
        return { message: `LoxAPP3${loxApp.version ? ` ${loxApp.version}` : ""} a ${Object.keys(health).length} hodnot Health Checku jsou dostupné.` };
    });
    await runStep(steps, "portal", "Loxone Partner Portal", async () => {
        const portal = getPortalSyncStatus(db);
        if (!portal.connected)
            return { state: "skipped", code: "PORTAL_NOT_CONFIGURED", message: "Partner Portal není připojen." };
        if (portal.reconnectRequired)
            return { state: "failed", code: "PORTAL_LOGIN_REJECTED", message: "Partner Portal vyžaduje nové přihlášení." };
        if (portal.lastError)
            return { state: "failed", code: "PORTAL_SYNC_ERROR", message: `Poslední synchronizace selhala: ${portal.lastError}` };
        return { message: `Partner Portal je připojen${portal.lastSyncAt ? `; poslední synchronizace ${portal.lastSyncAt}` : ""}.` };
    });
    await runStep(steps, "launcher", "Windows Launcher", async () => {
        const agent = preferredLauncherAgent(db, actorUserId);
        if (!agent)
            return { state: "skipped", code: "LAUNCHER_NOT_PAIRED", message: "K tomuto účtu není spárovaný Windows Launcher." };
        if (agent.updateRequired)
            return { state: "failed", code: "LAUNCHER_UPDATE_REQUIRED", message: `Launcher ${agent.helperVersion ?? "bez verze"} vyžaduje aktualizaci.` };
        if (!agent.available)
            return { state: "failed", code: "LAUNCHER_OFFLINE", message: `Launcher ${agent.name} je offline.` };
        return { message: `Launcher ${agent.name} je online; nalezeno ${agent.installedVersions.length} verzí Configu.` };
    });
    const finishedAt = new Date().toISOString();
    const state = steps.some((step) => step.state === "failed") ? "failed" : "passed";
    const result = { id, serial: normalized, state, startedAt, finishedAt, steps };
    db.prepare("INSERT INTO connection_test_runs(id,serial,actor_user_id,state,result_json,started_at,finished_at) VALUES(?,?,?,?,?,?,?)")
        .run(id, normalized, actorUserId, state, JSON.stringify(result), startedAt, finishedAt);
    return result;
}
export function lastConnectionTest(db, serial) {
    const row = db.prepare("SELECT result_json FROM connection_test_runs WHERE serial=? ORDER BY started_at DESC LIMIT 1")
        .get(serial.toUpperCase());
    if (!row)
        return null;
    try {
        return JSON.parse(row.result_json);
    }
    catch {
        return null;
    }
}
