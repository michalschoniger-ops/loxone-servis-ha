import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { getLoxoneContext, LoxoneError, readLoxApp3, requestLoxoneBuffer, } from "./client.js";
const MAX_WAITING_EXPORTS = 5;
const MAX_TEXT_EXPORT_BYTES = 16 * 1024 * 1024;
const MAX_STATISTIC_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_PROGRAM_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EMBEDDED_LOXAPP_BYTES = 16 * 1024 * 1024;
const MAX_PROGRAM_ARCHIVE_ENTRIES = 4_096;
const MAX_PROGRAM_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const PROGRAM_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
let exportQueue = Promise.resolve();
let waitingExports = 0;
const exportInFlight = new Map();
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeControlUuid(value) {
    const normalized = value.replace(/^U:/i, "");
    return /^[A-F0-9-]{20,40}$/i.test(normalized) ? normalized : null;
}
function parseOutputs(value) {
    const source = Array.isArray(value) ? value : Object.values(record(value));
    return source.flatMap((item) => {
        const output = record(item);
        const name = typeof output.name === "string" ? output.name.trim() : "";
        if (!name)
            return [];
        const uuid = typeof output.uuid === "string" && /^[A-F0-9-]{20,40}$/i.test(output.uuid)
            ? output.uuid
            : null;
        return [{
                id: finiteNumber(output.id),
                name,
                uuid,
                format: typeof output.format === "string" ? output.format : null,
            }];
    });
}
function parseGroups(value) {
    const source = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(record(value));
    return source.flatMap(([key, item], index) => {
        const group = record(item);
        const id = finiteNumber(group.id ?? group.groupId ?? key) ?? index;
        if (!Number.isInteger(id) || id < 0)
            return [];
        return [{
                id,
                name: typeof group.name === "string" && group.name.trim() ? group.name.trim() : `Skupina ${id}`,
                outputs: parseOutputs(group.outputs),
            }];
    });
}
export function parseStatisticControls(payload) {
    const controls = record(record(payload).controls);
    const result = [];
    for (const [key, value] of Object.entries(controls)) {
        const control = record(value);
        const uuid = normalizeControlUuid(key) ?? normalizeControlUuid(String(control.uuid ?? ""));
        if (!uuid)
            continue;
        const name = typeof control.name === "string" && control.name.trim() ? control.name.trim() : uuid;
        const type = typeof control.type === "string" ? control.type : "Unknown";
        const legacy = record(control.statistic);
        if (Object.keys(legacy).length) {
            result.push({
                uuid,
                name,
                type,
                mode: "legacy",
                frequency: finiteNumber(legacy.frequency),
                outputs: parseOutputs(legacy.outputs),
                groups: [],
            });
        }
        const v2 = record(control.statisticV2);
        if (Object.keys(v2).length) {
            const groups = parseGroups(v2.groups);
            result.push({
                uuid,
                name,
                type,
                mode: "v2",
                frequency: finiteNumber(v2.frequency),
                outputs: groups.length ? [] : parseOutputs(v2.outputs),
                groups,
            });
        }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, "cs") || left.uuid.localeCompare(right.uuid));
}
function loxAppLastModified(payload) {
    const value = record(payload).lastModified;
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null;
}
function scheduleExport(key, operation) {
    const existing = exportInFlight.get(key);
    if (existing)
        return existing;
    if (waitingExports >= MAX_WAITING_EXPORTS) {
        throw new LoxoneError("export_busy", "Probíhá příliš mnoho exportů. Počkejte na dokončení aktuálního stahování.", 429);
    }
    waitingExports += 1;
    const pending = exportQueue.then(operation);
    exportQueue = pending.then(() => undefined, () => undefined);
    exportInFlight.set(key, pending);
    void pending.finally(() => {
        waitingExports -= 1;
        if (exportInFlight.get(key) === pending)
            exportInFlight.delete(key);
    }).catch(() => undefined);
    return pending;
}
export function resetExportProtectionForTests() {
    exportQueue = Promise.resolve();
    waitingExports = 0;
    exportInFlight.clear();
}
async function downloadResource(db, serial, path, accept, maxBytes, timeoutMs = 60_000) {
    const { connection, credentials } = await getLoxoneContext(db, serial);
    return requestLoxoneBuffer(connection, credentials, path, { accept, maxBytes, timeoutMs });
}
export function readExportManifest(db, serial) {
    return scheduleExport(`${serial}:manifest`, async () => {
        const snapshot = await readLoxApp3(db, serial);
        const controls = parseStatisticControls(snapshot.payload);
        return {
            serial,
            generatedAt: new Date().toISOString(),
            lastModified: loxAppLastModified(snapshot.payload),
            loxAppVersion: snapshot.version,
            loxAppHash: snapshot.hash,
            controls,
            legacyCount: controls.filter((control) => control.mode === "legacy").length,
            v2Count: controls.filter((control) => control.mode === "v2").length,
        };
    });
}
export function readLoxApp3Export(db, serial) {
    return scheduleExport(`${serial}:loxapp3`, async () => {
        const snapshot = await readLoxApp3(db, serial);
        return {
            fileName: `LoxAPP3_${serial}.json`,
            contentType: "application/json; charset=utf-8",
            content: Buffer.from(`${JSON.stringify(snapshot.payload, null, 2)}\n`, "utf8"),
        };
    });
}
export function readSystemStatisticsExport(db, serial) {
    return scheduleExport(`${serial}:system-statistics`, async () => ({
        fileName: `system_statistics_${serial}.txt`,
        contentType: "text/plain; charset=utf-8",
        content: await downloadResource(db, serial, "/stats", "text/plain, application/xml", MAX_TEXT_EXPORT_BYTES),
    }));
}
export function readStatisticsCatalogExport(db, serial) {
    return scheduleExport(`${serial}:statistics-catalog`, async () => ({
        fileName: `statistics_catalog_${serial}.json`,
        contentType: "application/json; charset=utf-8",
        content: await downloadResource(db, serial, "/stats/statistics.json", "application/json, text/plain", MAX_TEXT_EXPORT_BYTES),
    }));
}
export function readLegacyStatisticExport(db, serial, controlUuid, period) {
    if (!/^[A-F0-9-]{20,40}$/i.test(controlUuid))
        throw new LoxoneError("invalid_response", "Neplatné UUID statistiky.");
    if (!/^\d{6}(?:\d{2})?$/.test(period))
        throw new LoxoneError("invalid_response", "Období musí být ve formátu RRRRMM nebo RRRRMMDD.");
    return scheduleExport(`${serial}:legacy-statistic:${controlUuid}:${period}`, async () => {
        const snapshot = await readLoxApp3(db, serial);
        const allowed = parseStatisticControls(snapshot.payload)
            .some((control) => control.mode === "legacy" && control.uuid.toUpperCase() === controlUuid.toUpperCase());
        if (!allowed)
            throw new LoxoneError("unsupported", "Vybraný prvek nemá v aktuálním projektu starší XML statistiku.");
        return {
            fileName: `statistic_${serial}_${controlUuid}_${period}.xml`,
            contentType: "application/xml; charset=utf-8",
            content: await downloadResource(db, serial, `/stats/statisticdata.xml/${encodeURIComponent(controlUuid)}/${period}`, "application/xml, text/xml, text/plain", MAX_STATISTIC_EXPORT_BYTES),
        };
    });
}
function v2Outputs(control, groupId) {
    if (!control.groups.length)
        return groupId === 0 ? control.outputs : [];
    return control.groups.find((group) => group.id === groupId)?.outputs ?? [];
}
export function readV2StatisticExport(db, serial, request) {
    if (!/^[A-F0-9-]{20,40}$/i.test(request.controlUuid))
        throw new LoxoneError("invalid_response", "Neplatné UUID statistiky.");
    if (!Number.isInteger(request.from) || !Number.isInteger(request.to) || request.from < 0 || request.from >= request.to) {
        throw new LoxoneError("invalid_response", "Neplatný časový interval statistiky.");
    }
    if (!Number.isInteger(request.groupId) || request.groupId < 0)
        throw new LoxoneError("invalid_response", "Neplatná skupina statistiky.");
    return scheduleExport(`${serial}:v2-statistic:${JSON.stringify(request)}`, async () => {
        const snapshot = await readLoxApp3(db, serial);
        const control = parseStatisticControls(snapshot.payload).find((item) => item.mode === "v2" && item.uuid.toUpperCase() === request.controlUuid.toUpperCase());
        const allowedOutput = control && v2Outputs(control, request.groupId).some((output) => output.name === request.outputName);
        if (!control || !allowedOutput)
            throw new LoxoneError("unsupported", "Vybraný výstup není v aktuální statistice V2 dostupný.");
        const path = `/dev/sps/getStatistic/${encodeURIComponent(request.controlUuid)}/raw/${request.from}/${request.to}/${request.dataPointUnit}/${request.groupId}/${encodeURIComponent(request.outputName)}`;
        return {
            fileName: `statistic_v2_${serial}_${request.controlUuid}_${request.from}_${request.to}.bin`,
            contentType: "application/octet-stream",
            content: await downloadResource(db, serial, path, "application/octet-stream", MAX_STATISTIC_EXPORT_BYTES),
        };
    });
}
function timestampSeconds(value) {
    if (!/^\d{14}$/.test(value))
        return null;
    const parts = [
        Number(value.slice(0, 4)),
        Number(value.slice(4, 6)),
        Number(value.slice(6, 8)),
        Number(value.slice(8, 10)),
        Number(value.slice(10, 12)),
        Number(value.slice(12, 14)),
    ];
    const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1] || date.getUTCDate() !== parts[2]
        || date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5])
        return null;
    return timestamp / 1_000;
}
export function programTimestampFromLastModified(lastModified) {
    const match = lastModified.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match)
        return null;
    const value = match.slice(1).join("");
    return timestampSeconds(value) === null ? null : value;
}
export function findProgramArchiveCandidates(fileList, lastModified) {
    const expected = programTimestampFromLastModified(lastModified);
    const expectedSeconds = expected ? timestampSeconds(expected) : null;
    if (expectedSeconds === null)
        return [];
    const candidates = new Map();
    for (const match of fileList.matchAll(/\bsps_[0-9]+_(\d{14})\.zip\b/gi)) {
        const fileName = match[0];
        const seconds = timestampSeconds(match[1]);
        if (seconds === null)
            continue;
        const distance = Math.abs(seconds - expectedSeconds);
        if (distance > PROGRAM_TIMESTAMP_TOLERANCE_SECONDS)
            continue;
        candidates.set(fileName.toLowerCase(), { fileName, distance, seconds });
    }
    return [...candidates.values()]
        .sort((left, right) => left.distance - right.distance || right.seconds - left.seconds)
        .map((candidate) => candidate.fileName);
}
const PROGRAM_ARCHIVE_NAME = /^sps_[0-9]+_(\d{14})\.zip$/i;
export function parseProgramBackupCatalog(fileList) {
    const backups = new Map();
    for (const match of fileList.matchAll(/(?<![A-Za-z0-9_./-])sps_[0-9]+_(\d{14})\.zip(?![A-Za-z0-9_./-])/gi)) {
        const fileName = match[0];
        const timestamp = match[1];
        const seconds = timestampSeconds(timestamp);
        if (seconds === null || !PROGRAM_ARCHIVE_NAME.test(fileName))
            continue;
        backups.set(fileName.toLowerCase(), {
            fileName,
            capturedAt: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}`,
        });
    }
    return [...backups.values()]
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || left.fileName.localeCompare(right.fileName))
        .slice(0, 250);
}
function findEndOfCentralDirectory(buffer) {
    const minimum = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50)
            return offset;
    }
    return -1;
}
function safeZipPath(fileName) {
    if (!fileName || fileName.includes("\0"))
        return false;
    const normalized = fileName.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized))
        return false;
    return !normalized.split("/").includes("..");
}
export function validateZipArchive(buffer) {
    const eocd = findEndOfCentralDirectory(buffer);
    if (eocd < 0 || eocd + 22 > buffer.length)
        return false;
    const diskNumber = buffer.readUInt16LE(eocd + 4);
    const centralDisk = buffer.readUInt16LE(eocd + 6);
    const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount > MAX_PROGRAM_ARCHIVE_ENTRIES)
        return false;
    if (centralOffset + centralSize !== eocd || centralOffset > buffer.length)
        return false;
    let offset = centralOffset;
    let totalUncompressed = 0;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50)
            return false;
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
        if (nextOffset > eocd || fileNameLength === 0)
            return false;
        const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
        if (!safeZipPath(fileName) || (flags & 0x1) !== 0 || ![0, 8].includes(method))
            return false;
        totalUncompressed += uncompressedSize;
        if (uncompressedSize > MAX_PROGRAM_UNCOMPRESSED_BYTES || totalUncompressed > MAX_PROGRAM_UNCOMPRESSED_BYTES)
            return false;
        if (compressedSize > buffer.length || localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50)
            return false;
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > centralOffset)
            return false;
        const localFileName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
        if (localFileName !== fileName || !safeZipPath(localFileName))
            return false;
        offset = nextOffset;
    }
    return offset === eocd;
}
export function readZipEntry(buffer, wantedName, maxBytes = MAX_EMBEDDED_LOXAPP_BYTES) {
    if (!validateZipArchive(buffer))
        return null;
    const eocd = findEndOfCentralDirectory(buffer);
    if (eocd < 0 || eocd + 22 > buffer.length)
        return null;
    const entryCount = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
            return null;
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
        if (nextOffset > buffer.length)
            return null;
        const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
        offset = nextOffset;
        const normalizedParts = fileName.replaceAll("\\", "/").split("/");
        const wanted = wantedName.toLocaleLowerCase("en");
        const matches = fileName === wantedName
            || (wanted === "sps.loxone" && normalizedParts.at(-1)?.toLocaleLowerCase("en") === wanted);
        if (!matches)
            continue;
        if ((flags & 0x1) !== 0 || ![0, 8].includes(method) || uncompressedSize > maxBytes || compressedSize > buffer.length)
            return null;
        if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50)
            return null;
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > buffer.length)
            return null;
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        let result;
        try {
            result = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxBytes });
        }
        catch {
            return null;
        }
        return result.length === uncompressedSize ? result : null;
    }
    return null;
}
function programArchiveDownload(archive, serial, sourceFileName) {
    const editableProject = readZipEntry(archive, "sps.loxone", MAX_PROGRAM_ARCHIVE_BYTES);
    if (editableProject) {
        return {
            fileName: `sps_${serial}_${sourceFileName.match(/_(\d{14})\.zip$/i)?.[1] ?? "backup"}.Loxone`,
            contentType: "application/octet-stream",
            content: editableProject,
            sourceFileName,
        };
    }
    return {
        fileName: sourceFileName,
        contentType: "application/zip",
        content: archive,
        sourceFileName,
    };
}
async function readProgramFileList(db, serial) {
    return (await downloadResource(db, serial, "/dev/fslist/prog/", "application/xml, application/json, text/plain", 2 * 1024 * 1024, 30_000)).toString("utf8");
}
async function readProgramArchive(db, serial, fileName) {
    if (!PROGRAM_ARCHIVE_NAME.test(fileName))
        throw new LoxoneError("invalid_response", "Neplatný název zálohy programu.");
    const archive = await downloadResource(db, serial, `/dev/fsget/prog/${encodeURIComponent(fileName)}`, "application/zip, application/octet-stream", MAX_PROGRAM_ARCHIVE_BYTES, 120_000);
    if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50 || !validateZipArchive(archive)) {
        throw new LoxoneError("invalid_response", "Miniserver nevrátil platný ZIP archiv programu.");
    }
    return archive;
}
export function readProgramBackupCatalog(db, serial) {
    return scheduleExport(`${serial}:program-backup-catalog`, async () => parseProgramBackupCatalog(await readProgramFileList(db, serial)));
}
export function readSelectedProgramBackup(db, serial, fileName) {
    if (!PROGRAM_ARCHIVE_NAME.test(fileName))
        throw new LoxoneError("invalid_response", "Neplatný název zálohy programu.");
    return scheduleExport(`${serial}:program-backup:${fileName.toLowerCase()}`, async () => {
        const canonical = parseProgramBackupCatalog(await readProgramFileList(db, serial))
            .find((candidate) => candidate.fileName.toLowerCase() === fileName.toLowerCase())?.fileName;
        if (!canonical)
            throw new LoxoneError("unsupported", "Vybraná záloha už na SD kartě není dostupná.", 404);
        return {
            ...programArchiveDownload(await readProgramArchive(db, serial, canonical), serial, canonical),
            programVerification: "selected_backup",
        };
    });
}
export function readCurrentProgramArchive(db, serial) {
    return scheduleExport(`${serial}:current-program`, async () => {
        const snapshot = await readLoxApp3(db, serial);
        const lastModified = loxAppLastModified(snapshot.payload);
        const fileList = await readProgramFileList(db, serial);
        const nearby = lastModified ? findProgramArchiveCandidates(fileList, lastModified) : [];
        for (const candidate of nearby) {
            try {
                const archive = await readProgramArchive(db, serial, candidate);
                const embeddedLoxApp = readZipEntry(archive, "LoxAPP3.json");
                if (embeddedLoxApp && createHash("sha256").update(embeddedLoxApp).digest("hex") === snapshot.hash) {
                    return {
                        ...programArchiveDownload(archive, serial, candidate),
                        programVerification: "live",
                    };
                }
            }
            catch (error) {
                if (!(error instanceof LoxoneError))
                    throw error;
            }
        }
        for (const backup of parseProgramBackupCatalog(fileList)) {
            try {
                const fallback = programArchiveDownload(await readProgramArchive(db, serial, backup.fileName), serial, backup.fileName);
                return {
                    ...fallback,
                    fileName: `ZALOHA_${fallback.fileName}`,
                    programVerification: "latest_backup",
                };
            }
            catch (error) {
                if (!(error instanceof LoxoneError))
                    throw error;
            }
        }
        throw new LoxoneError("unsupported", "Na SD kartě nebyla nalezena žádná bezpečně dostupná záloha programu.");
    });
}
