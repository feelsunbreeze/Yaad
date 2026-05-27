use serde::{Deserialize, Serialize};
use ulid::Ulid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Reminder {
    pub id: Ulid,
    pub title: String,
    pub body: Option<String>,
    pub status: String,
    pub priority: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
    pub tz: String,
    pub source: String,
    pub ai_meta: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Occurrence {
    pub id: Ulid,
    pub reminder_id: Ulid,
    pub fire_at: i64,
    pub state: String,
    pub fired_at: Option<i64>,
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptureResult {
    pub reminder: Reminder,
    pub occurrence: Occurrence,
}
