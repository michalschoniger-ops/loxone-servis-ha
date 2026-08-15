function compareFolders(left, right) {
    return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "cs");
}
export function flattenProjectFolders(folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const children = new Map();
    for (const folder of folders) {
        const validParent = folder.parentId && folder.parentId !== folder.id && byId.has(folder.parentId)
            ? folder.parentId
            : null;
        children.set(validParent, [...(children.get(validParent) ?? []), folder]);
    }
    for (const entries of children.values())
        entries.sort(compareFolders);
    const result = [];
    const visited = new Set();
    const visit = (folder, ancestorIds, names) => {
        if (visited.has(folder.id))
            return;
        visited.add(folder.id);
        const pathNames = [...names, folder.name];
        result.push({ folder, depth: ancestorIds.length, ancestorIds, path: pathNames.join(" / ") });
        for (const child of children.get(folder.id) ?? [])
            visit(child, [...ancestorIds, folder.id], pathNames);
    };
    for (const root of children.get(null) ?? [])
        visit(root, [], []);
    // Poškozený nebo cyklický historický záznam nesmí složku skrýt z UI.
    for (const folder of [...folders].sort(compareFolders))
        visit(folder, [], []);
    return result;
}
export function projectFolderDescendantIds(folders, folderId) {
    const descendants = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const folder of folders) {
            if (!folder.parentId || descendants.has(folder.id))
                continue;
            if (folder.parentId === folderId || descendants.has(folder.parentId)) {
                descendants.add(folder.id);
                changed = true;
            }
        }
    }
    return descendants;
}
export function wouldCreateProjectFolderCycle(folders, folderId, parentId) {
    if (!parentId)
        return false;
    return parentId === folderId || projectFolderDescendantIds(folders, folderId).has(parentId);
}
