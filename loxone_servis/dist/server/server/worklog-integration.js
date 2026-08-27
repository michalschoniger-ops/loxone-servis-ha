import { randomUUID } from "node:crypto";
import { hashToken, randomToken } from "./crypto.js";
const TOKEN_PREFIX = "esh_worklog_";
const PAIRING_CODE_PREFIX = "MENU-";
const PAIRING_TTL_MS = 15 * 60 * 1_000;
function publicToken(row) {
    return {
        id: row.id,
        name: row.name,
        tokenHint: row.token_hint,
        active: row.active === 1,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
    };
}
export function listWorkLogTokens(db, ownerUserId) {
    const rows = db.prepare(`SELECT id,name,token_hint,active,created_at,last_used_at,revoked_at
     FROM worklog_tokens WHERE owner_user_id=? ORDER BY active DESC,created_at DESC`).all(ownerUserId);
    return rows.map(publicToken);
}
export function activeWorkLogTokenCount(db, ownerUserId) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM worklog_tokens WHERE owner_user_id=? AND active=1").get(ownerUserId);
    return Number(row.count);
}
export function createWorkLogToken(db, ownerUserId, name) {
    const id = randomUUID();
    const token = `${TOKEN_PREFIX}${randomToken(36)}`;
    const now = new Date().toISOString();
    const tokenHint = `…${token.slice(-6)}`;
    db.prepare(`INSERT INTO worklog_tokens(id,owner_user_id,name,token_hash,token_hint,active,created_at)
     VALUES(?,?,?,?,?,1,?)`).run(id, ownerUserId, name.trim() || "Evora Smart Menu – Mac", hashToken(token), tokenHint, now);
    const item = db.prepare(`SELECT id,name,token_hint,active,created_at,last_used_at,revoked_at
     FROM worklog_tokens WHERE id=?`).get(id);
    return { token, item: publicToken(item) };
}
function cleanupWorkLogPairings(db, now = new Date()) {
    const timestamp = now.toISOString();
    db.prepare("DELETE FROM worklog_pairings WHERE expires_at<=? OR used_at IS NOT NULL").run(timestamp);
}
export function createWorkLogPairing(db, ownerUserId, name) {
    cleanupWorkLogPairings(db);
    const code = `${PAIRING_CODE_PREFIX}${randomToken(12).toUpperCase()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
    db.prepare(`INSERT INTO worklog_pairings(id,code_hash,owner_user_id,name,expires_at,created_at)
     VALUES(?,?,?,?,?,?)`).run(randomUUID(), hashToken(code), ownerUserId, name.trim() || "Evora Smart Menu", expiresAt, now.toISOString());
    return { code, expiresAt };
}
export function pairWorkLogMenu(db, code) {
    cleanupWorkLogPairings(db);
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode.startsWith(PAIRING_CODE_PREFIX))
        return { ok: false, reason: "invalid" };
    const pairing = db.prepare(`SELECT p.id,p.owner_user_id,p.name,p.expires_at,p.used_at,u.email,u.role,u.active
     FROM worklog_pairings p JOIN users u ON u.id=p.owner_user_id
     WHERE p.code_hash=?`).get(hashToken(normalizedCode));
    if (!pairing || pairing.used_at || Date.parse(pairing.expires_at) <= Date.now()
        || pairing.active !== 1 || !["admin", "technician"].includes(pairing.role)) {
        return { ok: false, reason: "invalid" };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
        if (activeWorkLogTokenCount(db, pairing.owner_user_id) >= 5) {
            db.exec("ROLLBACK");
            return { ok: false, reason: "limit" };
        }
        const now = new Date().toISOString();
        const consumed = db.prepare("UPDATE worklog_pairings SET used_at=? WHERE id=? AND used_at IS NULL").run(now, pairing.id);
        if (consumed.changes !== 1) {
            db.exec("ROLLBACK");
            return { ok: false, reason: "invalid" };
        }
        const created = createWorkLogToken(db, pairing.owner_user_id, pairing.name);
        db.exec("COMMIT");
        return {
            ok: true,
            ownerUserId: pairing.owner_user_id,
            email: pairing.email,
            role: pairing.role,
            ...created,
        };
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export function revokeWorkLogToken(db, ownerUserId, id) {
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE worklog_tokens SET active=0,revoked_at=? WHERE id=? AND owner_user_id=? AND active=1").run(now, id, ownerUserId);
    return result.changes === 1;
}
export function authenticateWorkLogToken(db, authorization, allowedRoles = ["admin"]) {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (!token?.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 32)
        return null;
    const row = db.prepare(`SELECT t.id,t.owner_user_id,t.name,t.token_hint,t.active,t.created_at,t.last_used_at,t.revoked_at,
            u.email AS owner_email,u.display_name AS owner_display_name,u.role AS owner_role,
            u.avatar_mime AS owner_avatar_mime,u.avatar_updated_at AS owner_avatar_updated_at
     FROM worklog_tokens t JOIN users u ON u.id=t.owner_user_id
     WHERE t.token_hash=? AND t.active=1 AND u.active=1`).get(hashToken(token));
    if (!row || !allowedRoles.includes(row.owner_role))
        return null;
    db.prepare("UPDATE worklog_tokens SET last_used_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    return {
        tokenId: row.id,
        ownerUserId: row.owner_user_id,
        email: row.owner_email,
        displayName: row.owner_display_name || row.owner_email,
        role: row.owner_role,
        hasAvatar: Boolean(row.owner_avatar_mime),
        avatarUpdatedAt: row.owner_avatar_updated_at,
    };
}
export function workLogLoxoneAppUrl(serial, username, password) {
    const normalized = serial.trim().toUpperCase();
    const query = new URLSearchParams({
        host: `https://dns.loxonecloud.com/${encodeURIComponent(normalized)}`,
        usr: username,
        pwd: password,
    });
    return `loxone://ms?${query.toString()}`;
}
