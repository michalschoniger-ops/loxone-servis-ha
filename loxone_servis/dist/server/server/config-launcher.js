import { randomUUID } from "node:crypto";
import { hashToken, randomToken } from "./crypto.js";
const PAIRING_TTL_MS = 10 * 60_000;
const JOB_TTL_MS = 5 * 60_000;
const AGENT_ONLINE_MS = 90_000;
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
function publicAgent(row, now = Date.now()) {
    return {
        id: row.id,
        name: row.name,
        available: row.active === 1 && Boolean(row.last_seen_at) && now - Date.parse(row.last_seen_at) <= AGENT_ONLINE_MS,
        helperVersion: row.helper_version,
        installedVersions: parseVersions(row.installed_versions_json),
        lastSeenAt: row.last_seen_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
    };
}
function publicJob(row) {
    return {
        id: row.id,
        serial: row.serial,
        agentId: row.agent_id,
        requiredVersion: row.required_version,
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
    db.exec("BEGIN IMMEDIATE");
    try {
        const consumed = db.prepare("UPDATE config_launcher_pairings SET used_at=? WHERE id=? AND used_at IS NULL").run(now, pairing.id);
        if (consumed.changes !== 1) {
            db.exec("ROLLBACK");
            return null;
        }
        db.prepare(`INSERT INTO config_launcher_agents(id,owner_user_id,name,token_hash,active,last_status,created_at,updated_at)
       VALUES(?,?,?,?,1,'paired',?,?)`).run(agentId, pairing.actor_user_id, requestedName?.trim() || pairing.name, hashToken(agentToken), now, now);
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
export function heartbeatLauncherAgent(db, agent, helperVersion, installedVersions) {
    const versions = [...new Set(installedVersions.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
    const now = new Date().toISOString();
    db.prepare(`UPDATE config_launcher_agents SET helper_version=?,installed_versions_json=?,last_seen_at=?,last_status='online',last_error=NULL,updated_at=? WHERE id=?`).run(helperVersion, JSON.stringify(versions), now, now, agent.id);
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
    db.prepare(`INSERT INTO config_launch_jobs(id,serial,agent_id,actor_user_id,required_version,connection_url,config_url,state,message,created_at,updated_at,expires_at)
     VALUES(?,?,?,?,?,?,?,'queued','Čeká na Windows Launcher.',?,?,?)`).run(id, input.serial, input.agentId, input.actorUserId, input.requiredVersion, input.connectionUrl, input.configUrl, now.toISOString(), now.toISOString(), expiresAt);
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
    launching: new Set(["connecting", "missing_config", "failed"]),
    connecting: new Set(["succeeded", "failed"]),
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
