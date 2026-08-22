/**
 * Query strings may contain credentials from legacy clients. Request logs only
 * need the route path, so discard the whole query and fragment instead of
 * maintaining an inevitably incomplete list of secret parameter names.
 */
export function requestPathForLog(url) {
    if (typeof url !== "string")
        return "";
    const query = url.indexOf("?");
    const fragment = url.indexOf("#");
    const cutAt = [query, fragment].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    return cutAt === undefined ? url : url.slice(0, cutAt);
}
export function requestLogSerializer(request) {
    return {
        method: request.method,
        url: requestPathForLog(request.url),
        host: request.headers?.host ?? request.hostname,
        remoteAddress: request.ip ?? request.socket?.remoteAddress ?? request.remoteAddress,
        remotePort: request.socket?.remotePort ?? request.remotePort,
    };
}
