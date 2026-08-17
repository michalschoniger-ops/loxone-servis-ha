import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual, pbkdf2 as pbkdf2Callback, } from "node:crypto";
import { promisify } from "node:util";
const pbkdf2 = promisify(pbkdf2Callback);
export function encryptSecret(plaintext, key, aad) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64")}.${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}
export function decryptSecret(encoded, key, aad) {
    const [version, ivBase64, payloadBase64] = encoded.split(".");
    if (version !== "v1" || !ivBase64 || !payloadBase64)
        throw new Error("Neznámý formát šifrovaného údaje.");
    const iv = Buffer.from(ivBase64, "base64");
    const payload = Buffer.from(payloadBase64, "base64");
    if (iv.length !== 12 || payload.length < 17)
        throw new Error("Poškozený šifrovaný údaj.");
    const ciphertext = payload.subarray(0, -16);
    const tag = payload.subarray(-16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export async function hashPassword(password, iterations = 310_000) {
    const salt = randomBytes(18);
    const derived = await pbkdf2(password, salt, iterations, 32, "sha256");
    return `pbkdf2_sha256$${iterations}$${salt.toString("base64")}$${derived.toString("base64")}`;
}
export async function verifyPassword(password, encoded) {
    const [algorithm, iterationsText, saltBase64, expectedBase64] = encoded.split("$");
    if (algorithm !== "pbkdf2_sha256" || !iterationsText || !saltBase64 || !expectedBase64)
        return false;
    const iterations = Number(iterationsText);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000)
        return false;
    const salt = Buffer.from(saltBase64, "base64");
    const expected = Buffer.from(expectedBase64, "base64");
    if (!salt.length || expected.length !== 32)
        return false;
    const actual = await pbkdf2(password, salt, iterations, expected.length, "sha256");
    return timingSafeEqual(actual, expected);
}
export function hashToken(token) {
    return createHash("sha256").update(token, "utf8").digest("hex");
}
export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString("base64url");
}
export function sessionCsrfToken(rawSessionToken) {
    return createHmac("sha256", rawSessionToken)
        .update("loxone-servis-csrf-v1", "utf8")
        .digest("base64url");
}
export function fingerprint(value) {
    return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
export function loxoneHmac(value, keyHex, algorithm) {
    const digest = algorithm === "SHA1" ? "sha1" : "sha256";
    return createHmac(digest, Buffer.from(keyHex, "hex")).update(value, "utf8").digest("hex").toUpperCase();
}
export function loxonePasswordHash(password, salt, algorithm) {
    const digest = algorithm === "SHA1" ? "sha1" : "sha256";
    return createHash(digest).update(`${password}:${salt}`, "utf8").digest("hex").toUpperCase();
}
export function deriveExportKey(passphrase, salt) {
    return scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1 });
}
export function redactSensitiveText(value) {
    return value
        .replace(/([?&](?:pwd|password|token|autht|usr|user)=)[^&#\s]*/gi, "$1[REDACTED]")
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[EXTERNAL-IP]")
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/Basic\s+\S+/gi, "Basic [REDACTED]");
}
