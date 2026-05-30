use serde_json::json;
use tauri::{State, AppHandle};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use ulid::Ulid;
use chrono::Utc;
use serde::Serialize;
use crate::db::AppState;
use crate::parser;
use honker::{QueueOpts, EnqueueOpts};

// ── notification scheduling ───────────────────────────────────────────────────

/// Small, fast pseudo-random from a seed mixed with the current nanos. Used
/// only to add humane jitter to nudge times — not security-sensitive.
fn pseudo_rand(seed: u64) -> u64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let mut x = seed ^ nanos.wrapping_mul(0x9E3779B97F4A7C15);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x
}

/// Compute the notification fire times (unix **seconds**) for a reminder.
///
/// The exact deadline always fires (`due = true`). Pre-deadline "nudges" are
/// placed with a geometric cadence that tightens toward the deadline — nudge
/// `j` lands at `T - window / 2^j` — so reminders escalate as the deadline
/// approaches, mirroring how urgency actually rises. That's the "best time"
/// formula: every nudge is a fraction of the *remaining* time, anchored to the
/// deadline rather than scattered uniformly.
///
/// Then two humane constraints shape it:
///   - `MIN_LEAD` (5s): a nudge never fires within 5 seconds of now, so a
///     fresh capture/reschedule never "resurfaces" instantly.
///   - `MIN_GAP` (30s): consecutive notifications (and the gap before the
///     deadline) are never closer than 30s, so nothing arrives back-to-back.
/// Any nudge that can't satisfy the constraints is dropped. Light jitter keeps
/// the cadence from feeling robotic without ever creating a collision.
///
/// Returns `(run_at_s, is_due, attempt_index)` sorted ascending, deadline last.
fn schedule_times(now_s: i64, fire_at_s: i64, frequency: u64) -> Vec<(i64, bool, u64)> {
    const MIN_LEAD: i64 = 5;
    const MIN_GAP: i64 = 30;

    let deadline = fire_at_s.max(now_s);
    let window = deadline - now_s;
    let nudges = frequency.saturating_sub(1);

    // Geometric candidates: T - window/2, T - window/4, T - window/8, …
    let mut candidates: Vec<i64> = Vec::new();
    if window > MIN_LEAD && nudges > 0 {
        for j in 1..=nudges {
            let shift = j.min(40) as u32;          // cap so 1<<shift can't overflow
            let denom = 1_i64 << shift;            // 2^j
            let seg = (window / denom).max(1);     // distance from the deadline
            // symmetric jitter of up to ±(seg/6)
            let jspan = (seg / 6).max(1);
            let jitter = (pseudo_rand(seed_mix(now_s, j)) % (2 * jspan as u64 + 1)) as i64 - jspan;
            candidates.push(deadline - seg + jitter);
        }
    }

    candidates.sort_unstable();

    let mut out: Vec<(i64, bool, u64)> = Vec::new();
    // `last + MIN_GAP` is the earliest a nudge may land; seed it so the first
    // nudge only needs to clear `now + MIN_LEAD`.
    let mut last = now_s + MIN_LEAD - MIN_GAP;
    let mut attempt: u64 = 1;
    for t in candidates {
        let mut tt = t;
        if tt < now_s + MIN_LEAD { tt = now_s + MIN_LEAD; }
        if tt < last + MIN_GAP { continue; }        // too close to the previous nudge
        if tt > deadline - MIN_GAP { continue; }     // too close to the deadline itself
        out.push((tt, false, attempt));
        last = tt;
        attempt += 1;
    }

    // The exact deadline always fires. attempt index = frequency keeps the
    // framing rotation in worker.rs consistent.
    out.push((deadline, true, frequency.max(1)));
    out
}

fn seed_mix(now_s: i64, j: u64) -> u64 {
    (now_s as u64).wrapping_mul(0x100000001b3) ^ j.wrapping_mul(0x9E3779B1)
}

/// Read the user's notification_frequency setting (>= 1). Defaults to 2.
fn notification_frequency(state: &State<'_, AppState>) -> u64 {
    state.db.lock().ok()
        .and_then(|db| db.query_row(
            "SELECT value FROM settings WHERE key = 'notification_frequency'",
            [],
            |r| r.get::<_, String>(0),
        ).ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(2)
        .max(1)
}

/// The single, authoritative reschedule path used by both `snooze` (named
/// presets) and `reschedule_at` (explicit timestamp from the edit modal).
///
/// DB correctness:
///   - `occurrences` has `UNIQUE(reminder_id, fire_at)`. Inserting a fresh
///     occurrence at a time that already has a row raised a constraint error.
///     Fix: cancel the pending occurrence, then PURGE every snoozed row + any
///     row already at the new fire_at before inserting. Purged rows free their
///     unique slot; their still-queued jobs become no-ops (worker.should_fire
///     skips a missing occurrence).
///   - `notified_count` resets to 0 so a rescheduled task receives its full
///     fresh cycle of nudges (the column is added by an idempotent migration
///     in db.rs).
fn do_reschedule(
    state: &State<'_, AppState>,
    id: &str,
    fire_at_ms: i64,
    human: &str,
) -> Result<(), String> {
    let fire_at_s = fire_at_ms / 1000;
    let occ_id    = Ulid::new().to_string();
    let db_now    = Utc::now().timestamp_millis();
    let frequency = notification_frequency(state);

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    let title: String = tx.query_row(
        "SELECT title FROM reminders WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    ).map_err(|_| "reminder no longer exists".to_string())?;

    tx.execute(
        "UPDATE occurrences SET state='snoozed', resolved_at=?1
         WHERE reminder_id=?2 AND state='pending'",
        rusqlite::params![db_now, id],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM occurrences
         WHERE reminder_id=?1 AND (state='snoozed' OR fire_at=?2)",
        rusqlite::params![id, fire_at_ms],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state, human_time)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        rusqlite::params![occ_id, id, fire_at_ms, human],
    ).map_err(|e| e.to_string())?;

    // Re-activate + reset the notified counter for a clean fresh cycle.
    tx.execute(
        "UPDATE reminders SET status='active', updated_at=?1, completed_at=NULL, notified_count=0 WHERE id=?2",
        rusqlite::params![db_now, id],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());
    for (run_at, due, attempt) in schedule_times(db_now / 1000, fire_at_s, frequency) {
        let mut opts = EnqueueOpts::default();
        opts.run_at = Some(run_at);
        q.enqueue_tx(&tx, &json!({
            "reminder_id":   id,
            "occurrence_id": occ_id,
            "title":         title,
            "human_time":    human,
            "attempt":       attempt,
            "due":           due,
        }), opts).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

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

    let frequency = notification_frequency(&state);

    let tx = state.honker_db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO reminders (id, title, status, priority, created_at, updated_at, tz, source)
         VALUES (?1, ?2, 'active', 0, ?3, ?3, ?4, 'quick_capture')",
        rusqlite::params![reminder_id, parsed.title, now, local_tz_id()],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO occurrences (id, reminder_id, fire_at, state, human_time)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        rusqlite::params![occ_id, reminder_id, fire_at_ms, parsed.human_time],
    ).map_err(|e| e.to_string())?;

    let q = state.honker_db.queue("due_reminders", QueueOpts::default());
    for (run_at, due, attempt) in schedule_times(now / 1000, fire_at_s, frequency) {
        let mut opts = EnqueueOpts::default();
        opts.run_at = Some(run_at);
        q.enqueue_tx(&tx, &json!({
            "reminder_id":   reminder_id,
            "occurrence_id": occ_id,
            "title":         parsed.title,
            "human_time":    parsed.human_time,
            "attempt":       attempt,
            "due":           due,
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
    Ok(())
}

// ── snooze (named presets) ────────────────────────────────────────────────────
#[tauri::command]
pub fn snooze(
    state: State<'_, AppState>,
    id: String,
    preset: String,
) -> Result<String, String> {
    use chrono::{Local, Duration, TimeZone, NaiveTime};

    let now = Local::now();

    fn at(date: chrono::NaiveDate, h: u32, m: u32) -> Option<chrono::DateTime<Local>> {
        let naive = date.and_time(NaiveTime::from_hms_opt(h, m, 0)?);
        match Local.from_local_datetime(&naive) {
            chrono::LocalResult::Single(dt) => Some(dt),
            chrono::LocalResult::Ambiguous(dt, _) => Some(dt),
            chrono::LocalResult::None => None,
        }
    }

    let (fire_at_ms, human) = match preset.as_str() {
        "1h" => ((now + Duration::hours(1)).timestamp_millis(), "in 1 hour".to_string()),
        "tonight" => {
            let today_21 = at(now.date_naive(), 21, 0).ok_or("DST gap on tonight")?;
            let dt = if today_21 > now {
                today_21
            } else {
                at((now + Duration::days(1)).date_naive(), 21, 0)
                    .ok_or("DST gap on tonight (rollover)")?
            };
            (dt.timestamp_millis(), "tonight at 9 PM".to_string())
        }
        "tomorrow" => {
            let dt = at((now + Duration::days(1)).date_naive(), 9, 0)
                .ok_or("DST gap on tomorrow")?;
            (dt.timestamp_millis(), "tomorrow at 9 AM".to_string())
        }
        "next_week" => {
            let dt = at((now + Duration::days(7)).date_naive(), 9, 0)
                .ok_or("DST gap on next_week")?;
            (dt.timestamp_millis(), "next week".to_string())
        }
        custom_str => {
            let parsed = parser::parse(custom_str);
            (parsed.fire_at_ms, parsed.human_time)
        }
    };

    do_reschedule(&state, &id, fire_at_ms, &human)?;
    Ok(human)
}

// ── reschedule_at (explicit timestamp from the edit modal) ─────────────────────
#[tauri::command]
pub fn reschedule_at(
    state: State<'_, AppState>,
    id: String,
    fire_at_ms: i64,
    human_time: String,
) -> Result<String, String> {
    do_reschedule(&state, &id, fire_at_ms, &human_time)?;
    Ok(human_time)
}

// ── test_notification ────────────────────────────────────────────────────────
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
pub fn list_completed(state: State<'_, AppState>, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<ReminderView>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let lim = limit.unwrap_or(10);
    let off = offset.unwrap_or(0);

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
         LIMIT ?1 OFFSET ?2",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![lim, off], |row| {
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

#[tauri::command]
pub fn count_completed(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT COUNT(*) FROM reminders WHERE status = 'completed'",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())
}

// ── tz helper ────────────────────────────────────────────────────────────────

fn local_tz_id() -> String {
    iana_time_zone_get().unwrap_or_else(|| "local".to_string())
}

fn iana_time_zone_get() -> Option<String> {
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
    db.execute_batch(
        "DELETE FROM notification_events;
         DELETE FROM behavior_events;
         DELETE FROM occurrences;
         DELETE FROM reminders;
         DELETE FROM settings;"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── parsing ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn parse_time(raw: String) -> Result<parser::ParsedReminder, String> {
    Ok(parser::parse(&raw))
}
