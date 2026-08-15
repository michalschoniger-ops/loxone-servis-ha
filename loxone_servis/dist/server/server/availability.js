export const AVAILABILITY_FAILURE_THRESHOLD = 3;
export const AVAILABILITY_RETRY_DELAY_MS = 5 * 60_000;
export const RECENT_ONLINE_GRACE_MS = 6 * 60 * 60_000;
function wasRecentlyOnline(previous, nowMs) {
    if (previous.connectionState !== "online" || !previous.lastSuccessAt)
        return false;
    const timestamp = Date.parse(previous.lastSuccessAt);
    return Number.isFinite(timestamp)
        && timestamp <= nowMs + 60_000
        && nowMs - timestamp <= RECENT_ONLINE_GRACE_MS;
}
export function stabilizeAvailability(previous, observedState, nowMs, regularCheckDelayMs) {
    if (observedState === "online") {
        return {
            connectionState: "online",
            consecutiveFailures: 0,
            nextCheckAt: new Date(nowMs + regularCheckDelayMs).toISOString(),
            heldRecentOnline: false,
            retryScheduled: false,
        };
    }
    const consecutiveFailures = Math.max(0, previous.consecutiveFailures) + 1;
    if (observedState === "no_access") {
        return {
            connectionState: "no_access",
            consecutiveFailures,
            nextCheckAt: new Date(nowMs + regularCheckDelayMs).toISOString(),
            heldRecentOnline: false,
            retryScheduled: false,
        };
    }
    const retryScheduled = consecutiveFailures < AVAILABILITY_FAILURE_THRESHOLD;
    const heldRecentOnline = retryScheduled && wasRecentlyOnline(previous, nowMs);
    return {
        connectionState: retryScheduled
            ? heldRecentOnline ? "online" : "unknown"
            : observedState,
        consecutiveFailures,
        nextCheckAt: new Date(nowMs + (retryScheduled ? AVAILABILITY_RETRY_DELAY_MS : regularCheckDelayMs)).toISOString(),
        heldRecentOnline,
        retryScheduled,
    };
}
