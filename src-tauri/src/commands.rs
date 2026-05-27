use serde_json::json;
use tauri::{State, AppHandle};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use ulid::Ulid;
use chrono::Utc;
use serde::Serialize;
use crate::db::AppState;
use crate::parser;
use honker::{QueueOpts, EnqueueOpts};

// ── serialisable view types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct ReminderView {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i32,
    pub created_at: i64,
    pub fire_at: Option<i64>,
    pub human_time: Option<String>,
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
    let occ_id = Ulid::new().to_string();
    let fire_at_ms = parsed.fire_at_ms;
    let fire_at_s  = fire_at_ms / 1000;

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO reminders (id, title, status, priority, created_at, updated_at, tz, source)
         VALUES (?1, ?2, 'active', 0, ?3, ?3, 'local', 'quick_capture')",
        rusqlite::params![reminder_id, parsed.title, now],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state)
         VALUES (?1, ?2, ?3, 'pending')",
        rusqlite::params![occ_id, reminder_id, fire_at_ms],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());
    let mut enqueue_opts = EnqueueOpts::default();
    enqueue_opts.run_at = Some(fire_at_s);

    q.enqueue_tx(&tx, &json!({
        "reminder_id":  reminder_id,
        "occurrence_id": occ_id,
        "title":        parsed.title,
        "human_time":   parsed.human_time,
    }), enqueue_opts).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let view = ReminderView {
        id: reminder_id,
        title: parsed.title,
        status: "active".to_string(),
        priority: 0,
        created_at: now,
        fire_at: Some(fire_at_ms),
        human_time: Some(parsed.human_time.clone()),
    };

    Ok(CaptureResult { reminder: view, fire_at_ms, human_time: parsed.human_time })
}

// ── list_reminders ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_reminders(state: State<'_, AppState>) -> Result<Vec<ReminderView>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT r.id, r.title, r.status, r.priority, r.created_at,
                o.fire_at
         FROM reminders r
         LEFT JOIN occurrences o ON o.reminder_id = r.id AND o.state = 'pending'
         WHERE r.status NOT IN ('completed', 'archived')
         ORDER BY COALESCE(o.fire_at, r.created_at) ASC",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(ReminderView {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            priority: row.get(3)?,
            created_at: row.get(4)?,
            fire_at: row.get(5)?,
            human_time: None,
        })
    }).map_err(|e| e.to_string())?;

    rows.filter_map(|r| r.ok()).collect::<Vec<_>>().into_iter()
        .map(Ok).collect::<Result<Vec<_>, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())
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
        "UPDATE occurrences SET state='completed', resolved_at=?1 WHERE reminder_id=?2 AND state='pending'",
        rusqlite::params![now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── snooze ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn snooze(
    state: State<'_, AppState>,
    id: String,
    preset: String,       // "1h" | "tonight" | "tomorrow" | "next_week"
) -> Result<String, String> {
    use chrono::{Local, Duration, Timelike};

    let now = Local::now();
    let fire_at = match preset.as_str() {
        "1h"        => now + Duration::hours(1),
        "tonight"   => { let t = now.with_hour(21).unwrap().with_minute(0).unwrap().with_second(0).unwrap();
                         if t > now { t } else { t + Duration::days(1) } }
        "tomorrow"  => (now + Duration::days(1)).with_hour(9).unwrap().with_minute(0).unwrap().with_second(0).unwrap(),
        "next_week" => (now + Duration::days(7)).with_hour(9).unwrap().with_minute(0).unwrap().with_second(0).unwrap(),
        _           => now + Duration::hours(1),
    };

    let fire_at_ms = fire_at.timestamp_millis();
    let fire_at_s  = fire_at.timestamp();
    let occ_id = Ulid::new().to_string();
    let db_now = Utc::now().timestamp_millis();

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    // Mark old occurrence snoozed
    tx.execute(
        "UPDATE occurrences SET state='snoozed', resolved_at=?1 WHERE reminder_id=?2 AND state='pending'",
        rusqlite::params![db_now, id],
    ).map_err(|e| e.to_string())?;

    // Get title
    let title: String = tx.query_row(
        "SELECT title FROM reminders WHERE id=?1", rusqlite::params![id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    // New occurrence
    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state) VALUES (?1, ?2, ?3, 'pending')",
        rusqlite::params![occ_id, id, fire_at_ms],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());
    let mut opts = EnqueueOpts::default();
    opts.run_at = Some(fire_at_s);
    q.enqueue_tx(&tx, &json!({ "reminder_id": id, "occurrence_id": occ_id, "title": title }), opts)
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let human = match preset.as_str() {
        "1h"        => "in 1 hour".to_string(),
        "tonight"   => "tonight at 9 PM".to_string(),
        "tomorrow"  => "tomorrow at 9 AM".to_string(),
        "next_week" => "next week".to_string(),
        _           => "later".to_string(),
    };
    Ok(human)
}

// ── test_notification ────────────────────────────────────────────────────────
//
// Dispatches a real OS-level toast through tauri-plugin-notification:
//   Windows 11 → WinRT ToastNotificationManager → Action Center
//   macOS      → UNUserNotificationCenter
//   Linux      → libnotify over DBus (notify-send / libnotify-bin required)
//
// We explicitly verify the OS permission first; on Windows 11 the call will
// no-op silently if the AppUserModelID isn't registered or the user has
// disabled notifications for this app, so failing loudly here surfaces the
// real reason instead of pretending the toast was sent.
#[tauri::command]
pub fn test_notification(app: AppHandle) -> Result<(), String> {
    let granted = ensure_permission(&app)?;
    if !granted {
        return Err(
            "OS notification permission denied. \
             Enable notifications for Yaad in Windows Settings → System → Notifications."
                .into(),
        );
    }

    app.notification()
        .builder()
        .title("Yaad — notification test")
        .body("If you see this in Action Center, the system is listening.")
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
    let mut stmt = db
        .prepare(
            "SELECT id, title, status, priority, created_at, completed_at
             FROM reminders
             WHERE status = 'completed'
             ORDER BY completed_at DESC
             LIMIT 200",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ReminderView {
                id:         row.get(0)?,
                title:      row.get(1)?,
                status:     row.get(2)?,
                priority:   row.get(3)?,
                created_at: row.get(4)?,
                fire_at:    row.get(5)?, // completed_at shown as fire_at
                human_time: None,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}
