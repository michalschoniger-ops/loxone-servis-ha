import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
export const backupFormat = "loxone-servis-encrypted-backup-v1";
export const backupMagic = "LOXONE-SERVIS-BACKUP-V1\n";
export function encryptBackupPayload(payload, key, createdAt = new Date().toISOString()) {
    if (key.length !== 32)
        throw new Error("Šifrovací klíč zálohy musí mít 32 bajtů.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const envelope = {
        format: backupFormat,
        algorithm: "aes-256-gcm",
        createdAt,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        ciphertextSha256: createHash("sha256").update(ciphertext).digest("hex"),
    };
    return Buffer.from(`${backupMagic}${JSON.stringify(envelope)}\n`, "utf8");
}
export function decryptBackupPayload(input, key) {
    if (key.length !== 32)
        throw new Error("Šifrovací klíč zálohy musí mít 32 bajtů.");
    const text = input.toString("utf8");
    if (!text.startsWith(backupMagic))
        throw new Error("Soubor nemá platnou hlavičku Loxone Servis zálohy.");
    const parsed = JSON.parse(text.slice(backupMagic.length).trim());
    if (parsed.format !== backupFormat || parsed.algorithm !== "aes-256-gcm") {
        throw new Error("Nepodporovaný formát šifrované zálohy.");
    }
    if (!parsed.iv || !parsed.tag || !parsed.ciphertext || !parsed.ciphertextSha256) {
        throw new Error("Šifrovaná záloha není úplná.");
    }
    const ciphertext = Buffer.from(parsed.ciphertext, "base64");
    const checksum = createHash("sha256").update(ciphertext).digest("hex");
    if (checksum !== parsed.ciphertextSha256)
        throw new Error("Kontrolní součet šifrované zálohy nesouhlasí.");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
