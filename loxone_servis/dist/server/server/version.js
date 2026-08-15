export function parseVersion(version) {
    if (!version)
        return null;
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
}
export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b)
        return null;
    for (let index = 0; index < 4; index += 1) {
        if (a[index] !== b[index])
            return a[index] - b[index];
    }
    return 0;
}
export function firmwareRelation(current, target) {
    const result = compareVersions(current, target);
    if (result === null)
        return "unknown";
    if (result === 0)
        return "current";
    return result > 0 ? "newer" : "older";
}
//# sourceMappingURL=version.js.map