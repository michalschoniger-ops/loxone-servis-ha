import { config } from "./config.js";
function notificationTarget() {
    if (!config.haNotifyService)
        return null;
    const match = config.haNotifyService.match(/^([a-z0-9_]+)\.([a-z0-9_]+)$/i);
    return match ? { domain: match[1], service: match[2] } : null;
}
export async function notifyHomeAssistant(options) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (!supervisorToken)
        return false;
    const target = notificationTarget();
    const url = options.path && config.publicBaseUrl
        ? new URL(options.path.replace(/^\//, ""), `${config.publicBaseUrl.replace(/\/$/, "")}/`).toString()
        : config.publicBaseUrl || undefined;
    const endpoint = target
        ? `http://supervisor/core/api/services/${target.domain}/${target.service}`
        : "http://supervisor/core/api/services/persistent_notification/create";
    const payload = target
        ? {
            title: options.title,
            message: options.message,
            data: url ? { url, clickAction: url } : {},
        }
        : {
            title: options.title,
            message: url ? `${options.message}\n\n${url}` : options.message,
            notification_id: `loxone_servis_${options.id.replace(/[^a-z0-9_]/gi, "_")}`,
        };
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${supervisorToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
