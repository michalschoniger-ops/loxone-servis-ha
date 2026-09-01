export const FIRMWARE_UPDATE_TIME_ZONE = "Europe/Prague";
export const WEEKEND_NIGHT_POLICY_LABEL = "pá–ne 22:00–04:00";
const WEEKEND_NIGHT_START_MINUTE = 22 * 60;
const WEEKEND_NIGHT_END_MINUTE = 4 * 60;
const WEEKEND_NIGHT_START_DAYS = new Set([0, 5, 6]);
const localDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: FIRMWARE_UPDATE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});
function localDateTime(at) {
    const values = Object.fromEntries(localDateTimeFormatter
        .formatToParts(at)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]));
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second,
    };
}
function localCalendarDay(value) {
    return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}
function addLocalDays(value, days) {
    const result = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
    return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}
function localDateTimeToUtc(value) {
    const targetAsUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
    let candidate = targetAsUtc;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const represented = localDateTime(new Date(candidate));
        const representedAsUtc = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute, represented.second);
        const correction = targetAsUtc - representedAsUtc;
        candidate += correction;
        if (correction === 0)
            break;
    }
    return new Date(candidate);
}
function weekendNightAllowed(now) {
    const local = localDateTime(now);
    const minute = local.hour * 60 + local.minute;
    if (minute >= WEEKEND_NIGHT_START_MINUTE) {
        return WEEKEND_NIGHT_START_DAYS.has(localCalendarDay(local));
    }
    if (minute < WEEKEND_NIGHT_END_MINUTE) {
        return WEEKEND_NIGHT_START_DAYS.has(localCalendarDay(addLocalDays(local, -1)));
    }
    return false;
}
function nextWeekendNightStart(now) {
    const local = localDateTime(now);
    for (let offset = 0; offset <= 7; offset += 1) {
        const date = addLocalDays(local, offset);
        if (!WEEKEND_NIGHT_START_DAYS.has(localCalendarDay(date)))
            continue;
        const candidate = localDateTimeToUtc({ ...date, hour: 22, minute: 0, second: 0 });
        if (candidate.getTime() > now.getTime())
            return candidate;
    }
    throw new Error("Další povolené okno aktualizací se nepodařilo vypočítat.");
}
export function firmwareUpdateWindowDecision(policy, at = Date.now()) {
    const now = at instanceof Date ? new Date(at.getTime()) : new Date(at);
    if (!Number.isFinite(now.getTime()))
        throw new Error("Čas požadavku na aktualizaci není platný.");
    if (policy === "immediate") {
        return {
            allowedNow: true,
            notBeforeAt: null,
            policy,
            timeZone: FIRMWARE_UPDATE_TIME_ZONE,
            label: "bez časového omezení",
        };
    }
    const allowedNow = weekendNightAllowed(now);
    return {
        allowedNow,
        notBeforeAt: allowedNow ? null : nextWeekendNightStart(now).toISOString(),
        policy,
        timeZone: FIRMWARE_UPDATE_TIME_ZONE,
        label: WEEKEND_NIGHT_POLICY_LABEL,
    };
}
export function formatFirmwareUpdateSchedule(at) {
    const parsed = new Date(at);
    if (!Number.isFinite(parsed.getTime()))
        return at;
    return new Intl.DateTimeFormat("cs-CZ", {
        timeZone: FIRMWARE_UPDATE_TIME_ZONE,
        weekday: "short",
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(parsed);
}
