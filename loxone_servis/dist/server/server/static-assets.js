export function cacheControlForStaticPath(path) {
    return /[/\\]assets[/\\]/.test(path)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
}
export function isSpaNavigationRequest(url, accept) {
    if (!accept?.toLowerCase().includes("text/html"))
        return false;
    const pathname = new URL(url, "http://localhost").pathname;
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
    return !lastSegment.includes(".");
}
