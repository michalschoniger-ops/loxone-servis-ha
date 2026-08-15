import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
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
    addColumn(db, "miniservers", "local_url TEXT");
    addColumn(db, "miniservers", "connection_url TEXT");
    addColumn(db, "miniservers", "connection_transport TEXT");
    addColumn(db, "miniservers", "connection_resolved_at TEXT");
    addColumn(db, "miniservers", "last_latency_ms INTEGER");
    addColumn(db, "miniservers", "health_verdict TEXT");
    addColumn(db, "miniservers", "loxapp_version TEXT");
    addColumn(db, "miniservers", "current_project_hash TEXT");
    addColumn(db, "miniservers", "firmware_channel TEXT NOT NULL DEFAULT 'stable'");
    addColumn(db, "miniservers", "last_success_at TEXT");
    addColumn(db, "miniservers", "consecutive_failures INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "miniservers", "next_check_at TEXT");
    addColumn(db, "miniservers", "remote_app_url TEXT");
    addColumn(db, "miniservers", "manual_only INTEGER NOT NULL DEFAULT 0");
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
    CREATE TABLE IF NOT EXISTS firmware_releases (
      channel TEXT PRIMARY KEY CHECK(channel IN ('stable','beta','alpha')),
      version TEXT,
      config_url TEXT,
      published_at TEXT,
      source_url TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      error_code TEXT
    );
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
  `);
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
}
function ensureBootstrapAdmin(db) {
    const count = db.prepare("SELECT COUNT(*) AS count FROM users").get();
    if (count.count > 0)
        return;
    if (!config.bootstrapAdminPasswordHash) {
        if (config.localSetupAllowed)
            return;
        throw new Error("Databáze nemá správce a BOOTSTRAP_ADMIN_PASSWORD_HASH není nastaven.");
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,email,password_hash,role,immutable,active,created_at,updated_at,mfa_enabled)
     VALUES(?,?,?,?,1,1,?,?,0)`).run(randomUUID(), config.bootstrapAdminEmail.toLowerCase(), config.bootstrapAdminPasswordHash, "admin", now, now);
}
export function openDatabase() {
    migrateLegacyDatabase(config.databasePath);
    const database = new DatabaseSync(config.databasePath);
    applyMigrations(database);
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok")
        throw new Error(`Databáze neprošla kontrolou integrity: ${integrity.integrity_check}`);
    ensureBootstrapAdmin(database);
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
//# sourceMappingURL=database.js.map