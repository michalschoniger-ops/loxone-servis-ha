import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashToken, randomToken } from "./crypto.js";
const PAIRING_TTL_MS = 10 * 60_000;
const JOB_TTL_MS = 5 * 60_000;
const AGENT_ONLINE_MS = 90_000;
export const MINIMUM_CONFIG_LAUNCHER_VERSION = "2.0.0.2";
export const CURRENT_CONFIG_LAUNCHER_VERSION = "3.0.0.12";
function parseVersions(value) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string").slice(0, 100)
            : [];
    }
    catch {
        return [];
    }
}
function compareNumericVersions(left, right) {
    if (!left || !/^\d+(?:\.\d+){1,3}$/.test(left) || !/^\d+(?:\.\d+){1,3}$/.test(right))
        return null;
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0)
            return difference < 0 ? -1 : 1;
    }
    return 0;
}
function parseDiagnostics(value) {
    try {
        const parsed = JSON.parse(value ?? "{}");
        const keys = [
            "signature", "uiAutomation", "permissions", "hubConnection", "configDiscovery", "safeLogging", "automaticUpdate",
        ];
        const result = {};
        for (const key of keys) {
            const candidate = parsed[key];
            if (!candidate || !["passed", "warning", "failed", "not_supported"].includes(String(candidate.state)) || typeof candidate.message !== "string")
                return null;
            result[key] = { state: candidate.state, message: candidate.message.slice(0, 300) };
        }
        return result;
    }
    catch {
        return null;
    }
}
export function configLauncherVersionStatus(helperVersion) {
    const minimumComparison = compareNumericVersions(helperVersion, MINIMUM_CONFIG_LAUNCHER_VERSION);
    const latestComparison = compareNumericVersions(helperVersion, CURRENT_CONFIG_LAUNCHER_VERSION);
    return {
        requiredHelperVersion: MINIMUM_CONFIG_LAUNCHER_VERSION,
        latestHelperVersion: CURRENT_CONFIG_LAUNCHER_VERSION,
        updateRequired: minimumComparison === null || minimumComparison < 0,
        updateAvailable: latestComparison === null || latestComparison < 0,
    };
}
export function configLauncherUpdateManifest() {
    const configured = process.env.EVORA_CONFIG_LAUNCHER_SCRIPT_PATH?.trim();
    const candidates = [
        configured || "",
        resolve(process.cwd(), "dist/client/downloads/EvoraConfigLauncher.ps1"),
        resolve(process.cwd(), "src/client/public/downloads/EvoraConfigLauncher.ps1"),
    ].filter(Boolean);
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path)
        return null;
    const content = readFileSync(path);
    return {
        version: CURRENT_CONFIG_LAUNCHER_VERSION,
        url: "/downloads/EvoraConfigLauncher.ps1",
        sha256: createHash("sha256").update(content).digest("hex"),
    };
}
function publicAgent(row, now = Date.now()) {
    const versionStatus = configLauncherVersionStatus(row.helper_version);
    return {
        id: row.id,
        name: row.name,
        available: row.active === 1 && Boolean(row.last_seen_at) && now - Date.parse(row.last_seen_at) <= AGENT_ONLINE_MS,
        helperVersion: row.helper_version,
        ...versionStatus,
        installedVersions: parseVersions(row.installed_versions_json),
        lastSeenAt: row.last_seen_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
        diagnostics: parseDiagnostics(row.diagnostics_json),
        diagnosticsAt: row.diagnostics_at,
    };
}
function publicJob(row) {
    return {
        id: row.id,
        serial: row.serial,
        agentId: row.agent_id,
        requiredVersion: row.required_version,
        launchMode: row.launch_mode,
        configUrl: row.config_url,
        state: row.state,
        message: row.message,
        errorCode: row.error_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
    };
}
export function expireConfigLaunchJobs(db, now = new Date()) {
    const timestamp = now.toISOString();
    db.prepare(`UPDATE config_launch_jobs SET state='expired',message='Požadavek vypršel.',error_code='JOB_EXPIRED',updated_at=?,finished_at=?
     WHERE state IN ('queued','delivered','launching','connecting') AND expires_at<=?`).run(timestamp, timestamp, timestamp);
    db.prepare("DELETE FROM config_launcher_pairings WHERE expires_at<=? OR used_at IS NOT NULL").run(timestamp);
}
export function createLauncherPairing(db, actorUserId, name) {
    expireConfigLaunchJobs(db);
    const code = randomToken(12);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
    db.prepare("INSERT INTO config_launcher_pairings(id,code_hash,name,actor_user_id,expires_at,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), hashToken(code), name.trim() || "Windows Launcher", actorUserId, expiresAt, now.toISOString());
    return { code, expiresAt };
}
export function pairLauncherAgent(db, code, requestedName) {
    expireConfigLaunchJobs(db);
    const pairing = db.prepare("SELECT id,name,actor_user_id,expires_at,used_at FROM config_launcher_pairings WHERE code_hash=?").get(hashToken(code));
    if (!pairing || pairing.used_at || Date.parse(pairing.expires_at) <= Date.now())
        return null;
    const now = new Date().toISOString();
    const agentId = randomUUID();
    const agentToken = randomToken(36);
    const agentName = requestedName?.trim() || pairing.name;
    db.exec("BEGIN IMMEDIATE");
    try {
        const latestAgent = db.prepare(`SELECT created_at FROM config_launcher_agents
       WHERE owner_user_id=? AND name=? ORDER BY created_at DESC LIMIT 1`).get(pairing.actor_user_id, agentName);
        const latestCreatedAt = Date.parse(latestAgent?.created_at ?? "");
        const createdAt = new Date(Math.max(Date.now(), Number.isFinite(latestCreatedAt) ? latestCreatedAt + 1 : 0)).toISOString();
        const consumed = db.prepare("UPDATE config_launcher_pairings SET used_at=? WHERE id=? AND used_at IS NULL").run(now, pairing.id);
        if (consumed.changes !== 1) {
            db.exec("ROLLBACK");
            return null;
        }
        db.prepare(`INSERT INTO config_launcher_agents(id,owner_user_id,name,token_hash,active,last_status,created_at,updated_at)
       VALUES(?,?,?,?,1,'paired',?,?)`).run(agentId, pairing.actor_user_id, agentName, hashToken(agentToken), createdAt, createdAt);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    return { agentId, agentToken, pollIntervalSeconds: 3 };
}
export function authenticateLauncherAgent(db, authorization) {
    if (!authorization?.startsWith("Bearer "))
        return null;
    const token = authorization.slice(7).trim();
    if (token.length < 32)
        return null;
    return db.prepare("SELECT * FROM config_launcher_agents WHERE token_hash=? AND active=1").get(hashToken(token)) ?? null;
}
export function heartbeatLauncherAgent(db, agent, helperVersion, installedVersions, diagnostics) {
    const versions = [...new Set(installedVersions.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
        const updated = db.prepare(`UPDATE config_launcher_agents SET helper_version=?,installed_versions_json=?,last_seen_at=?,last_status='online',last_error=NULL,
       diagnostics_json=CASE WHEN ? IS NULL THEN diagnostics_json ELSE ? END,
       diagnostics_at=CASE WHEN ? IS NULL THEN diagnostics_at ELSE ? END,updated_at=? WHERE id=? AND active=1`).run(helperVersion, JSON.stringify(versions), now, diagnostics ? 1 : null, diagnostics ? JSON.stringify(diagnostics) : null, diagnostics ? 1 : null, diagnostics ? now : null, now, agent.id);
        if (updated.changes === 1) {
            db.prepare(`UPDATE config_launch_jobs SET state='failed',message='Počítač byl nahrazen novým spárováním.',error_code='AGENT_REPLACED',updated_at=?,finished_at=?
         WHERE agent_id IN (
           SELECT id FROM config_launcher_agents
           WHERE owner_user_id=? AND name=? AND active=1 AND id<>? AND created_at<?
         ) AND state IN ('queued','delivered','launching','connecting')`).run(now, now, agent.owner_user_id, agent.name, agent.id, agent.created_at);
            db.prepare(`UPDATE config_launcher_agents SET active=0,last_status='replaced',last_error=NULL,updated_at=?
         WHERE owner_user_id=? AND name=? AND active=1 AND id<>? AND created_at<?`).run(now, agent.owner_user_id, agent.name, agent.id, agent.created_at);
        }
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export function revokeLauncherAgent(db, ownerUserId, agentId) {
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
        const owned = db.prepare("SELECT id FROM config_launcher_agents WHERE id=? AND owner_user_id=? AND active=1").get(agentId, ownerUserId);
        if (!owned) {
            db.exec("ROLLBACK");
            return false;
        }
        db.prepare(`UPDATE config_launch_jobs SET state='failed',message='Windows Launcher byl odebrán.',error_code='AGENT_REVOKED',updated_at=?,finished_at=?
       WHERE agent_id=? AND actor_user_id=? AND state IN ('queued','delivered','launching','connecting')`).run(now, now, agentId, ownerUserId);
        db.prepare(`UPDATE config_launcher_agents SET active=0,last_status='revoked',last_error=NULL,updated_at=?
       WHERE id=? AND owner_user_id=? AND active=1`).run(now, agentId, ownerUserId);
        db.exec("COMMIT");
        return true;
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export function preferredLauncherAgent(db, ownerUserId) {
    const row = db.prepare("SELECT * FROM config_launcher_agents WHERE owner_user_id=? AND active=1 ORDER BY last_seen_at IS NULL,last_seen_at DESC LIMIT 1").get(ownerUserId);
    return row ? publicAgent(row) : null;
}
export function createConfigLaunchJob(db, input) {
    expireConfigLaunchJobs(db);
    const now = new Date();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + JOB_TTL_MS).toISOString();
    db.prepare(`INSERT INTO config_launch_jobs(id,serial,agent_id,actor_user_id,required_version,launch_mode,connection_url,config_url,state,message,created_at,updated_at,expires_at)
     VALUES(?,?,?,?,?,?,?,?,'queued','Čeká na Windows Launcher.',?,?,?)`).run(id, input.serial, input.agentId, input.actorUserId, input.requiredVersion, input.launchMode, input.connectionUrl, input.configUrl, now.toISOString(), now.toISOString(), expiresAt);
    return getConfigLaunchJob(db, id);
}
export function getConfigLaunchJob(db, id) {
    expireConfigLaunchJobs(db);
    const row = db.prepare("SELECT * FROM config_launch_jobs WHERE id=?").get(id);
    return row ? publicJob(row) : null;
}
export function getConfigLaunchJobForUser(db, id, actorUserId) {
    expireConfigLaunchJobs(db);
    const row = db.prepare("SELECT * FROM config_launch_jobs WHERE id=? AND actor_user_id=?").get(id, actorUserId);
    return row ? publicJob(row) : null;
}
export function takeConfigLaunchJob(db, agentId) {
    expireConfigLaunchJobs(db);
    const row = db.prepare("SELECT * FROM config_launch_jobs WHERE agent_id=? AND state='queued' AND expires_at>? ORDER BY created_at LIMIT 1").get(agentId, new Date().toISOString());
    if (!row)
        return null;
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE config_launch_jobs SET state='delivered',message='Předáno Windows Launcheru.',delivered_at=?,updated_at=? WHERE id=? AND state='queued'").run(now, now, row.id);
    if (result.changes !== 1)
        return null;
    return { ...row, state: "delivered", updated_at: now };
}
const TERMINAL_STATES = new Set(["succeeded", "missing_config", "failed"]);
const ALLOWED_TRANSITIONS = {
    delivered: new Set(["launching", "missing_config", "failed"]),
    launching: new Set(["launching", "connecting", "missing_config", "failed"]),
    connecting: new Set(["connecting", "succeeded", "failed"]),
};
export function updateConfigLaunchJob(db, agentId, jobId, state, message, errorCode) {
    expireConfigLaunchJobs(db);
    const current = db.prepare("SELECT * FROM config_launch_jobs WHERE id=? AND agent_id=?").get(jobId, agentId);
    if (!current || !ALLOWED_TRANSITIONS[current.state]?.has(state))
        return null;
    const now = new Date().toISOString();
    db.prepare("UPDATE config_launch_jobs SET state=?,message=?,error_code=?,updated_at=?,finished_at=? WHERE id=? AND agent_id=?").run(state, message.slice(0, 500), errorCode?.slice(0, 80) ?? null, now, TERMINAL_STATES.has(state) ? now : null, jobId, agentId);
    db.prepare("UPDATE config_launcher_agents SET last_status=?,last_error=?,last_seen_at=?,updated_at=? WHERE id=?").run(state, state === "failed" || state === "missing_config" ? message.slice(0, 500) : null, now, now, agentId);
    return getConfigLaunchJob(db, jobId);
}
