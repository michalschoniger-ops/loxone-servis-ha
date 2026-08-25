import { getSetting, setSetting } from "./database.js";
import { miniserverIoCommand } from "./loxone/client.js";
const GATE_TARGET_SETTING = "camera_gate_miniserver_serial";
const GATE_CONTROL_NAME = "Brána";
export class GateControlError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
let commandInFlight = false;
function gateServers(db) {
    return db.prepare(`SELECT m.serial,m.project,f.name AS folder_name,m.connection_state,
            CASE WHEN m.username_encrypted IS NOT NULL AND m.password_encrypted IS NOT NULL THEN 1 ELSE 0 END AS has_credentials
     FROM miniservers m LEFT JOIN project_folders f ON f.id=m.folder_id
     ORDER BY m.project COLLATE NOCASE,m.serial`).all().map((row) => ({
        serial: row.serial,
        project: row.project,
        folderName: row.folder_name,
        connectionState: row.connection_state,
        hasCredentials: row.has_credentials === 1,
    }));
}
function gateServer(db, serial) {
    return gateServers(db).find((server) => server.serial === serial) ?? null;
}
function targetSerial(db) {
    const value = getSetting(db, GATE_TARGET_SETTING)?.trim().toUpperCase() ?? "";
    return /^[A-F0-9]{12}$/.test(value) ? value : null;
}
export function gateControlStatus(db) {
    const serial = targetSerial(db);
    const server = serial ? gateServer(db, serial) : null;
    return {
        configured: Boolean(server),
        available: Boolean(server?.hasCredentials && server.connectionState === "online"),
        project: server?.project ?? null,
    };
}
export async function discoverGateControl(db) {
    const candidates = gateServers(db).filter((server) => server.hasCredentials
        && server.connectionState === "online"
        && /evora/i.test(`${server.project} ${server.folderName ?? ""}`));
    const probes = await Promise.allSettled(candidates.map(async (server) => {
        await miniserverIoCommand(db, server.serial, GATE_CONTROL_NAME, null);
        return server.serial;
    }));
    const matches = probes.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (matches.length === 0) {
        throw new GateControlError("DISCOVERY_FAILED", "V dostupných Miniserverech Evora nebyl nalezen ovládací vstup brány.");
    }
    if (matches.length !== 1) {
        throw new GateControlError("DISCOVERY_AMBIGUOUS", "Ovládací vstup brány byl nalezen na více Miniserverech; cílové zařízení nelze bezpečně zvolit automaticky.");
    }
    setSetting(db, GATE_TARGET_SETTING, matches[0]);
    return gateControlStatus(db);
}
export async function executeGateControl(db, command) {
    const serial = targetSerial(db);
    if (!serial)
        throw new GateControlError("NOT_CONFIGURED", "Ovládání brány zatím není nastavené.");
    const server = gateServer(db, serial);
    if (!server?.hasCredentials || server.connectionState !== "online") {
        throw new GateControlError("UNAVAILABLE", "Cílový Miniserver brány právě není ověřeně dostupný.");
    }
    if (commandInFlight)
        throw new GateControlError("BUSY", "Předchozí příkaz brány ještě probíhá.");
    commandInFlight = true;
    try {
        await miniserverIoCommand(db, serial, GATE_CONTROL_NAME, command);
        return { ok: true, command };
    }
    finally {
        commandInFlight = false;
    }
}
