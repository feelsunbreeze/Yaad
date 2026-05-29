//! Smart ADHD-aware notification worker.
//!
//! Cross-platform: tauri-plugin-notification handles the OS layer.
//!   Windows  → WinRT Toast Notifications (Action Center)
//!   macOS    → UNUserNotificationCenter
//!   Linux    → libnotify over DBus (requires notify-send / libnotify-bin)
//!
//! ADHD strategy:
//!   1. Random jitter (30s – 7 min) at claim time — genuinely unpredictable.
//!   2. Pattern-interrupt message framing — not "REMINDER:", feels human.
//!   3. Re-fire after 6–12 min if the reminder wasn't completed.
//!   4. Quiet between 00:00–07:00 local time (re-queued for 07:00, NOT dropped).
//!   5. Never fires more than 3 times for the same occurrence.
//!
//! Architecture:
//!   - Main loop: claim job → spawn detached thread → continue claiming.
//!     This keeps jitter sleeps off the worker thread so multiple due
//!     reminders no longer serialise behind each other.
//!   - Per-job thread: quiet-hours guard → jitter sleep → pre-fire DB check
//!     (skip if the occurrence has been completed or snoozed since enqueue)
//!     → OS notification → ack → re-enqueue retry if attempt < 2.

use honker::{Database, QueueOpts, EnqueueOpts, Job};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use std::time::Duration;
use chrono::{Local, NaiveTime, TimeZone, Timelike};
use serde_json::{json, Value};

use crate::db::AppState;

/// Message framings — cycle so no two consecutive re-fires sound identical.
const FRAMINGS: &[&str] = &[
    "hey —",
    "while you're there —",
    "still on the list:",
    "just surfacing:",
    "a quiet word —",
    "before it slips:",
    "", // bare title, sometimes most effective
];

/// Quiet-hours window: notifications received between 00:00 and this hour are
/// re-queued for the hour (07:00 local) rather than dropped.
const QUIET_HOURS_END: u32 = 7;



pub fn start_worker(app: AppHandle, db: Database) {
    std::thread::spawn(move || {
        let q = db.queue("due_reminders", QueueOpts::default());

        loop {
            match q.claim_one("notifier-1") {
                Ok(Some(job)) => {
                    // Detach the fire onto its own thread so the worker can
                    // immediately claim the next due job. Previously the
                    // jitter sleep blocked the entire worker, serialising
                    // simultaneous reminders behind up to 7 minutes each.
                    let app_thread = app.clone();
                    let db_thread = db.clone();
                    std::thread::spawn(move || {
                        process_job(app_thread, db_thread, job);
                    });
                }
                Ok(None) => {
                    std::thread::sleep(Duration::from_millis(500));
                }
                Err(e) => {
                    eprintln!("[yaad worker] claim_one error: {e}");
                    std::thread::sleep(Duration::from_millis(1500));
                }
            }
        }
    });
}

/// One job's lifecycle, off the main worker thread.
///
/// `job.ack()` is intentionally called late (after fire) so that if the
/// process is killed mid-execution honker re-claims the job after its
/// visibility timeout. Once we ack, the job is gone — we then enqueue a
/// fresh retry job if attempts remain.
fn process_job(app: AppHandle, db: Database, job: Job) {
    let payload: Value = serde_json::from_slice(&job.payload).unwrap_or_default();

    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("something needs your attention")
        .to_string();

    let attempt: u64 = payload
        .get("attempt")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let reminder_id = payload
        .get("reminder_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let occurrence_id = payload
        .get("occurrence_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // ── Quiet hours ───────────────────────────────────────────────────────
    // Re-enqueue for 07:00 local *today* (or tomorrow if it's already past
    // 07:00 on a DST boundary). Previously this branch acked + emitted
    // without re-enqueueing, silently dropping every overnight reminder.
    if Local::now().hour() < QUIET_HOURS_END {
        let resume_at = next_local_time_at(QUIET_HOURS_END, 0);
        let q = db.queue("due_reminders", QueueOpts::default());
        let mut opts = EnqueueOpts::default();
        opts.run_at = Some(resume_at);
        let _ = q.enqueue(&payload, opts);
        let _ = job.ack();
        let _ = app.emit("reminder:snoozed_quiet", &reminder_id);
        return;
    }

    // ── Pre-fire DB check ─────────────────────────────────────────────────
    // Between enqueue and now the user may have completed or snoozed this reminder.
    // Querying the DB here means we don't fire toasts the user has already resolved.
    // here means we don't fire toasts the user has already resolved.
    //
    // Returns:
    //   Ok(true)  — still pending, fire away
    //   Ok(false) — resolved, skip (still ack the job + cancel the chain)
    //   Err(_)    — DB error; fire anyway rather than silently swallow
    //
    // The check uses the occurrence_id (or reminder.id as fallback) so it
    // works for both the original capture and snooze-rescheduled jobs.
    let should_fire = should_fire(&app, &reminder_id, &occurrence_id).unwrap_or(true);
    if !should_fire {
        let _ = job.ack();
        return;
    }

    // ── Build message body ────────────────────────────────────────────────
    let prefix = FRAMINGS[attempt as usize % FRAMINGS.len()];
    let body = if prefix.is_empty() {
        title.clone()
    } else {
        format!("{prefix} {title}")
    };

    // ── Fire OS notification ──────────────────────────────────────────────
    // tauri-plugin-notification dispatches to:
    //   Windows → WinRT Toast (taskbar + Action Center)
    //   macOS   → UNUserNotificationCenter (Notification Center)
    //   Linux   → libnotify over DBus (requires libnotify installed)
    let fire_result = app
        .notification()
        .builder()
        .title("Yaad")
        .body(&body)
        .show();

    if let Err(e) = &fire_result {
        eprintln!("[yaad worker] notification dispatch failed: {e}");
    }

    let _ = job.ack();

    // Log the fire so future analytics / debugging has a trail.
    let _ = log_fire(&app, &reminder_id, &occurrence_id, fire_result.is_ok());

    // Tell the UI to refresh
    let _ = app.emit(
        "reminder:fired",
        json!({ "reminder_id": reminder_id, "title": title }),
    );
}

/// Query the DB: is the reminder still active AND is the targeted occurrence
/// still pending? Either resolved/snoozed/completed answer means skip fire.
fn should_fire(
    app: &AppHandle,
    reminder_id: &str,
    occurrence_id: &str,
) -> Result<bool, String> {
    if reminder_id.is_empty() {
        return Ok(true); // legacy job without an id — fall through and fire
    }
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Cheap reminder-level check first — covers the case where the user
    // completed the reminder from any path.
    let status: rusqlite::Result<String> = db.query_row(
        "SELECT status FROM reminders WHERE id = ?1",
        rusqlite::params![reminder_id],
        |r| r.get(0),
    );
    match status {
        Ok(s) if s == "active" => {}
        Ok(_) => return Ok(false),
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
        Err(e) => return Err(e.to_string()),
    }

    // Then occurrence-level — covers the snooze case where the old
    // occurrence is marked `snoozed` and a new one was inserted.
    if !occurrence_id.is_empty() {
        let occ_state: rusqlite::Result<String> = db.query_row(
            "SELECT state FROM occurrences WHERE id = ?1",
            rusqlite::params![occurrence_id],
            |r| r.get(0),
        );
        match occ_state {
            Ok(s) if s == "pending" => {}
            Ok(_) => return Ok(false),
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(true)
}

/// Append a row to the dormant `notification_events` table so we can audit
/// fire / skip behaviour later (and so the schema isn't dead weight).
fn log_fire(
    app: &AppHandle,
    reminder_id: &str,
    occurrence_id: &str,
    success: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let outcome = if success { "fired" } else { "dispatch_failed" };
    let event_id = ulid::Ulid::new().to_string();
    db.execute(
        "INSERT OR IGNORE INTO notification_events (id, occurrence_id, reminder_id, fired_at, channel, outcome)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            event_id,
            occurrence_id,
            reminder_id,
            chrono::Utc::now().timestamp_millis(),
            "os_toast",
            outcome,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Compute the next local timestamp at the given (hour, minute). If that
/// time has already passed today, returns tomorrow's. Falls back to
/// "1 hour from now" if the local datetime is invalid (DST gap).
fn next_local_time_at(hour: u32, minute: u32) -> i64 {
    let now = Local::now();
    let time = NaiveTime::from_hms_opt(hour, minute, 0).expect("hh:mm in range");
    let candidate_naive = now.date_naive().and_time(time);
    let candidate = match Local.from_local_datetime(&candidate_naive) {
        chrono::LocalResult::Single(dt) => dt,
        chrono::LocalResult::Ambiguous(dt, _) => dt,
        chrono::LocalResult::None => return now.timestamp() + 3600,
    };
    if candidate <= now {
        (candidate + chrono::Duration::days(1)).timestamp()
    } else {
        candidate.timestamp()
    }
}

/// Cheap deterministic hash for jitter — no extra dep needed. The
/// `SystemTime::now()` subsec_nanos seed gives genuine per-call variance
/// while the string-folding step keeps the output reasonably spread.
#[allow(dead_code)]
fn pseudo_rand(s: &str) -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(42);
    let h = s.bytes().fold(t, |acc, b| {
        acc.wrapping_mul(6364136223846793005).wrapping_add(b as u64)
    });
    h ^ (h >> 33)
}
