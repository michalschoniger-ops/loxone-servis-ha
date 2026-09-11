const TIME_ZONE = "Europe/Prague";
const WEEKLY_LABEL = "Po–Čt 7:30–17:00 · Pá 7:30–12:00";
function pragueParts(now) {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now).map((part) => [part.type, part.value]));
    return {
        weekday: values.weekday ?? "",
        hour: Number.parseInt(values.hour ?? "0", 10),
        minute: Number.parseInt(values.minute ?? "0", 10),
    };
}
export function supportHoursToday(now = new Date()) {
    const { weekday, hour, minute } = pragueParts(now);
    const minutes = hour * 60 + minute;
    if (weekday === "Sat" || weekday === "Sun") {
        return { open: false, label: "Dnes zavřeno", timeZone: TIME_ZONE, weeklyLabel: WEEKLY_LABEL };
    }
    if (weekday === "Fri") {
        return {
            open: minutes >= 450 && minutes < 720,
            label: "Dnes 7:30–12:00",
            timeZone: TIME_ZONE,
            weeklyLabel: WEEKLY_LABEL,
        };
    }
    return {
        open: minutes >= 450 && minutes < 1020,
        label: "Dnes 7:30–17:00",
        timeZone: TIME_ZONE,
        weeklyLabel: WEEKLY_LABEL,
    };
}
