export const ONE_WIRE_RAW_RETENTION_MONTHS = 13;
export const ONE_WIRE_DAILY_RETENTION_YEARS = 5;
function isOneWireTemperature(device) {
    return device.type.toLowerCase().includes("onewire") && (device.family ?? "").replace(/^0x/i, "").endsWith("28");
}
export function persistOneWireSamples(db, serial, devices, fallbackTimestamp = new Date().toISOString()) {
    const insert = db.prepare(`INSERT OR IGNORE INTO onewire_samples(serial,device_serial,sampled_at,temperature_c)
     VALUES(?,?,?,?)`);
    const daily = db.prepare(`INSERT INTO onewire_daily(serial,device_serial,day,sample_count,sum_c,min_c,max_c,last_c,last_sampled_at)
     VALUES(?,?,?,1,?,?,?,?,?)
     ON CONFLICT(serial,device_serial,day) DO UPDATE SET
       sample_count=onewire_daily.sample_count+1,
       sum_c=onewire_daily.sum_c+excluded.sum_c,
       min_c=MIN(onewire_daily.min_c,excluded.min_c),
       max_c=MAX(onewire_daily.max_c,excluded.max_c),
       last_c=CASE WHEN excluded.last_sampled_at>=onewire_daily.last_sampled_at THEN excluded.last_c ELSE onewire_daily.last_c END,
       last_sampled_at=MAX(onewire_daily.last_sampled_at,excluded.last_sampled_at)`);
    let inserted = 0;
    for (const device of devices) {
        if (!isOneWireTemperature(device) || !device.online || !Number.isFinite(device.temperatureC))
            continue;
        const sampledAt = device.temperatureUpdatedAt && Number.isFinite(Date.parse(device.temperatureUpdatedAt))
            ? device.temperatureUpdatedAt
            : fallbackTimestamp;
        const temperature = Number(device.temperatureC);
        const result = insert.run(serial, device.serial, sampledAt, temperature);
        if (!result.changes)
            continue;
        daily.run(serial, device.serial, sampledAt.slice(0, 10), temperature, temperature, temperature, temperature, sampledAt);
        inserted += 1;
    }
    return inserted;
}
export function purgeOneWireHistory(db) {
    const samples = Number(db.prepare(`DELETE FROM onewire_samples WHERE sampled_at < datetime('now', '-${ONE_WIRE_RAW_RETENTION_MONTHS} months')`).run().changes);
    const daily = Number(db.prepare(`DELETE FROM onewire_daily WHERE day < date('now', '-${ONE_WIRE_DAILY_RETENTION_YEARS} years')`).run().changes);
    return { samples, daily };
}
function sinceForRange(range) {
    const now = Date.now();
    const milliseconds = range === "24h" ? 24 * 60 * 60_000
        : range === "7d" ? 7 * 24 * 60 * 60_000
            : range === "30d" ? 30 * 24 * 60 * 60_000
                : range === "13m" ? 397 * 24 * 60 * 60_000
                    : 5 * 366 * 24 * 60 * 60_000;
    return new Date(now - milliseconds).toISOString();
}
function parseInventoryPayload(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
export function readOneWireHistory(db, serial, range) {
    const inventory = db.prepare(`SELECT device_serial,name,online,payload_json FROM device_inventory
     WHERE serial=? AND lower(type) LIKE '%onewire%' AND lower(COALESCE(json_extract(payload_json,'$.family'),'')) LIKE '%28'
     ORDER BY name COLLATE NOCASE,device_serial`).all(serial);
    const useDaily = range === "13m" || range === "5y";
    const since = sinceForRange(range);
    const sensors = inventory.map((device) => {
        const payload = parseInventoryPayload(device.payload_json);
        const rows = useDaily
            ? db.prepare(`SELECT day AS at,(sum_c/sample_count) AS value,min_c AS min,max_c AS max,sample_count AS samples
         FROM onewire_daily WHERE serial=? AND device_serial=? AND day>=date(?) ORDER BY day`).all(serial, device.device_serial, since)
            : db.prepare(`SELECT sampled_at AS at,temperature_c AS value,temperature_c AS min,temperature_c AS max,1 AS samples
         FROM onewire_samples WHERE serial=? AND device_serial=? AND sampled_at>=? ORDER BY sampled_at`).all(serial, device.device_serial, since);
        const points = rows.map((row) => ({
            at: row.at,
            value: Number(row.value),
            min: Number(row.min),
            max: Number(row.max),
            samples: Number(row.samples),
        }));
        const sampleCount = points.reduce((sum, point) => sum + point.samples, 0);
        const weightedSum = points.reduce((sum, point) => sum + point.value * point.samples, 0);
        return {
            deviceSerial: device.device_serial,
            name: device.name || device.device_serial,
            currentC: typeof payload.temperatureC === "number" ? payload.temperatureC : null,
            currentAt: typeof payload.temperatureUpdatedAt === "string" ? payload.temperatureUpdatedAt : null,
            online: device.online === 1,
            points,
            minimumC: points.length ? Math.min(...points.map((point) => point.min)) : null,
            averageC: sampleCount ? weightedSum / sampleCount : null,
            maximumC: points.length ? Math.max(...points.map((point) => point.max)) : null,
        };
    });
    return {
        serial,
        range,
        resolution: useDaily ? "day" : "sample",
        rawRetentionMonths: ONE_WIRE_RAW_RETENTION_MONTHS,
        dailyRetentionYears: ONE_WIRE_DAILY_RETENTION_YEARS,
        sensors,
    };
}
