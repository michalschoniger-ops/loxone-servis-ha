import { XMLParser } from "fast-xml-parser";
const RELEASE_URL = "https://update.loxone.com/updatecheck.xml";
export function persistOfficialReleases(db, releases, checkedAt = new Date().toISOString()) {
    const saveHistory = db.prepare(`INSERT INTO firmware_release_history(channel,version,config_url,first_seen_at,last_seen_at,source_url)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(channel,version,config_url) DO UPDATE SET
       last_seen_at=excluded.last_seen_at,source_url=excluded.source_url`);
    const saveCurrent = db.prepare(`INSERT INTO firmware_releases(channel,version,config_url,published_at,source_url,checked_at,error_code)
     VALUES(?,?,?,?,?,?,NULL)
     ON CONFLICT(channel) DO UPDATE SET version=excluded.version,config_url=excluded.config_url,
       published_at=excluded.published_at,source_url=excluded.source_url,checked_at=excluded.checked_at,error_code=NULL`);
    for (const release of releases) {
        saveHistory.run(release.channel, release.version, release.url ?? "", checkedAt, checkedAt, RELEASE_URL);
        saveCurrent.run(release.channel, release.version, release.url, null, RELEASE_URL, checkedAt);
    }
    const stable = releases.find((release) => release.channel === "stable");
    if (!stable)
        throw new Error("Chybí stabilní verze Miniserveru");
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('target_firmware',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(stable.version, checkedAt);
    db.prepare("UPDATE miniservers SET target_firmware=? WHERE firmware_channel='stable' AND firmware_policy='follow_stable'").run(stable.version);
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('official_release_checked_at',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(checkedAt, checkedAt);
    db.prepare("DELETE FROM settings WHERE key='official_release_error'").run();
}
function text(value) {
    if (typeof value === "string" || typeof value === "number")
        return String(value);
    return null;
}
export function normalizeFirmwareVersion(value) {
    const parts = value.trim().split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
        throw new Error(`Neplatn\u00e1 verze firmware: ${value}`);
    }
    return parts.map((part) => String(Number(part))).join(".");
}
export function officialConfigDownloadUrl(version) {
    try {
        const parts = normalizeFirmwareVersion(version).split(".").map(Number);
        if (parts.some((part) => part < 0 || part > 99))
            return null;
        const suffix = parts.map((part) => String(part).padStart(2, "0")).join("");
        return `https://updatefiles.loxone.com/LoxConfig/LoxoneConfigSetup_${suffix}.zip`;
    }
    catch {
        return null;
    }
}
function secureDownloadUrl(value) {
    const rawUrl = text(value);
    if (!rawUrl)
        return null;
    try {
        const url = new URL(rawUrl);
        if (url.protocol === "http:" && url.hostname.toLowerCase() === "updatefiles.loxone.com")
            url.protocol = "https:";
        const hostname = url.hostname.toLowerCase();
        if (url.protocol !== "https:" || (hostname !== "loxone.com" && !hostname.endsWith(".loxone.com")))
            return null;
        if (url.username || url.password)
            return null;
        return url.toString();
    }
    catch {
        return null;
    }
}
function parseNamedRelease(channel, value) {
    const release = Array.isArray(value) ? value[0] : value;
    if (!release || typeof release !== "object")
        return null;
    const xmlRelease = release;
    const rawVersion = text(xmlRelease.Version);
    if (!rawVersion || !/^\d+\.\d+\.\d+\.\d+$/.test(rawVersion))
        return null;
    return { channel, version: normalizeFirmwareVersion(rawVersion), url: secureDownloadUrl(xmlRelease.Path) };
}
export function parseOfficialReleaseXml(xml) {
    const document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml);
    const root = document.Miniserversoftware;
    if (!root || typeof root !== "object")
        throw new Error("XML neobsahuje ko\u0159en Miniserversoftware");
    const releases = root;
    const parsed = [
        parseNamedRelease("stable", releases.Release),
        parseNamedRelease("beta", releases.Beta),
        parseNamedRelease("alpha", releases.Test),
    ].filter((release) => Boolean(release));
    if (!parsed.some((release) => release.channel === "stable")) {
        throw new Error("XML neobsahuje stabiln\u00ed verzi Miniserveru");
    }
    return parsed;
}
export async function refreshOfficialReleases(db) {
    const checkedAt = new Date().toISOString();
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('official_release_attempted_at',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(checkedAt, checkedAt);
    try {
        const response = await fetch(RELEASE_URL, {
            signal: AbortSignal.timeout(20_000),
            headers: { Accept: "application/xml, text/xml", "User-Agent": "EVORA-Loxone-Servis/0.2" },
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const releases = parseOfficialReleaseXml(await response.text());
        persistOfficialReleases(db, releases, checkedAt);
    }
    catch (error) {
        db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('official_release_error',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(error.message.slice(0, 200), checkedAt);
        throw error;
    }
}
