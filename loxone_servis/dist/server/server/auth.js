import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, } from "@simplewebauthn/server";
import { config } from "./config.js";
import { audit } from "./database.js";
import { decryptSecret, encryptSecret, hashPassword, hashToken, randomToken, sessionCsrfToken, verifyPassword, } from "./crypto.js";
const SESSION_COOKIE = "loxone_servis_session";
const SESSION_HOURS = 12;
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
export function actionPayloadHash(action, serial, payload) {
    return hashToken(stableJson({ action, payload, serial }));
}
function publicUser(row) {
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        immutable: row.immutable === 1,
        mfaEnabled: row.mfa_enabled === 1,
    };
}
function secureCookie(request) {
    if (config.secureCookies === "true")
        return true;
    if (config.secureCookies === "false")
        return false;
    return request.headers["x-forwarded-proto"] === "https" || request.protocol === "https";
}
function ipHash(request) {
    return hashToken(request.ip || "unknown");
}
function userAgentHash(request) {
    return hashToken(request.headers["user-agent"] ?? "unknown");
}
function webauthnContext(request) {
    const forwardedProto = String(request.headers["x-forwarded-proto"] ?? request.protocol).split(",")[0].trim();
    const forwardedHost = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0].trim();
    const rawOrigin = typeof request.headers.origin === "string"
        ? request.headers.origin
        : `${forwardedProto}://${forwardedHost}`;
    const origin = new URL(rawOrigin);
    const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "::1";
    if (origin.protocol !== "https:" && !local)
        throw new Error("Passkey vyžaduje zabezpečené HTTPS připojení.");
    return { origin: origin.origin, rpID: origin.hostname };
}
function establishSession(db, row, request, reply) {
    const rawToken = randomToken(36);
    const csrf = sessionCsrfToken(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60_000);
    db.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at,csrf_hash,ip_hash,user_agent_hash)
     VALUES(?,?,?,?,?,?,?,?)`).run(hashToken(rawToken), row.id, expires.toISOString(), now.toISOString(), now.toISOString(), hashToken(csrf), ipHash(request), userAgentHash(request));
    db.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?").run(now.toISOString(), now.toISOString(), row.id);
    reply.setCookie(SESSION_COOKIE, rawToken, {
        httpOnly: true,
        secure: secureCookie(request),
        sameSite: "strict",
        path: "/",
        expires,
    });
    return { user: publicUser(row), csrfToken: csrf, appVersion: config.appVersion };
}
function createWebAuthnChallenge(db, userId, kind, challenge, context) {
    const id = randomUUID();
    const now = new Date();
    db.prepare("DELETE FROM webauthn_challenges WHERE expires_at<=?").run(now.toISOString());
    db.prepare(`INSERT INTO webauthn_challenges(id,user_id,kind,challenge,rp_id,origin,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,?)`).run(id, userId, kind, challenge, context.rpID, context.origin, new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString());
    return id;
}
function takeWebAuthnChallenge(db, id, kind, userId, context) {
    const row = db.prepare("SELECT * FROM webauthn_challenges WHERE id=?").get(id);
    if (!row)
        return null;
    db.prepare("DELETE FROM webauthn_challenges WHERE id=?").run(id);
    if (row.kind !== kind ||
        row.user_id !== userId ||
        row.origin !== context.origin ||
        row.rp_id !== context.rpID ||
        Date.parse(row.expires_at) <= Date.now())
        return null;
    return row;
}
function parseTransports(value) {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((item) => typeof item === "string");
    }
    catch {
        return [];
    }
}
export function requireUser(request, reply) {
    if (!request.sessionUser) {
        void reply.code(401).send({ error: "Přihlášení vypršelo.", code: "AUTH_REQUIRED" });
        return null;
    }
    return request.sessionUser;
}
export function requireRole(request, reply, roles) {
    const user = requireUser(request, reply);
    if (!user)
        return null;
    if (!roles.includes(user.role)) {
        void reply.code(403).send({ error: "Pro tuto operaci nemáte oprávnění.", code: "ROLE_REQUIRED" });
        return null;
    }
    return user;
}
function verifyTotp(row, value) {
    if (row.mfa_enabled !== 1)
        return true;
    if (!row.mfa_secret_encrypted || !value)
        return false;
    const secret = decryptSecret(row.mfa_secret_encrypted, config.masterKey, `${row.id}:mfa`);
    const totp = new OTPAuth.TOTP({ issuer: "EVORA Smart", label: row.email, secret, digits: 6, period: 30 });
    return totp.validate({ token: value.replace(/\s/g, ""), window: 1 }) !== null;
}
export async function registerAuth(app, db) {
    app.decorateRequest("sessionUser", null);
    app.decorateRequest("sessionTokenHash", null);
    app.decorateRequest("csrfToken", null);
    app.addHook("preHandler", async (request) => {
        request.sessionUser = null;
        request.sessionTokenHash = null;
        request.csrfToken = null;
        const rawToken = request.cookies[SESSION_COOKIE];
        if (!rawToken)
            return;
        const tokenHash = hashToken(rawToken);
        const row = db
            .prepare(`SELECT u.id,u.email,u.password_hash,u.role,u.immutable,u.active,u.mfa_secret_encrypted,u.mfa_enabled,
                s.expires_at,s.csrf_hash,s.ip_hash,s.user_agent_hash
         FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`)
            .get(tokenHash);
        if (!row || row.active !== 1 || Date.parse(row.expires_at) <= Date.now()) {
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash);
            return;
        }
        request.sessionUser = publicUser(row);
        request.sessionTokenHash = tokenHash;
        request.csrfToken = row.csrf_hash;
        db.prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?").run(new Date().toISOString(), tokenHash);
    });
    app.addHook("preHandler", async (request, reply) => {
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method))
            return;
        if (request.url.startsWith("/api/auth/login") ||
            request.url.startsWith("/api/auth/passkey/login/") ||
            request.url.startsWith("/api/setup"))
            return;
        if (request.url === "/api/internal/tick" && config.cronSecret)
            return;
        if (!request.sessionUser)
            return;
        const presented = request.headers["x-csrf-token"];
        if (typeof presented !== "string" || !request.csrfToken || hashToken(presented) !== request.csrfToken) {
            await reply.code(403).send({ error: "Neplatný bezpečnostní token požadavku.", code: "CSRF_INVALID" });
        }
    });
    app.post("/api/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const input = z
            .object({ email: z.string().email(), password: z.string().min(1).max(1024), totp: z.string().optional() })
            .parse(request.body);
        const email = input.email.trim().toLowerCase();
        const attempt = db.prepare("SELECT * FROM login_attempts WHERE email=?").get(email);
        if (attempt?.locked_until && Date.parse(attempt.locked_until) > Date.now()) {
            return reply.code(429).send({ error: "Přihlášení je dočasně zablokované.", code: "LOGIN_LOCKED" });
        }
        const row = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        const passwordOk = row?.active === 1 ? await verifyPassword(input.password, row.password_hash) : false;
        const mfaOk = row && passwordOk ? verifyTotp(row, input.totp) : false;
        if (!row || !passwordOk || !mfaOk) {
            const failures = (attempt?.failures ?? 0) + 1;
            const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
            db.prepare(`INSERT INTO login_attempts(email,failures,first_failure_at,locked_until) VALUES(?,?,?,?)
         ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until`).run(email, failures, new Date().toISOString(), lockedUntil);
            audit(db, "auth.login_failed", row?.id ?? null, null, { reason: passwordOk ? "mfa" : "credentials" });
            return reply.code(401).send({
                error: row?.mfa_enabled === 1 && passwordOk ? "Zadejte platný ověřovací kód." : "Neplatný e-mail nebo heslo.",
                code: row?.mfa_enabled === 1 && passwordOk ? "MFA_REQUIRED" : "LOGIN_INVALID",
            });
        }
        db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
        audit(db, "auth.login", row.id, null, {});
        return establishSession(db, row, request, reply);
    });
    app.post("/api/auth/passkey/register/options", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        let context;
        try {
            context = webauthnContext(request);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message, code: "WEBAUTHN_HTTPS_REQUIRED" });
        }
        const existing = db
            .prepare("SELECT credential_id,transports_json FROM passkey_credentials WHERE user_id=?")
            .all(user.id);
        const options = await generateRegistrationOptions({
            rpName: "Evora Smart Hub",
            rpID: context.rpID,
            userName: user.email,
            userDisplayName: user.email,
            userID: new TextEncoder().encode(user.id),
            timeout: 60_000,
            attestationType: "none",
            excludeCredentials: existing.map((credential) => ({
                id: credential.credential_id,
                transports: parseTransports(credential.transports_json),
            })),
            authenticatorSelection: {
                residentKey: "required",
                userVerification: "required",
            },
            preferredAuthenticatorType: "localDevice",
        });
        const challengeId = createWebAuthnChallenge(db, user.id, "registration", options.challenge, context);
        return { challengeId, options };
    });
    app.post("/api/auth/passkey/register/verify", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const input = z.object({
            challengeId: z.string().uuid(),
            label: z.string().trim().max(80).optional(),
            response: z.unknown(),
        }).parse(request.body);
        let context;
        try {
            context = webauthnContext(request);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message, code: "WEBAUTHN_HTTPS_REQUIRED" });
        }
        const challenge = takeWebAuthnChallenge(db, input.challengeId, "registration", user.id, context);
        if (!challenge)
            return reply.code(400).send({ error: "Registrace Passkey vypršela. Zkuste ji znovu.", code: "WEBAUTHN_CHALLENGE_INVALID" });
        try {
            const verification = await verifyRegistrationResponse({
                response: input.response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: challenge.origin,
                expectedRPID: challenge.rp_id,
                requireUserVerification: true,
            });
            if (!verification.verified || !verification.registrationInfo) {
                return reply.code(400).send({ error: "Passkey se nepodařilo ověřit.", code: "WEBAUTHN_REGISTRATION_FAILED" });
            }
            const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
            const transports = input.response.response.transports ?? credential.transports ?? [];
            db.prepare(`INSERT INTO passkey_credentials(
          id,user_id,credential_id,public_key,counter,transports_json,device_type,backed_up,label,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), user.id, credential.id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(transports), credentialDeviceType, credentialBackedUp ? 1 : 0, input.label || "Passkey", new Date().toISOString());
            audit(db, "auth.passkey_registered", user.id, null, { rpID: challenge.rp_id });
            return { ok: true };
        }
        catch {
            return reply.code(400).send({ error: "Passkey se nepodařilo ověřit nebo už je zaregistrovaný.", code: "WEBAUTHN_REGISTRATION_FAILED" });
        }
    });
    app.get("/api/auth/passkeys", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const items = db
            .prepare(`SELECT id,label,device_type AS deviceType,backed_up AS backedUp,created_at AS createdAt,last_used_at AS lastUsedAt
         FROM passkey_credentials WHERE user_id=? ORDER BY created_at DESC`)
            .all(user.id);
        return { items };
    });
    app.delete("/api/auth/passkeys/:id", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const result = db.prepare("DELETE FROM passkey_credentials WHERE id=? AND user_id=?").run(id, user.id);
        if (result.changes === 0)
            return reply.code(404).send({ error: "Passkey nebyl nalezen.", code: "PASSKEY_NOT_FOUND" });
        audit(db, "auth.passkey_deleted", user.id, null, {});
        return { ok: true };
    });
    app.post("/api/auth/passkey/login/options", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
        let context;
        try {
            context = webauthnContext(request);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message, code: "WEBAUTHN_HTTPS_REQUIRED" });
        }
        const options = await generateAuthenticationOptions({
            rpID: context.rpID,
            timeout: 60_000,
            userVerification: "required",
        });
        const challengeId = createWebAuthnChallenge(db, null, "authentication", options.challenge, context);
        return { challengeId, options };
    });
    app.post("/api/auth/passkey/login/verify", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
        const input = z.object({ challengeId: z.string().uuid(), response: z.unknown() }).parse(request.body);
        let context;
        try {
            context = webauthnContext(request);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message, code: "WEBAUTHN_HTTPS_REQUIRED" });
        }
        const challenge = takeWebAuthnChallenge(db, input.challengeId, "authentication", null, context);
        if (!challenge)
            return reply.code(400).send({ error: "Přihlášení pomocí Passkey vypršelo. Zkuste je znovu.", code: "WEBAUTHN_CHALLENGE_INVALID" });
        const response = input.response;
        const credential = db
            .prepare(`SELECT p.*,u.id AS user_id,u.email,u.password_hash,u.role,u.immutable,u.active,
                  u.mfa_secret_encrypted,u.mfa_enabled
           FROM passkey_credentials p JOIN users u ON u.id=p.user_id WHERE p.credential_id=?`)
            .get(response.id);
        if (!credential || credential.active !== 1) {
            audit(db, "auth.passkey_login_failed", credential?.user_id ?? null, null, { reason: "credential" });
            return reply.code(401).send({ error: "Passkey není pro tuto aplikaci platný.", code: "PASSKEY_INVALID" });
        }
        try {
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: challenge.origin,
                expectedRPID: challenge.rp_id,
                credential: {
                    id: credential.credential_id,
                    publicKey: new Uint8Array(credential.public_key),
                    counter: credential.counter,
                    transports: parseTransports(credential.transports_json),
                },
                requireUserVerification: true,
            });
            if (!verification.verified)
                throw new Error("Passkey verification failed");
            db.prepare("UPDATE passkey_credentials SET counter=?,last_used_at=? WHERE id=?").run(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.id);
            db.prepare("DELETE FROM login_attempts WHERE email=?").run(credential.email);
            audit(db, "auth.passkey_login", credential.user_id, null, { rpID: challenge.rp_id });
            return establishSession(db, { ...credential, id: credential.user_id }, request, reply);
        }
        catch {
            audit(db, "auth.passkey_login_failed", credential.user_id, null, { reason: "verification" });
            return reply.code(401).send({ error: "Passkey se nepodařilo ověřit.", code: "PASSKEY_INVALID" });
        }
    });
    app.get("/api/auth/session", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const rawToken = request.cookies[SESSION_COOKIE];
        if (!rawToken)
            return reply.code(401).send({ error: "Přihlášení vypršelo.", code: "AUTH_REQUIRED" });
        // The token is stable for the lifetime of one authenticated session. This
        // prevents one browser tab from invalidating forms already open in another.
        const csrf = sessionCsrfToken(rawToken);
        const csrfHash = hashToken(csrf);
        if (request.csrfToken !== csrfHash) {
            db.prepare("UPDATE sessions SET csrf_hash=? WHERE token_hash=?").run(csrfHash, request.sessionTokenHash);
        }
        return { user, csrfToken: csrf, appVersion: config.appVersion };
    });
    app.post("/api/auth/logout", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(request.sessionTokenHash);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        audit(db, "auth.logout", user.id, null, {});
        return { ok: true };
    });
    app.post("/api/auth/change-password", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const input = z.object({ currentPassword: z.string(), newPassword: z.string().min(14).max(256) }).parse(request.body);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
        if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
            return reply.code(403).send({ error: "Současné heslo není správné.", code: "REAUTH_FAILED" });
        }
        db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").run(await hashPassword(input.newPassword), new Date().toISOString(), user.id);
        db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(user.id, request.sessionTokenHash);
        audit(db, "auth.password_changed", user.id, null, {});
        return { ok: true };
    });
    app.post("/api/auth/mfa/setup", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const input = z.object({ password: z.string() }).parse(request.body);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
        if (!(await verifyPassword(input.password, row.password_hash))) {
            return reply.code(403).send({ error: "Heslo není správné.", code: "REAUTH_FAILED" });
        }
        const secret = new OTPAuth.Secret({ size: 20 }).base32;
        const encrypted = encryptSecret(secret, config.masterKey, `${user.id}:mfa-pending`);
        db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(`mfa_pending:${user.id}`, encrypted, new Date().toISOString());
        const totp = new OTPAuth.TOTP({ issuer: "EVORA Smart", label: user.email, secret, digits: 6, period: 30 });
        return { secret, uri: totp.toString() };
    });
    app.post("/api/auth/mfa/confirm", async (request, reply) => {
        const user = requireUser(request, reply);
        if (!user)
            return;
        const input = z.object({ token: z.string().min(6).max(8) }).parse(request.body);
        const key = `mfa_pending:${user.id}`;
        const pending = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
        if (!pending?.value)
            return reply.code(409).send({ error: "Nejdřív zahajte nastavení 2FA.", code: "MFA_NOT_PENDING" });
        const secret = decryptSecret(pending.value, config.masterKey, `${user.id}:mfa-pending`);
        const totp = new OTPAuth.TOTP({ issuer: "EVORA Smart", label: user.email, secret, digits: 6, period: 30 });
        if (totp.validate({ token: input.token, window: 1 }) === null) {
            return reply.code(400).send({ error: "Ověřovací kód není platný.", code: "MFA_INVALID" });
        }
        db.prepare("UPDATE users SET mfa_secret_encrypted=?,mfa_enabled=1,updated_at=? WHERE id=?").run(encryptSecret(secret, config.masterKey, `${user.id}:mfa`), new Date().toISOString(), user.id);
        db.prepare("DELETE FROM settings WHERE key=?").run(key);
        audit(db, "auth.mfa_enabled", user.id, null, {});
        return { ok: true };
    });
    app.post("/api/auth/confirm-action", async (request, reply) => {
        const user = requireRole(request, reply, ["admin", "technician"]);
        if (!user)
            return;
        const input = z
            .object({
            password: z.string(),
            action: z.string().min(2).max(100),
            serial: z.string().regex(/^[A-Fa-f0-9]{12}$/).nullable().optional(),
            payload: z.unknown().optional(),
        })
            .parse(request.body);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
        if (!(await verifyPassword(input.password, row.password_hash))) {
            audit(db, "action.confirmation_failed", user.id, input.serial?.toUpperCase() ?? null, { action: input.action });
            return reply.code(403).send({ error: "Heslo není správné.", code: "REAUTH_FAILED" });
        }
        const id = randomUUID();
        const now = new Date();
        db.prepare(`INSERT INTO action_confirmations(id,actor_user_id,action,serial,payload_hash,expires_at,created_at)
       VALUES(?,?,?,?,?,?,?)`).run(id, user.id, input.action, input.serial?.toUpperCase() ?? null, actionPayloadHash(input.action, input.serial?.toUpperCase() ?? null, input.payload ?? {}), new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString());
        audit(db, "action.confirmed", user.id, input.serial?.toUpperCase() ?? null, { action: input.action });
        return { confirmationId: id, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() };
    });
}
export function consumeConfirmation(db, user, confirmationId, action, serial, payloadHash) {
    if (!confirmationId)
        return false;
    const row = db.prepare("SELECT * FROM action_confirmations WHERE id=?").get(confirmationId);
    if (!row ||
        row.actor_user_id !== user.id ||
        row.action !== action ||
        row.serial !== serial ||
        row.payload_hash !== payloadHash ||
        row.consumed_at ||
        Date.parse(row.expires_at) <= Date.now()) {
        return false;
    }
    db.prepare("UPDATE action_confirmations SET consumed_at=? WHERE id=? AND consumed_at IS NULL").run(new Date().toISOString(), confirmationId);
    return true;
}
