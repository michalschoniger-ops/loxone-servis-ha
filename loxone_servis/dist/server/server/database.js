import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { distinctFolderColorAssignments } from "../shared/folder-colors.js";
function quoteSqlitePath(path) {
    return `'${path.replaceAll("'", "''")}'`;
}
function findLegacyDatabase(root) {
    if (!existsSync(root))
        return null;
    const queue = [root];
    while (queue.length) {
        const directory = queue.shift();
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                queue.push(path);
                continue;
            }
            if (extname(entry.name) !== ".sqlite" || entry.name.endsWith("-shm") || entry.name.endsWith("-wal"))
                continue;
            let candidate = null;
            try {
                candidate = new DatabaseSync(path, { readOnly: true });
                const row = candidate
                    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'miniservers'")
                    .get();
                if (row?.ok === 1)
                    return path;
            }
            catch {
                // Jiný interní SQLite soubor Wrangleru není chybou migrace.
            }
            finally {
                candidate?.close();
            }
        }
    }
    return null;
}
function migrateLegacyDatabase(targetPath) {
    if (existsSync(targetPath))
        return;
    const sourcePath = findLegacyDatabase(config.legacyStateDirectory);
    if (!sourcePath)
        return;
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    const source = new DatabaseSync(sourcePath);
    try {
        const integrity = source.prepare("PRAGMA integrity_check").get();
        if (integrity.integrity_check !== "ok")
            throw new Error(`Integrita staré databáze není v pořádku: ${integrity.integrity_check}`);
        source.exec("PRAGMA wal_checkpoint(FULL)");
        source.exec(`VACUUM INTO ${quoteSqlitePath(targetPath)}`);
    }
    finally {
        source.close();
    }
}
function addColumn(db, table, definition) {
    const name = definition.trim().split(/\s+/)[0];
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
function migrateDistinctFolderColors(db) {
    const applied = db.prepare("SELECT 1 AS ok FROM schema_migrations WHERE version=16").get();
    if (applied?.ok === 1)
        return;
    const folders = db.prepare("SELECT id,color FROM project_folders ORDER BY sort_order,name COLLATE NOCASE,id").all();
    const assignments = distinctFolderColorAssignments(folders);
    const update = db.prepare("UPDATE project_folders SET color=?,updated_at=? WHERE id=? AND color<>?");
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const folder of folders) {
            const color = assignments.get(folder.id) ?? folder.color;
            update.run(color, now, folder.id, color);
        }
        db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(16, now);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
/** @internal Exported for a focused migration regression test. */
export function migrateServiceTaskExcelWritebackStates(db) {
    const applied = db.prepare("SELECT 1 AS ok FROM schema_migrations WHERE version=21").get();
    if (applied?.ok === 1)
        return;
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='service_task_excel_links'").get();
    const now = new Date().toISOString();
    if (!schema?.sql || schema.sql.includes("'synced'")) {
        db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(21, now);
        return;
    }
    db.exec("PRAGMA foreign_keys = OFF");
    try {
        db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE service_task_excel_links RENAME TO service_task_excel_links_v19;
      DROP INDEX IF EXISTS idx_service_task_excel_row;
      DROP INDEX IF EXISTS idx_service_task_excel_fingerprint;
      CREATE TABLE service_task_excel_links (
        task_id TEXT PRIMARY KEY,
        sheet_name TEXT NOT NULL,
        row_number INTEGER NOT NULL,
        source_fingerprint TEXT NOT NULL,
        row_hash TEXT NOT NULL,
        last_imported_at TEXT NOT NULL,
        local_status_dirty INTEGER NOT NULL DEFAULT 0,
        writeback_state TEXT NOT NULL DEFAULT 'current' CHECK(writeback_state IN ('current','pending','blocked','synced')),
        writeback_error TEXT,
        last_writeback_at TEXT,
        FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE
      );
      INSERT INTO service_task_excel_links(
        task_id,sheet_name,row_number,source_fingerprint,row_hash,last_imported_at,
        local_status_dirty,writeback_state,writeback_error,last_writeback_at
      )
      SELECT task_id,sheet_name,row_number,source_fingerprint,row_hash,last_imported_at,
        local_status_dirty,CASE WHEN writeback_state='read_only' THEN 'current' ELSE writeback_state END,
        writeback_error,last_writeback_at
      FROM service_task_excel_links_v19;
      DROP TABLE service_task_excel_links_v19;
      CREATE INDEX idx_service_task_excel_row ON service_task_excel_links(sheet_name,row_number);
      CREATE INDEX idx_service_task_excel_fingerprint ON service_task_excel_links(source_fingerprint);
      COMMIT;
    `);
        db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(21, now);
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch { /* transakce už mohla skončit */ }
        throw error;
    }
    finally {
        db.exec("PRAGMA foreign_keys = ON");
    }
    const violation = db.prepare("PRAGMA foreign_key_check").get();
    if (violation)
        throw new Error("Migrace Excel writebacku porušila vazby databáze.");
}
function migrateUserRoles(db) {
    const schema = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
        .get();
    if (!schema?.sql || schema.sql.includes("'viewer'"))
        return;
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE sessions RENAME TO sessions_role_migration;
    ALTER TABLE users RENAME TO users_role_migration;
    DROP INDEX IF EXISTS idx_sessions_user_id;
    DROP INDEX IF EXISTS idx_users_email;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'technician', 'viewer')),
      immutable INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      mfa_secret_encrypted TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      failed_mfa_attempts INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT
    );
    INSERT INTO users(id,email,password_hash,role,immutable,active,created_at,updated_at)
      SELECT id,email,password_hash,role,immutable,active,created_at,updated_at FROM users_role_migration;
    CREATE UNIQUE INDEX idx_users_email ON users(email);
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      csrf_hash TEXT,
      ip_hash TEXT,
      user_agent_hash TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at)
      SELECT token_hash,user_id,expires_at,created_at,last_seen_at FROM sessions_role_migration;
    CREATE INDEX idx_sessions_user_id ON sessions(user_id);
    DROP TABLE sessions_role_migration;
    DROP TABLE users_role_migration;
    COMMIT;
  `);
    db.exec("PRAGMA foreign_keys = ON");
}
function applyMigrations(db) {
    db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
    const hasLegacySchema = db
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='miniservers'")
        .get();
    if (!hasLegacySchema?.ok) {
        db.exec(`
      CREATE TABLE miniservers (
        serial TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project TEXT NOT NULL,
        registered TEXT NOT NULL DEFAULT '',
        username_encrypted TEXT,
        password_encrypted TEXT,
        credential_source TEXT NOT NULL DEFAULT 'manual',
        access_policy TEXT NOT NULL DEFAULT 'managed',
        target_firmware TEXT NOT NULL DEFAULT '',
        firmware_policy TEXT NOT NULL DEFAULT 'follow_stable',
        current_firmware TEXT,
        connection_state TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at TEXT,
        last_error TEXT,
        elements_online INTEGER,
        elements_total INTEGER,
        elements_offline_detail TEXT,
        elements_checked_at TEXT,
        elements_error TEXT,
        update_status TEXT NOT NULL DEFAULT 'idle',
        update_started_at TEXT,
        update_deadline_at TEXT,
        excluded INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_miniservers_connection_state ON miniservers(connection_state);
      CREATE INDEX idx_miniservers_update_status ON miniservers(update_status);
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'technician', 'viewer')),
        immutable INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        mfa_secret_encrypted TEXT,
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        failed_mfa_attempts INTEGER NOT NULL DEFAULT 0,
        last_login_at TEXT
      );
      CREATE UNIQUE INDEX idx_users_email ON users(email);
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        csrf_hash TEXT,
        ip_hash TEXT,
        user_agent_hash TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_sessions_user_id ON sessions(user_id);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        serial TEXT,
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
      CREATE TABLE login_attempts (
        email TEXT PRIMARY KEY,
        failures INTEGER NOT NULL DEFAULT 0,
        first_failure_at TEXT,
        locked_until TEXT
      );
    `);
    }
    else {
        migrateUserRoles(db);
    }
    addColumn(db, "miniservers", "gateway_serial TEXT");
    addColumn(db, "miniservers", "folder_id TEXT");
    addColumn(db, "miniservers", "gateway_role TEXT NOT NULL DEFAULT 'unknown'");
    addColumn(db, "miniservers", "gateway_role_source TEXT NOT NULL DEFAULT 'unknown'");
    addColumn(db, "miniservers", "gateway_detected_role TEXT");
    addColumn(db, "miniservers", "gateway_detected_at TEXT");
    addColumn(db, "miniservers", "local_url TEXT");
    addColumn(db, "miniservers", "connection_url TEXT");
    addColumn(db, "miniservers", "connection_transport TEXT");
    addColumn(db, "miniservers", "connection_resolved_at TEXT");
    addColumn(db, "miniservers", "last_latency_ms INTEGER");
    addColumn(db, "miniservers", "health_verdict TEXT");
    addColumn(db, "miniservers", "health_refreshed_at TEXT");
    addColumn(db, "miniservers", "loxapp_version TEXT");
    addColumn(db, "miniservers", "loxapp_refreshed_at TEXT");
    addColumn(db, "miniservers", "onewire_sampled_at TEXT");
    addColumn(db, "miniservers", "current_project_hash TEXT");
    addColumn(db, "miniservers", "firmware_channel TEXT NOT NULL DEFAULT 'stable'");
    addColumn(db, "miniservers", "firmware_policy TEXT NOT NULL DEFAULT 'follow_stable'");
    addColumn(db, "miniservers", "last_success_at TEXT");
    addColumn(db, "miniservers", "consecutive_failures INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "miniservers", "next_check_at TEXT");
    addColumn(db, "miniservers", "remote_app_url TEXT");
    addColumn(db, "miniservers", "manual_only INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "miniservers", "weather_service_status TEXT NOT NULL DEFAULT 'unknown'");
    addColumn(db, "miniservers", "weather_service_checked_at TEXT");
    addColumn(db, "users", "avatar_mime TEXT");
    addColumn(db, "users", "avatar_data TEXT");
    addColumn(db, "users", "avatar_updated_at TEXT");
    addColumn(db, "users", "display_name TEXT NOT NULL DEFAULT ''");
    if (!db.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "mfa_enabled")) {
        addColumn(db, "users", "mfa_secret_encrypted TEXT");
        addColumn(db, "users", "mfa_enabled INTEGER NOT NULL DEFAULT 0");
        addColumn(db, "users", "failed_mfa_attempts INTEGER NOT NULL DEFAULT 0");
        addColumn(db, "users", "last_login_at TEXT");
    }
    if (!db.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === "csrf_hash")) {
        addColumn(db, "sessions", "csrf_hash TEXT");
        addColumn(db, "sessions", "ip_hash TEXT");
        addColumn(db, "sessions", "user_agent_hash TEXT");
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS project_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES project_folders(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miniservers_folder ON miniservers(folder_id);
    CREATE INDEX IF NOT EXISTS idx_miniservers_gateway ON miniservers(gateway_serial);
    CREATE TABLE IF NOT EXISTS firmware_releases (
      channel TEXT PRIMARY KEY CHECK(channel IN ('stable','beta','alpha')),
      version TEXT,
      config_url TEXT,
      published_at TEXT,
      source_url TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      error_code TEXT
    );
    CREATE TABLE IF NOT EXISTS firmware_release_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL CHECK(channel IN ('stable','beta','alpha')),
      version TEXT NOT NULL,
      config_url TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      UNIQUE(channel,version,config_url)
    );
    CREATE INDEX IF NOT EXISTS idx_release_history_channel_time
      ON firmware_release_history(channel, first_seen_at DESC);
    CREATE TABLE IF NOT EXISTS jwt_tokens (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      user_fingerprint TEXT NOT NULL,
      token_encrypted TEXT NOT NULL,
      permission INTEGER NOT NULL,
      valid_until TEXT,
      last_validated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(serial, user_fingerprint, permission),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      verdict TEXT NOT NULL,
      plc_state TEXT,
      cpu_load REAL,
      heap_used INTEGER,
      heap_total INTEGER,
      task_count INTEGER,
      active_connections INTEGER,
      clock_drift_seconds REAL,
      dns_ok INTEGER,
      ntp_ok INTEGER,
      tls_ok INTEGER,
      sd_state TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_health_serial_time ON health_snapshots(serial, checked_at DESC);
    CREATE TABLE IF NOT EXISTS device_inventory (
      serial TEXT NOT NULL,
      device_serial TEXT NOT NULL,
      parent_serial TEXT,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      firmware TEXT,
      online INTEGER NOT NULL DEFAULT 1,
      first_offline_at TEXT,
      last_seen_at TEXT,
      system_message TEXT,
      device_index INTEGER,
      source TEXT NOT NULL DEFAULT 'status',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(serial, device_serial),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_devices_online ON device_inventory(serial, online);
    CREATE TABLE IF NOT EXISTS onewire_samples (
      serial TEXT NOT NULL,
      device_serial TEXT NOT NULL,
      sampled_at TEXT NOT NULL,
      temperature_c REAL NOT NULL,
      PRIMARY KEY(serial,device_serial,sampled_at),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_onewire_samples_time
      ON onewire_samples(serial,device_serial,sampled_at DESC);
    CREATE TABLE IF NOT EXISTS onewire_daily (
      serial TEXT NOT NULL,
      device_serial TEXT NOT NULL,
      day TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      sum_c REAL NOT NULL,
      min_c REAL NOT NULL,
      max_c REAL NOT NULL,
      last_c REAL NOT NULL,
      last_sampled_at TEXT NOT NULL,
      PRIMARY KEY(serial,device_serial,day),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS project_snapshots (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      loxapp_version TEXT,
      content_hash TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_snapshots_serial ON project_snapshots(serial, created_at DESC);
    CREATE TABLE IF NOT EXISTS project_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL,
      from_snapshot_id TEXT,
      to_snapshot_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS action_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      serial TEXT,
      state TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      actor_user_id TEXT,
      confirmation_id TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      deadline_at TEXT,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_state_time ON action_jobs(state, created_at);
    CREATE TABLE IF NOT EXISTS action_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      step TEXT NOT NULL,
      state TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES action_jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS action_confirmations (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      serial TEXT,
      payload_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS availability_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL,
      state TEXT NOT NULL,
      error_code TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_availability_serial_time ON availability_events(serial, created_at DESC);
    CREATE TABLE IF NOT EXISTS operating_modes (
      serial TEXT NOT NULL,
      mode_id TEXT NOT NULL,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(serial, mode_id),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS statistics_catalog (
      serial TEXT NOT NULL,
      statistic_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT,
      last_value REAL,
      last_value_at TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(serial, statistic_id),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_audit_snapshots (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      created_at TEXT NOT NULL,
      admin_count INTEGER,
      weak_password_count INTEGER,
      expired_count INTEGER,
      summary_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS lan_probe_targets (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(serial, url),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS service_bundles (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sha256 TEXT,
      expires_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notification_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_encrypted TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fleet_installations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instance_url TEXT,
      instance_id TEXT,
      app_version TEXT,
      last_seen_at TEXT,
      role TEXT NOT NULL DEFAULT 'standalone',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS home_assistant_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL UNIQUE,
      username_encrypted TEXT,
      password_encrypted TEXT,
      access_token_encrypted TEXT,
      monitoring_enabled INTEGER NOT NULL DEFAULT 1,
      connection_state TEXT NOT NULL DEFAULT 'unknown',
      auth_state TEXT NOT NULL DEFAULT 'not_configured',
      version TEXT,
      location_name TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_latency_ms INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_home_assistant_state ON home_assistant_instances(connection_state);
    CREATE TABLE IF NOT EXISTS home_assistant_monitors (
      id TEXT PRIMARY KEY,
      home_assistant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('melcloud','solarinvert')),
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'unknown' CHECK(state IN ('unknown','online','warning','unavailable')),
      last_checked_at TEXT,
      last_success_at TEXT,
      last_latency_ms INTEGER,
      last_error TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(home_assistant_id,kind),
      FOREIGN KEY(home_assistant_id) REFERENCES home_assistant_instances(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_home_assistant_monitors_state
      ON home_assistant_monitors(home_assistant_id,state);
    CREATE TABLE IF NOT EXISTS home_assistant_monitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      state TEXT NOT NULL,
      error_code TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(monitor_id) REFERENCES home_assistant_monitors(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_home_assistant_monitor_events_time
      ON home_assistant_monitor_events(monitor_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS camera_integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      http_port INTEGER NOT NULL DEFAULT 80,
      rtsp_port INTEGER NOT NULL DEFAULT 554,
      username_encrypted TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      firmware TEXT NOT NULL DEFAULT '',
      connection_state TEXT NOT NULL DEFAULT 'unknown' CHECK(connection_state IN ('unknown','online','unavailable','auth_error')),
      channels_json TEXT NOT NULL DEFAULT '[]',
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
    addColumn(db, "project_folders", "color TEXT NOT NULL DEFAULT '#58D73A'");
    addColumn(db, "home_assistant_instances", "updates_json TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "home_assistant_instances", "updates_checked_at TEXT");
    addColumn(db, "miniservers", "portal_product_id TEXT");
    addColumn(db, "miniservers", "portal_last_seen_at TEXT");
    addColumn(db, "miniservers", "portal_synced_project TEXT");
    addColumn(db, "miniservers", "portal_synced_type TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_miniservers_portal_seen ON miniservers(portal_last_seen_at)");
    // Starší instalace získají hierarchii beze změny dosavadních přiřazení.
    addColumn(db, "project_folders", "parent_id TEXT REFERENCES project_folders(id) ON DELETE SET NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_project_folders_parent ON project_folders(parent_id)");
    db.exec(`
    INSERT OR IGNORE INTO firmware_release_history(
      channel,version,config_url,first_seen_at,last_seen_at,source_url
    )
    SELECT channel,version,COALESCE(config_url,''),checked_at,checked_at,source_url
    FROM firmware_releases
    WHERE version IS NOT NULL
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports_json TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user ON passkey_credentials(user_id);
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('registration','authentication')),
      challenge TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS config_launcher_agents (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      helper_version TEXT,
      installed_versions_json TEXT NOT NULL DEFAULT '[]',
      last_seen_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'paired',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config_launcher_pairings (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_config_launcher_pairings_expiry
      ON config_launcher_pairings(expires_at);
    CREATE TABLE IF NOT EXISTS config_launch_jobs (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      required_version TEXT NOT NULL,
      launch_mode TEXT NOT NULL DEFAULT 'new_window' CHECK(launch_mode IN ('existing','new_window')),
      connection_url TEXT NOT NULL,
      config_url TEXT,
      state TEXT NOT NULL CHECK(state IN ('queued','delivered','launching','connecting','succeeded','missing_config','failed','expired')),
      message TEXT NOT NULL DEFAULT '',
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      finished_at TEXT,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE,
      FOREIGN KEY(agent_id) REFERENCES config_launcher_agents(id) ON DELETE CASCADE,
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_config_launch_jobs_agent_state
      ON config_launch_jobs(agent_id,state,created_at);
    CREATE TABLE IF NOT EXISTS worklog_tokens (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_hint TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_worklog_tokens_owner_active
      ON worklog_tokens(owner_user_id,active,created_at DESC);
    CREATE TABLE IF NOT EXISTS worklog_pairings (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_worklog_pairings_expiry
      ON worklog_pairings(expires_at);
    CREATE TABLE IF NOT EXISTS portal_ticket_cache (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL DEFAULT '',
      thread_count INTEGER NOT NULL DEFAULT 0,
      contact_name TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      detail_encrypted TEXT,
      detail_fingerprint TEXT,
      detail_cached_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portal_ticket_cache_order
      ON portal_ticket_cache(sort_order,id);
    CREATE TABLE IF NOT EXISTS miniserver_profiles (
      serial TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_role TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      preferred_channel TEXT NOT NULL DEFAULT 'phone',
      site_address TEXT NOT NULL DEFAULT '',
      site_type TEXT NOT NULL DEFAULT '',
      service_contract TEXT NOT NULL DEFAULT '',
      sla_hours INTEGER,
      warranty_until TEXT,
      next_service_at TEXT,
      custom_fields_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS miniserver_tags (
      serial TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY(serial,tag_id),
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id,scope,name),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
      status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      serial TEXT,
      ha_instance_id TEXT,
      launcher_agent_id TEXT,
      assignee_user_id TEXT,
      sla_due_at TEXT,
      first_detected_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL,
      resolved_at TEXT,
      source TEXT NOT NULL DEFAULT 'monitoring',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE SET NULL,
      FOREIGN KEY(ha_instance_id) REFERENCES home_assistant_instances(id) ON DELETE SET NULL,
      FOREIGN KEY(launcher_agent_id) REFERENCES config_launcher_agents(id) ON DELETE SET NULL,
      FOREIGN KEY(assignee_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_status_severity ON incidents(status,severity,last_detected_at DESC);
    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      author_user_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incident_events_time ON incident_events(incident_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS service_tasks (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('new','planned','in_progress','waiting','done','cancelled')),
      priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
      assignee_user_id TEXT,
      created_by_user_id TEXT NOT NULL,
      serial TEXT,
      incident_id TEXT,
      source TEXT NOT NULL DEFAULT 'internal',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      due_at TEXT,
      reminder_at TEXT,
      reminder_sent_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE SET NULL,
      FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_service_tasks_status_due ON service_tasks(status,due_at,priority);
    CREATE INDEX IF NOT EXISTS idx_service_tasks_assignee ON service_tasks(assignee_user_id,status);
    CREATE TABLE IF NOT EXISTS service_task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS service_task_attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      data_encrypted TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON service_task_attachments(task_id,created_at);
    CREATE TABLE IF NOT EXISTS service_task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      author_user_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS service_task_tags (
      task_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY(task_id,tag_id),
      FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS service_task_excel_links (
      task_id TEXT PRIMARY KEY,
      sheet_name TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      last_imported_at TEXT NOT NULL,
      local_status_dirty INTEGER NOT NULL DEFAULT 0,
      writeback_state TEXT NOT NULL DEFAULT 'current' CHECK(writeback_state IN ('current','pending','blocked','synced')),
      writeback_error TEXT,
      last_writeback_at TEXT,
      FOREIGN KEY(task_id) REFERENCES service_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_service_task_excel_row ON service_task_excel_links(sheet_name,row_number);
    CREATE INDEX IF NOT EXISTS idx_service_task_excel_fingerprint ON service_task_excel_links(source_fingerprint);
    CREATE TABLE IF NOT EXISTS intranet_contact_overrides (
      person_key TEXT PRIMARY KEY,
      person_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      updated_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intranet_contact_overrides_name
      ON intranet_contact_overrides(person_name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS connection_test_runs (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      state TEXT NOT NULL,
      result_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      FOREIGN KEY(serial) REFERENCES miniservers(serial) ON DELETE CASCADE,
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_connection_tests_serial_time ON connection_test_runs(serial,started_at DESC);
  `);
    addColumn(db, "config_launcher_agents", "owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
    addColumn(db, "config_launcher_agents", "diagnostics_json TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, "config_launcher_agents", "diagnostics_at TEXT");
    addColumn(db, "config_launch_jobs", "launch_mode TEXT NOT NULL DEFAULT 'new_window' CHECK(launch_mode IN ('existing','new_window'))");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_launcher_agents_owner_seen ON config_launcher_agents(owner_user_id,active,last_seen_at DESC)");
    db.exec("UPDATE config_launcher_agents SET active=0 WHERE owner_user_id IS NULL");
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(15, new Date().toISOString());
    migrateDistinctFolderColors(db);
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(17, new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(18, new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(19, new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(20, new Date().toISOString());
    migrateServiceTaskExcelWritebackStates(db);
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(22, new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(23, new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(24, new Date().toISOString());
}
function ensureBuiltInHomeAssistantMonitors(db) {
    const now = new Date().toISOString();
    const instances = db.prepare("SELECT id,name FROM home_assistant_instances").all();
    const insert = db.prepare(`INSERT INTO home_assistant_monitors(id,home_assistant_id,kind,name,config_json,enabled,created_at,updated_at)
     VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(home_assistant_id,kind) DO UPDATE SET
       name=excluded.name,config_json=excluded.config_json,enabled=1,updated_at=excluded.updated_at`);
    for (const instance of instances) {
        const normalized = instance.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (normalized.includes("vagner")) {
            insert.run(randomUUID(), instance.id, "melcloud", "MELCloud · klimatizace", JSON.stringify({
                configEntryId: "01KV581K7EQT1JZKYNCG20XXVY",
                units: ["obyvak", "holka", "kluk", "loznice", "kuchyn"],
            }), now, now);
        }
        if (normalized.includes("herskovic")) {
            insert.run(randomUUID(), instance.id, "solarinvert", "Větrná elektrárna · SolarInvert", JSON.stringify({
                transport: "ha_ingress",
                addonSlug: "local_solarinvert_logger",
                baseUrl: "http://homeassistant-herskovic.skunk-atria.ts.net:8765",
            }), now, now);
        }
    }
}
function ensureBootstrapAdmin(db) {
    const count = db.prepare("SELECT COUNT(*) AS count FROM users").get();
    const displayName = config.bootstrapAdminDisplayName.trim();
    if (count.count > 0) {
        if (displayName) {
            db.prepare("UPDATE users SET display_name=?,updated_at=? WHERE lower(email)=lower(?) AND trim(display_name)=''").run(displayName, new Date().toISOString(), config.bootstrapAdminEmail);
        }
        return;
    }
    if (!config.bootstrapAdminPasswordHash) {
        if (config.localSetupAllowed)
            return;
        throw new Error("Databáze nemá správce a BOOTSTRAP_ADMIN_PASSWORD_HASH není nastaven.");
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,email,display_name,password_hash,role,immutable,active,created_at,updated_at,mfa_enabled)
     VALUES(?,?,?,?,?,1,1,?,?,0)`).run(randomUUID(), config.bootstrapAdminEmail.toLowerCase(), displayName, config.bootstrapAdminPasswordHash, "admin", now, now);
}
export function openDatabase() {
    migrateLegacyDatabase(config.databasePath);
    const database = new DatabaseSync(config.databasePath);
    applyMigrations(database);
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok")
        throw new Error(`Databáze neprošla kontrolou integrity: ${integrity.integrity_check}`);
    ensureBootstrapAdmin(database);
    ensureBuiltInHomeAssistantMonitors(database);
    return database;
}
export function transaction(db, operation) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = operation();
        db.exec("COMMIT");
        return result;
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export function getSetting(db, key) {
    return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}
export function setSetting(db, key, value) {
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, value, new Date().toISOString());
}
export function audit(db, action, actorUserId, serial, details = {}) {
    const safeDetails = JSON.stringify(details, (key, value) => /password|secret|token|credential|authorization/i.test(key) ? "[REDACTED]" : value);
    db.prepare("INSERT INTO audit_log(actor_user_id,action,serial,details,created_at) VALUES(?,?,?,?,?)").run(actorUserId, action, serial, safeDetails, new Date().toISOString());
}
export function sqlValues(values) {
    return values;
}
export function databaseLabel() {
    return basename(config.databasePath);
}
