export function resolveFirmwareUpdatePolicy(db, serial) {
    const row = db.prepare(`
    WITH RECURSIVE folder_chain(id,name,parent_id,firmware_update_policy,depth) AS (
      SELECT f.id,f.name,f.parent_id,f.firmware_update_policy,0
      FROM miniservers m
      JOIN project_folders f ON f.id=m.folder_id
      WHERE m.serial=?
      UNION ALL
      SELECT parent.id,parent.name,parent.parent_id,parent.firmware_update_policy,folder_chain.depth+1
      FROM project_folders parent
      JOIN folder_chain ON folder_chain.parent_id=parent.id
    )
    SELECT id,name,firmware_update_policy
    FROM folder_chain
    WHERE firmware_update_policy<>'immediate'
    ORDER BY depth
    LIMIT 1
  `).get(serial.toUpperCase());
    return row?.firmware_update_policy === "weekend_night"
        ? { policy: "weekend_night", folderId: row.id, folderName: row.name }
        : { policy: "immediate", folderId: null, folderName: null };
}
