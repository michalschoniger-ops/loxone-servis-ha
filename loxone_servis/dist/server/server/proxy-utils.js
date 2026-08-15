export function canonicalPathPrefix(canonicalBaseUrl) {
    const pathname = new URL(canonicalBaseUrl).pathname.replace(/\/+$/, "");
    return pathname === "/" ? "" : pathname;
}
export function canonicalTargetUrl(rawUrl, canonicalBaseUrl) {
    const safeRelative = rawUrl.startsWith("/") ? rawUrl.slice(1) : rawUrl;
    return new URL(safeRelative, `${canonicalBaseUrl}/`);
}
export function rewriteClientSetCookie(value, canonicalBaseUrl, secureClient) {
    const prefix = canonicalPathPrefix(canonicalBaseUrl);
    let rewritten = prefix
        ? value.replace(new RegExp(`Path=${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`, "i"), "Path=/")
        : value;
    if (!secureClient)
        rewritten = rewritten.replace(/;\s*Secure(?=;|$)/gi, "");
    return rewritten;
}
export function rewriteClientLocation(value, canonicalBaseUrl) {
    try {
        const resolved = new URL(value, canonicalBaseUrl);
        const canonical = new URL(canonicalBaseUrl);
        if (resolved.origin !== canonical.origin)
            return value;
        const prefix = canonicalPathPrefix(canonicalBaseUrl);
        const pathname = prefix && (resolved.pathname === prefix || resolved.pathname.startsWith(`${prefix}/`))
            ? resolved.pathname.slice(prefix.length) || "/"
            : resolved.pathname;
        return `${pathname}${resolved.search}${resolved.hash}`;
    }
    catch {
        return value;
    }
}
//# sourceMappingURL=proxy-utils.js.map