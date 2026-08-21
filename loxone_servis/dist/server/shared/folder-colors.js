export const folderColorPalette = [
    "#58D73A",
    "#18A5E8",
    "#F28C28",
    "#8B5CF6",
    "#E5488D",
    "#00A78E",
    "#D94A4A",
    "#D2A106",
    "#4078D8",
    "#A456B3",
    "#59A14F",
    "#EF6C5B",
    "#2A9D8F",
    "#6C7A89",
    "#B87333",
    "#00B8D9",
    "#7CB342",
    "#C2185B",
    "#5C6BC0",
    "#00897B",
];
function normalizedColor(value) {
    return /^#[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : "";
}
export function nextDistinctFolderColor(usedColors) {
    const used = new Set(Array.from(usedColors, normalizedColor).filter(Boolean));
    return folderColorPalette.find((color) => !used.has(color)) ?? folderColorPalette[used.size % folderColorPalette.length];
}
export function distinctFolderColorAssignments(folders) {
    const result = new Map();
    const used = new Set();
    for (const folder of folders) {
        const requested = normalizedColor(folder.color);
        const color = requested && !used.has(requested)
            ? requested
            : nextDistinctFolderColor(used);
        used.add(color);
        result.set(folder.id, color);
    }
    return result;
}
