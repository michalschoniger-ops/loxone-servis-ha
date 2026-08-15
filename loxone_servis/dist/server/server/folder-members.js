import { transaction } from "./database.js";
export function replaceProjectFolderMembers(db, folderId, serials, updatedAt = new Date().toISOString()) {
    const uniqueSerials = Array.from(new Set(serials));
    return transaction(db, () => {
        db.prepare("UPDATE miniservers SET folder_id=NULL,updated_at=? WHERE folder_id=?")
            .run(updatedAt, folderId);
        if (!uniqueSerials.length)
            return 0;
        const placeholders = uniqueSerials.map(() => "?").join(",");
        const result = db.prepare(`UPDATE miniservers SET folder_id=?,updated_at=? WHERE serial IN (${placeholders})`)
            .run(folderId, updatedAt, ...uniqueSerials);
        return Number(result.changes);
    });
}
