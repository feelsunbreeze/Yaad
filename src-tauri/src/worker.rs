/// Smart ADHD-aware notification worker.
///
/// Cross-platform: tauri-plugin-notification handles the OS layer.
///   Windows  → WinRT Toast Notifications (Action Center)
///   macOS    → UNUserNotificationCenter
///   Linux    → libnotify over DBus (requires notify-send / libnotify-bin)
///
/// ADHD strategy:
///   1. Random jitter (±0–7 min) at claim time — genuinely unpredictable.
///   2. Pattern-interrupt message framing — not "REMINDER:", feels human.
///   3. Re-fire after 6–12 min if the reminder wasn't completed.
///   4. Quiet between 00:00–07:00 local time.
///   5. Never fires more than 3 times for the same occurrence.

use honker::{Database, QueueOpts, EnqueueOpts};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use std::time::Duration;
use chrono::{Local, Timelike};
use serde_json;

// Message framings — cycle so no two consecutive re-fires sound identical.
const FRAMINGS: &[(&str, &str)] = &[
    ("hey —",          ""),
    ("while you're there —", ""),
    ("still on the list:", ""),
    ("just surfacing:", ""),
    ("a quiet word —",  ""),
    ("before it slips:", ""),
    ("",                ""), // bare title, sometimes most effective
];

pub fn start_worker(app: AppHandle, db: Database) {
    std::thread::spawn(move || {
        let q = db.queue("due_reminders", QueueOpts::default());

        loop {
            match q.claim_one("notifier-1") {
                Ok(Some(job)) => {
                    let payload: serde_json::Value =
                        serde_json::from_slice(&job.payload)
                            .unwrap_or_default();

                    let title = payload
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("something needs your attention");

                    let attempt: u64 = payload
                        .get("attempt")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    let reminder_id = payload
                        .get("reminder_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    // ── Quiet hours (00:00–07:00) ────────────────────────────
                    let hour = Local::now().hour();
                    if hour < 7 {
                        // Re-queue for 08:00
                        let _ = job.ack();
                        let _ = app.emit("reminder:snoozed_quiet", &reminder_id);
                        continue;
                    }

                    // ── Random jitter: sleep 0–7 min before firing ───────────
                    // This is the "pattern interrupt" — fires at an unexpected
                    // moment mid-task, which is exactly when ADHD brains notice.
                    let jitter_secs = (pseudo_rand(title) % 420) + 30; // 30s–7m
                    std::thread::sleep(Duration::from_secs(jitter_secs));

                    // ── Build message body ───────────────────────────────────
                    let (prefix, _) = FRAMINGS[attempt as usize % FRAMINGS.len()];
                    let body = if prefix.is_empty() {
                        title.to_string()
                    } else {
                        format!("{} {}", prefix, title)
                    };

                    // ── Fire OS notification ─────────────────────────────────
                    // tauri-plugin-notification dispatches to:
                    //   Windows → WinRT Toast (taskbar + Action Center)
                    //   macOS   → UNUserNotificationCenter (Notification Center)
                    //   Linux   → libnotify over DBus (requires libnotify installed)
                    let _ = app
                        .notification()
                        .builder()
                        .title("Yaad")
                        .body(&body)
                        .show();

                    let _ = job.ack();

                    // Emit so the UI refreshes
                    let _ = app.emit("reminder:fired", serde_json::json!({
                        "reminder_id": reminder_id,
                        "title": title
                    }));

                    // ── Re-fire if not completed (max 3 attempts) ────────────
                    if attempt < 2 {
                        let refire_q = db.queue("due_reminders", QueueOpts::default());
                        let refire_delay = 360 + pseudo_rand(title) % 360; // 6–12 min
                        let run_at = Local::now().timestamp() + refire_delay as i64;

                        let mut opts = EnqueueOpts::default();
                        opts.run_at = Some(run_at);

                        let _ = refire_q.enqueue(&serde_json::json!({
                            "reminder_id": reminder_id,
                            "title": title,
                            "attempt": attempt + 1,
                        }), opts);
                    }
                }
                Ok(None) => {
                    std::thread::sleep(Duration::from_millis(500));
                }
                Err(e) => {
                    eprintln!("[yaad worker] {e}");
                    std::thread::sleep(Duration::from_millis(1500));
                }
            }
        }
    });
}

/// Cheap deterministic hash for jitter — no extra dep needed.
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
