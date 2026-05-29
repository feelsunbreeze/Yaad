use honker::Database;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub honker_db: Database,
}

pub fn init_db(app_dir: PathBuf) -> Result<AppState, Box<dyn std::error::Error>> {
    let db_path = app_dir.join("reminders.db");
    let conn = Connection::open(&db_path)?;

    // Honker maintains its own connection over the same file for its
    // queue tables. We keep a separate connection for the application
    // tables — same file, WAL mode is safe.
    let honker_db = Database::open(&db_path)?;

    // ── Pragmas ───────────────────────────────────────────────────────────
    //
    // WAL gives us snapshot reads while honker writes to its queue
    // tables, plus much better concurrent read throughput. NORMAL
    // synchronous is the sweet spot for desktop apps — durability is good
    // enough that a crash can lose ≤ one transaction, never corrupt.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;",
    )?;

    // ── Schema ────────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reminders (
            id            TEXT PRIMARY KEY,
            title         TEXT NOT NULL,
            body          TEXT,
            status        TEXT NOT NULL,
            priority      INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            completed_at  INTEGER,
            tz            TEXT NOT NULL,
            source        TEXT NOT NULL,
            ai_meta       TEXT
        );
        CREATE TABLE IF NOT EXISTS occurrences (
            id            TEXT PRIMARY KEY,
            reminder_id   TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
            fire_at       INTEGER NOT NULL,
            state         TEXT NOT NULL,
            fired_at      INTEGER,
            resolved_at   INTEGER,
            UNIQUE(reminder_id, fire_at)
        );
        CREATE INDEX IF NOT EXISTS idx_occ_fire             ON occurrences(state, fire_at);
        CREATE INDEX IF NOT EXISTS idx_occ_reminder         ON occurrences(reminder_id, state);
        CREATE INDEX IF NOT EXISTS idx_reminders_status     ON reminders(status);
        CREATE INDEX IF NOT EXISTS idx_reminders_completed  ON reminders(completed_at DESC);
        CREATE TABLE IF NOT EXISTS notification_events (
            id            TEXT PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            reminder_id   TEXT NOT NULL,
            fired_at      INTEGER NOT NULL,
            channel       TEXT NOT NULL,
            outcome       TEXT,
            UNIQUE(occurrence_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_nev_reminder ON notification_events(reminder_id, fired_at);
        CREATE TABLE IF NOT EXISTS behavior_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            INTEGER NOT NULL,
            kind          TEXT NOT NULL,
            reminder_id   TEXT,
            occurrence_id TEXT,
            payload       TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key           TEXT PRIMARY KEY,
            value         TEXT NOT NULL
        );",
    )?;

    // ── Idempotent migrations ─────────────────────────────────────────────
    //
    // SQLite's `ALTER TABLE ADD COLUMN` doesn't support IF NOT EXISTS, so
    // we just try and ignore the "duplicate column name" error. Each
    // migration block is safe to run on any DB version.
    let _ = conn.execute("ALTER TABLE occurrences ADD COLUMN human_time TEXT", []);

    Ok(AppState {
        db: Mutex::new(conn),
        honker_db,
    })
}
