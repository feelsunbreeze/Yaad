use rusqlite::Connection;
use honker::Database;
use std::sync::Mutex;
use std::path::PathBuf;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub honker_db: Database,
}

pub fn init_db(app_dir: PathBuf) -> Result<AppState, Box<dyn std::error::Error>> {
    let db_path = app_dir.join("reminders.db");
    let conn = Connection::open(&db_path)?;
    
    // Load honker extension and setup WAL
    let honker_db = Database::open(&db_path)?;
    
    // Setup tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS reminders (
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
        CREATE INDEX IF NOT EXISTS idx_occ_fire ON occurrences(state, fire_at);
        CREATE TABLE IF NOT EXISTS notification_events (
            id            TEXT PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            reminder_id   TEXT NOT NULL,
            fired_at      INTEGER NOT NULL,
            channel       TEXT NOT NULL,
            outcome       TEXT,
            UNIQUE(occurrence_id, channel)
        );
        CREATE TABLE IF NOT EXISTS behavior_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            INTEGER NOT NULL,
            kind          TEXT NOT NULL,
            reminder_id   TEXT,
            occurrence_id TEXT,
            payload       TEXT
        );
        "
    )?;

    Ok(AppState {
        db: Mutex::new(conn),
        honker_db,
    })
}
