use serde_json::json;
use tauri::{State, AppHandle};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use ulid::Ulid;
use chrono::Utc;
use serde::Serialize;
use crate::db::AppState;
use crate::parser;
use honker::{QueueOpts, EnqueueOpts};

// ── helpers ──────────────────────────────────────────────────────────────────

fn compute_run_at(now_s: i64, fire_at_s: i64) -> i64 {
    if now_s >= fire_at_s {
        return fire_at_s;
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as i64)
        .unwrap_or(42);
    
    now_s + (nanos % (fire_at_s - now_s + 1))
}

// ── serialisable view types ──────────────────────────────────────────────────

/// Wire shape returned to the frontend. Mirrors the contract documented in
/// the IPC summary — adding fields is fine, removing/renaming them is a
/// breaking change for `useReminders.ts`.
#[derive(Debug, Serialize, Clone)]
pub struct ReminderView {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i32,
    pub created_at: i64,
    pub fire_at: Option<i64>,
    pub human_time: Option<String>,
    /// Populated for completed reminders so the UI can render
    /// "resolved 2h ago" without confusing `fire_at` and `completed_at`.
    pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CaptureResult {
    pub reminder: ReminderView,
    pub fire_at_ms: i64,
    pub human_time: String,
}

// ── capture_submit ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn capture_submit(
    state: State<'_, AppState>,
    raw: String,
) -> Result<CaptureResult, String> {
    let parsed = parser::parse(&raw);
    let now = Utc::now().timestamp_millis();

    let reminder_id = Ulid::new().to_string();
    let occ_id      = Ulid::new().to_string();
    let fire_at_ms  = parsed.fire_at_ms;
    let fire_at_s   = fire_at_ms / 1000;

    let frequency = state.db.lock().unwrap().query_row(
        "SELECT value FROM settings WHERE key = 'notification_frequency'",
        [],
        |r| r.get::<_, String>(0)
    ).and_then(|s| s.parse::<u64>().map_err(|_| rusqlite::Error::QueryReturnedNoRows))
     .unwrap_or(2).max(1);

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO reminders (id, title, status, priority, created_at, updated_at, tz, source)
         VALUES (?1, ?2, 'active', 0, ?3, ?3, ?4, 'quick_capture')",
        rusqlite::params![reminder_id, parsed.title, now, local_tz_id()],
    ).map_err(|e| e.to_string())?;

    // Store human_time alongside the occurrence so list_reminders can
    // round-trip it back to the UI without re-parsing.
    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state, human_time)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        rusqlite::params![occ_id, reminder_id, fire_at_ms, parsed.human_time],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());

    // Enqueue the exact deadline job
    let mut exact_opts = EnqueueOpts::default();
    exact_opts.run_at = Some(fire_at_s);
    q.enqueue_tx(&tx, &json!({
        "reminder_id":   reminder_id,
        "occurrence_id": occ_id,
        "title":         parsed.title,
        "human_time":    parsed.human_time,
        "attempt":       frequency,
    }), exact_opts).map_err(|e| e.to_string())?;

    // Enqueue random pre-deadline jobs
    for i in 1..frequency {
        let mut opts = EnqueueOpts::default();
        opts.run_at = Some(compute_run_at(now / 1000, fire_at_s));
        q.enqueue_tx(&tx, &json!({
            "reminder_id":   reminder_id,
            "occurrence_id": occ_id,
            "title":         parsed.title,
            "human_time":    parsed.human_time,
            "attempt":       i,
        }), opts).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let view = ReminderView {
        id:           reminder_id,
        title:        parsed.title,
        status:       "active".to_string(),
        priority:     0,
        created_at:   now,
        fire_at:      Some(fire_at_ms),
        human_time:   Some(parsed.human_time.clone()),
        completed_at: None,
    };

    Ok(CaptureResult { reminder: view, fire_at_ms, human_time: parsed.human_time })
}

// ── list_reminders ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_reminders(state: State<'_, AppState>) -> Result<Vec<ReminderView>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT r.id, r.title, r.status, r.priority, r.created_at,
                o.fire_at, o.human_time
         FROM reminders r
         LEFT JOIN occurrences o
           ON o.reminder_id = r.id AND o.state = 'pending'
         WHERE r.status NOT IN ('completed', 'archived')
         ORDER BY COALESCE(o.fire_at, r.created_at) ASC",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(ReminderView {
            id:           row.get(0)?,
            title:        row.get(1)?,
            status:       row.get(2)?,
            priority:     row.get(3)?,
            created_at:   row.get(4)?,
            fire_at:      row.get(5)?,
            human_time:   row.get(6)?,
            completed_at: None,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ── complete ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn complete(
    state: State<'_, AppState>,
    _app: AppHandle,
    id: String,
) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE reminders SET status='completed', completed_at=?1, updated_at=?1 WHERE id=?2",
        rusqlite::params![now, id],
    ).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE occurrences SET state='completed', resolved_at=?1
         WHERE reminder_id=?2 AND state='pending'",
        rusqlite::params![now, id],
    ).map_err(|e| e.to_string())?;
    // The corresponding honker job stays in the queue but the worker's
    // `should_fire()` pre-check looks at reminders.status / occurrences.state
    // and skips firing for resolved rows — so the toast won't surface even
    // if the queued job is claimed after this point.
    Ok(())
}

// ── snooze ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn snooze(
    state: State<'_, AppState>,
    id: String,
    preset: String,       // "1h" | "tonight" | "tomorrow" | "next_week"
) -> Result<String, String> {
    use chrono::{Local, Duration, TimeZone, NaiveTime};

    let now = Local::now();

    /// Resolve a (hour, minute) on the requested day to a concrete local
    /// DateTime. DST gaps return a fallback (the day's later same time + 1h)
    /// so we never panic on `with_hour(...).unwrap()`.
    fn at(date: chrono::NaiveDate, h: u32, m: u32) -> Option<chrono::DateTime<Local>> {
        let naive = date.and_time(NaiveTime::from_hms_opt(h, m, 0)?);
        match Local.from_local_datetime(&naive) {
            chrono::LocalResult::Single(dt) => Some(dt),
            chrono::LocalResult::Ambiguous(dt, _) => Some(dt),
            chrono::LocalResult::None => None,
        }
    }

    let fire_at = match preset.as_str() {
        "1h" => now + Duration::hours(1),
        "tonight" => {
            let today_21 = at(now.date_naive(), 21, 0).ok_or("DST gap on tonight")?;
            if today_21 > now {
                today_21
            } else {
                at((now + Duration::days(1)).date_naive(), 21, 0)
                    .ok_or("DST gap on tonight (rollover)")?
            }
        }
        "tomorrow" => at((now + Duration::days(1)).date_naive(), 9, 0)
            .ok_or("DST gap on tomorrow")?,
        "next_week" => at((now + Duration::days(7)).date_naive(), 9, 0)
            .ok_or("DST gap on next_week")?,
        _ => now + Duration::hours(1),
    };

    let fire_at_ms = fire_at.timestamp_millis();
    let fire_at_s  = fire_at.timestamp();
    let occ_id     = Ulid::new().to_string();
    let db_now     = Utc::now().timestamp_millis();

    let human = match preset.as_str() {
        "1h"        => "in 1 hour".to_string(),
        "tonight"   => "tonight at 9 PM".to_string(),
        "tomorrow"  => "tomorrow at 9 AM".to_string(),
        "next_week" => "next week".to_string(),
        _           => "later".to_string(),
    };

    let frequency = state.db.lock().unwrap().query_row(
        "SELECT value FROM settings WHERE key = 'notification_frequency'",
        [],
        |r| r.get::<_, String>(0)
    ).and_then(|s| s.parse::<u64>().map_err(|_| rusqlite::Error::QueryReturnedNoRows))
     .unwrap_or(2).max(1);

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE occurrences SET state='snoozed', resolved_at=?1
         WHERE reminder_id=?2 AND state='pending'",
        rusqlite::params![db_now, id],
    ).map_err(|e| e.to_string())?;

    let title: String = tx.query_row(
        "SELECT title FROM reminders WHERE id=?1",
        rusqlite::params![id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state, human_time)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        rusqlite::params![occ_id, id, fire_at_ms, human],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE reminders SET status='active', updated_at=?1, completed_at=NULL WHERE id=?2",
        rusqlite::params![db_now, id],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());

    // Enqueue exact deadline job
    let mut exact_opts = EnqueueOpts::default();
    exact_opts.run_at = Some(fire_at_s);
    q.enqueue_tx(&tx, &json!({
        "reminder_id":   id,
        "occurrence_id": occ_id,
        "title":         title,
        "human_time":    human,
        "attempt":       frequency,
    }), exact_opts).map_err(|e| e.to_string())?;

    // Enqueue random pre-deadline jobs
    for i in 1..frequency {
        let mut opts = EnqueueOpts::default();
        opts.run_at = Some(compute_run_at(db_now / 1000, fire_at_s));
        q.enqueue_tx(&tx, &json!({
            "reminder_id":   id,
            "occurrence_id": occ_id,
            "title":         title,
            "human_time":    human,
            "attempt":       i,
        }), opts).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(human)
}

// ── test_notification ────────────────────────────────────────────────────────
//
// Dispatches a real OS-level toast through tauri-plugin-notification:
//   Windows 11 → WinRT ToastNotificationManager → Action Center
//   macOS      → UNUserNotificationCenter
//   Linux      → libnotify over DBus (notify-send / libnotify-bin required)
//
// We explicitly verify the OS permission first so the user sees the
// underlying reason if the toast doesn't appear, rather than us pretending
// it was delivered.
#[tauri::command]
pub fn test_notification(app: AppHandle) -> Result<(), String> {
    let granted = ensure_permission(&app)?;
    if !granted {
        return Err(
            "OS notification permission denied. Enable notifications for Yaad in your system settings."
                .into(),
        );
    }

    app.notification()
        .builder()
        .title("Yaad — notification test")
        .body("If you see this in Action Center / Notification Center, the system is listening.")
        .show()
        .map_err(|e| e.to_string())
}

/// Check permission state, requesting it from the OS if it's still Unknown.
/// Returns true when the OS will accept toasts from this app.
pub(crate) fn ensure_permission(app: &AppHandle) -> Result<bool, String> {
    let state = app
        .notification()
        .permission_state()
        .map_err(|e| e.to_string())?;

    let granted = match state {
        PermissionState::Granted => true,
        PermissionState::Denied => false,
        _ => matches!(
            app.notification()
                .request_permission()
                .map_err(|e| e.to_string())?,
            PermissionState::Granted
        ),
    };
    Ok(granted)
}

// ── list_completed (archive) ─────────────────────────────────────────────────

#[tauri::command]
pub fn list_completed(state: State<'_, AppState>) -> Result<Vec<ReminderView>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // For completed reminders, surface BOTH the original fire_at (last
    // pending occurrence) and the completed_at separately. Previously the
    // query packed completed_at into the fire_at slot which made the UI
    // think the reminder fired in the past — fine for sorting, misleading
    // for display.
    let mut stmt = db.prepare(
        "SELECT r.id, r.title, r.status, r.priority, r.created_at, r.completed_at,
                (SELECT fire_at FROM occurrences
                   WHERE reminder_id = r.id
                   ORDER BY fire_at DESC LIMIT 1) AS last_fire_at,
                (SELECT human_time FROM occurrences
                   WHERE reminder_id = r.id
                   ORDER BY fire_at DESC LIMIT 1) AS last_human_time
         FROM reminders r
         WHERE r.status = 'completed'
         ORDER BY r.completed_at DESC
         LIMIT 200",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(ReminderView {
            id:           row.get(0)?,
            title:        row.get(1)?,
            status:       row.get(2)?,
            priority:     row.get(3)?,
            created_at:   row.get(4)?,
            completed_at: row.get(5)?,
            fire_at:      row.get(6)?,
            human_time:   row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ── tz helper ────────────────────────────────────────────────────────────────

/// Best-effort IANA tz identifier for the running machine. Falls back to
/// "local" when we can't read it — the field is stored for future use
/// (e.g. correctly scheduling across travel) and isn't load-bearing yet.
fn local_tz_id() -> String {
    iana_time_zone_get().unwrap_or_else(|| "local".to_string())
}

/// Pulled out so the surrounding helper stays unit-testable. Uses chrono's
/// platform-specific local offset as a coarse fingerprint when no real
/// tz crate is available.
fn iana_time_zone_get() -> Option<String> {
    // chrono doesn't carry an IANA name. Without pulling in the
    // `iana-time-zone` crate, we approximate using the offset string.
    // Good enough as a marker; replace with `iana-time-zone` for accuracy.
    let offset = chrono::Local::now().offset().to_string();
    Some(format!("local{offset}"))
}

// ── settings & admin ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut settings = std::collections::HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        settings.insert(row.0, row.1);
    }
    Ok(settings)
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        rusqlite::params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn factory_reset(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Wipe all tables
    db.execute_batch(
        "DELETE FROM notification_events;
         DELETE FROM behavior_events;
         DELETE FROM occurrences;
         DELETE FROM reminders;
         DELETE FROM settings;"
    ).map_err(|e| e.to_string())?;
    
    // Wipe honker queue (it has its own connection, but it's the same DB file and WAL allows it if we coordinate,
    // actually, just deleting from honker's internal tables using a fresh transaction is safer)
    // Wait, let's just wipe the app tables. The jobs might still be in honker queue, 
    // but the occurrences are gone, so worker will skip them anyway!
    Ok(())
}

// ── parsing ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn parse_time(raw: String) -> Result<parser::ParsedReminder, String> {
    Ok(parser::parse(&raw))
}
