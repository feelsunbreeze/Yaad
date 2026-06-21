//! Smart ADHD-aware notification worker.
//!
//! Cross-platform: tauri-plugin-notification handles the OS layer.
//!   Windows  → WinRT Toast Notifications (Action Center)
//!   macOS    → UNUserNotificationCenter
//!   Linux    → libnotify over DBus (requires notify-send / libnotify-bin)
//!
//! ADHD strategy:
//!   1. Pre-deadline "nudge" notifications are scheduled up-front in
//!      commands.rs::schedule_times — a deadline-anchored geometric cadence
//!      (no first-5s, no back-to-back), plus one exact-deadline "due" toast.
//!   2. Pattern-interrupt framing — pre-deadline nudges rotate human phrasings;
//!      the exact deadline uses an explicit soft frame: "it's time — <title>".
//!
//! Architecture:
//!   - Main loop: claim job → spawn detached thread → continue claiming.
//!   - Per-job thread: pre-fire DB check (skip if completed/snoozed) → OS
//!     notification → ack → bump notified_count → emit `reminder:fired`.

use honker::{Database, QueueOpts, Job};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use std::time::Duration;
use serde_json::{json, Value};

use crate::db::AppState;

/// Pre-deadline framings — cycle so no two consecutive nudges sound identical.
const FRAMINGS: &[&str] = &[
    "hey —",
    "while you're there —",
    "still on the list:",
    "just surfacing:",
    "a quiet word —",
    "before it slips:",
    "", // bare title, sometimes most effective
];

pub fn start_worker(app: AppHandle, db: Database) {
    std::thread::spawn(move || {
        let q = db.queue("due_reminders", QueueOpts::default());

        loop {
            match q.claim_one("notifier-1") {
                Ok(Some(job)) => {
                    let app_thread = app.clone();
                    std::thread::spawn(move || {
                        process_job(app_thread, job);
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
fn process_job(app: AppHandle, job: Job) {
    let payload: Value = serde_json::from_slice(&job.payload).unwrap_or_default();

    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("something needs your attention")
        .to_string();

    let attempt: u64 = payload.get("attempt").and_then(|v| v.as_u64()).unwrap_or(0);

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

    let due = payload.get("due").and_then(|v| v.as_bool()).unwrap_or(true);

    // ── Pre-fire DB check ─────────────────────────────────────────────────
    let should_fire = should_fire(&app, &reminder_id, &occurrence_id).unwrap_or(true);
    if !should_fire {
        let _ = job.ack();
        return;
    }

    // ── Permission sanity check ───────────────────────────────────────────
    match app.notification().permission_state() {
        Ok(PermissionState::Granted) => {}
        Ok(other) => eprintln!(
            "[yaad worker] OS notification permission is {other:?}; toast may not appear. \
             In-app cue + sound will still fire."
        ),
        Err(e) => eprintln!("[yaad worker] permission_state error: {e}"),
    }

    // ── Build message body ────────────────────────────────────────────────
    // The exact deadline gets an explicit soft frame; pre-deadline nudges
    // rotate the human framings.
    let body = if due {
        format!("it's time — {title}")
    } else {
        let prefix = FRAMINGS[attempt as usize % FRAMINGS.len()];
        if prefix.is_empty() {
            title.clone()
        } else {
            format!("{prefix} {title}")
        }
    };

    // ── Fire OS notification ──────────────────────────────────────────────
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
    let _ = log_fire(&app, &reminder_id, &occurrence_id, fire_result.is_ok());
    let _ = bump_notified_count(&app, &reminder_id);

    let _ = app.emit(
        "reminder:fired",
        json!({ "reminder_id": reminder_id, "title": title, "due": due }),
    );
}

/// Query the DB: is the reminder still active AND is the targeted occurrence
/// still pending? Either resolved/snoozed/completed answer means skip fire.
fn should_fire(app: &AppHandle, reminder_id: &str, occurrence_id: &str) -> Result<bool, String> {
    if reminder_id.is_empty() {
        return Ok(true);
    }
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;

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

/// Increment the reminder's notified_count (observability + reset-on-reschedule
/// semantics). Best-effort — a failure here never blocks a notification.
fn bump_notified_count(app: &AppHandle, reminder_id: &str) -> Result<(), String> {
    if reminder_id.is_empty() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE reminders SET notified_count = notified_count + 1 WHERE id = ?1",
        rusqlite::params![reminder_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Append a row to `notification_events` so fire/skip behaviour is auditable.
fn log_fire(app: &AppHandle, reminder_id: &str, occurrence_id: &str, success: bool) -> Result<(), String> {
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
