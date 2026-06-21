# Reminder App — Technical & Architectural Blueprint

A local-first, ADHD-aware reminder app built on Tauri + SolidJS + Rust + SQLite + Honker, with an optional NVIDIA NIM enhancement layer. This document is written to be implementation-ready: a senior engineer should be able to start coding from it.

Stack one-liner: **SolidJS UI → Tauri IPC → Rust core → SQLite (with Honker extension loaded) → OS notifications.** AI is an optional cloud or local-model side channel; the app must run with zero network and zero model.

---

## 1. Core Product Philosophy

**What it is.** A keyboard-first, local-first reminder/task system for people whose executive function does not survive friction. Capture in one keystroke; never lose anything; surface things at the right moment without nagging.

**What it solves.**
- Capture latency: idea → stored < 2s, no menu hunting.
- Memory leakage: anything thought once is durable.
- Re-entry cost: the next action is always one keystroke away.
- Notification fatigue: alerts respect attentional state.

**Why local-first.** Network calls add latency, failure modes, and surveillance anxiety. The laptop is the source of truth; the device works on a plane with no account. Cloud sync is an additive replication channel, never the authority.

**Why deterministic-first.** The path between "a reminder exists" and "the user is notified" is 100% deterministic: cron-like schedule + SQLite + Honker queue + OS notify. AI lives only on the edges (NLP fallback, classification, phrasing). A model outage must never silence a reminder.

**AI restraint.** LLMs only run when (a) the deterministic parser is uncertain, (b) the user asks for help shaping a task, or (c) periodic background classification of completed tasks runs. Never in the scheduling loop.

**UX principles.**
1. Quick capture is sacred (global hotkey, single text input).
2. The keyboard is the primary input device; mouse is optional.
3. No streaks, no scores, no red badges, no guilt language.
4. Progressive disclosure: one input grows into a structured reminder only when needed.
5. Snooze is a first-class verb; missing things is normal.

**Notification philosophy.** Quiet by default. Escalation only on explicit "this matters." Suppress duplicates aggressively. Respect Do-Not-Disturb and detected focus state. The system has permission to be silent when conditions warrant.

**Failure philosophy.** A reminder must fire even if: laptop slept through the trigger time, network is down, AI is unavailable, last shutdown was uncleanly, clock has drifted. Every failure path has a deterministic recovery on next wake/start.

**Explicit anti-goals.**
- No gamification.
- No "AI assistant" persona.
- No social features.
- No nag escalation by default.
- No telemetry to anyone but the user.
- No required login.
- No web app (yet); the desktop is the primary surface.

---

## 2. System Architecture

### 2.1 Module map

```
┌──────────────────────────────────────────────────────────┐
│  Tauri shell (window mgmt, OS perms, global hotkeys)     │
│                                                          │
│  ┌─────────────────┐         ┌────────────────────────┐  │
│  │  SolidJS UI     │ ── IPC ─│  Rust core             │  │
│  │  - QuickCapture │  cmds   │  ┌──────────────────┐  │  │
│  │  - List/Today   │  ←evt── │  │ parser           │  │  │
│  │  - Detail       │         │  │ scheduler        │  │  │
│  │  - Settings     │         │  │ notifier         │  │  │
│  └─────────────────┘         │  │ ai_client (opt)  │  │  │
│                              │  │ sync (opt)       │  │  │
│                              │  │ store (SQLite)   │  │  │
│                              │  └────────┬─────────┘  │  │
│                              └───────────┼────────────┘  │
│                                          ▼               │
│              ┌──────────────────────────────────────┐    │
│              │ SQLite + Honker extension (one .db)  │    │
│              │ • domain tables                      │    │
│              │ • _honker_live (queue)               │    │
│              │ • _honker_streams (event log)        │    │
│              └──────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        OS Notify     NIM endpoint (opt)   Sync server (opt)
```

### 2.2 Module responsibilities

| Module | Responsibility | Boundary |
|---|---|---|
| `ui/` (Solid) | Render, capture input, emit intents | Talks only via Tauri IPC |
| `core::parser` | NL → ParsedReminder (deterministic) | Pure functions, no I/O |
| `core::scheduler` | Compute next fire time, materialize occurrences | Reads recurrence rules, writes queue |
| `core::notifier` | Dispatch to OS, handle snooze/dismiss callbacks | Subscribes to `due_reminders` queue |
| `core::ai_client` | NIM HTTP client, structured-output enforcement | Stateless, retried, optional |
| `core::sync` | Push/pull op log to server | Optional, isolated crate |
| `core::store` | SQLite gateway; only place that writes | Holds the single writer connection |

### 2.3 Event flow (happy path: capture → fire)

1. User presses `Cmd+Shift+Space` → Tauri opens QuickCapture overlay.
2. User types `remind me to call mom tomorrow at 6pm`.
3. UI emits `capture.submit` → Rust `parser` returns ParsedReminder (confidence 0.95).
4. `store.create_reminder()` opens a tx, inserts into `reminders`, computes next occurrence, and `q.enqueue("due_reminders", {reminder_id, fire_at}, delay=...)` in the same tx. Atomic.
5. Honker scheduler wakes the `notifier` worker at fire_at.
6. Notifier reads the row, builds payload, calls OS notify, writes a `notification_events` row, and emits a `reminders` stream event for UI live update.

### 2.4 Threading model (Rust core)

- One **writer** connection (serialized via `Mutex<Connection>` or `r2d2` with size 1).
- A pool of read-only connections for queries.
- Honker poll thread is internal to the extension.
- Worker tasks (`notifier`, `scheduler_tick`, `ai_classifier`) run on a `tokio` runtime, claim from Honker queues.

---

## 3. Local-First Design

### 3.1 Offline behavior matrix

| Capability | No network | Notes |
|---|---|---|
| Capture, edit, delete | ✅ full | Deterministic parser only |
| Notifications fire | ✅ full | Scheduler is local |
| Recurrences expand | ✅ full | Pure function over rule |
| NL fallback to LLM | ❌ graceful | Marks `parse_confidence < 0.6` → asks clarifying question in UI |
| Sync to other devices | ❌ buffered | Op log accumulates; flushes on reconnect |

### 3.2 Persistence guarantees

- SQLite in WAL mode (Honker default). `synchronous=NORMAL` for desktop responsiveness, `FULL` opt-in for paranoid users.
- Every state change is a row insert/update inside a single transaction that also enqueues any side-effect work (transactional outbox via Honker — same `.db` file, same tx).

### 3.3 Crash / reboot recovery

On startup the core runs `recover()`:
1. `PRAGMA integrity_check` on SQLite; bail loudly if not `ok`.
2. Honker sweeps expired claims back to pending automatically (visibility timeout).
3. `scheduler::reconcile()` scans `reminders WHERE next_fire_at < now() AND status = 'pending'` and re-enqueues any due rows missed during downtime (laptop slept past fire_at).
4. Replay backlog: if more than N missed in one window, collapse into a single digest notification rather than firing N pop-ups.

### 3.4 Sleep/wake & clock drift

- On wake event (Tauri lifecycle), call `reconcile()`.
- Store all timestamps as **UTC unix epoch ms**; render in local TZ. Recurrence rules store the originating TZ string (`America/New_York`) so DST changes resolve correctly.
- Detect clock jumps > 5 min and re-derive next_fire_at for all live reminders.

### 3.5 Duplicate suppression

A reminder fires at most once per (reminder_id, occurrence_id). The notifier idempotently writes `notification_events(reminder_id, occurrence_id, fired_at)` with a UNIQUE index; a retry that hits the unique constraint is treated as success.

---

## 4. Database Design

SQLite, one file (`reminders.db`), Honker extension loaded. Domain tables below; Honker manages `_honker_live`, `_honker_dead`, `_honker_streams`, `_honker_notifications`.

### 4.1 DDL (illustrative)

```sql
CREATE TABLE reminders (
  id            TEXT PRIMARY KEY,           -- ULID
  title         TEXT NOT NULL,
  body          TEXT,
  status        TEXT NOT NULL,              -- active|completed|archived|snoozed
  priority      INTEGER NOT NULL DEFAULT 0, -- 0..3
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  tz            TEXT NOT NULL,              -- IANA
  source        TEXT NOT NULL,              -- quick_capture|nl|template|sync
  ai_meta       TEXT                        -- JSON: parse_confidence, classifier_tags
);

CREATE TABLE recurrences (
  reminder_id   TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,
  rrule         TEXT NOT NULL,              -- RFC 5545 RRULE
  dtstart       INTEGER NOT NULL,
  until         INTEGER,
  exdates       TEXT                        -- JSON array of unix ms
);

CREATE TABLE occurrences (
  id            TEXT PRIMARY KEY,           -- ULID
  reminder_id   TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  fire_at       INTEGER NOT NULL,
  state         TEXT NOT NULL,              -- pending|fired|snoozed|completed|dismissed
  fired_at      INTEGER,
  resolved_at   INTEGER,
  UNIQUE(reminder_id, fire_at)
);
CREATE INDEX idx_occ_fire ON occurrences(state, fire_at);

CREATE TABLE snoozes (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  snoozed_at    INTEGER NOT NULL,
  resume_at     INTEGER NOT NULL,
  reason        TEXT                        -- preset|custom|llm_suggested
);

CREATE TABLE notification_events (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  reminder_id   TEXT NOT NULL,
  fired_at      INTEGER NOT NULL,
  channel       TEXT NOT NULL,              -- os_notify|in_app|digest
  outcome       TEXT,                       -- acted|dismissed|snoozed|ignored
  UNIQUE(occurrence_id, channel)
);

CREATE TABLE behavior_events (             -- append-only event log
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,              -- created|completed|snoozed|dismissed|edited|missed
  reminder_id   TEXT,
  occurrence_id TEXT,
  payload       TEXT                        -- JSON
);
CREATE INDEX idx_beh_ts ON behavior_events(ts);
CREATE INDEX idx_beh_kind ON behavior_events(kind, ts);

CREATE TABLE sync_oplog (                  -- outbound replication log
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  op            TEXT NOT NULL,              -- upsert_reminder|delete_reminder|...
  entity_id     TEXT NOT NULL,
  payload       TEXT NOT NULL,              -- JSON
  pushed_at     INTEGER
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

### 4.2 Event sourcing

`behavior_events` is append-only and is the input to adaptive logic (best-time-to-remind, classifier training). Domain tables hold current state — derivable, but kept materialized for query speed. Behavioral analysis NEVER reads domain tables directly; it reads `behavior_events`.

### 4.3 Migrations

`refinery` or hand-rolled numbered SQL files in `migrations/`. On open: `PRAGMA user_version`, run pending forward migrations in a single tx. Never destructive without a backup of `.db` to `.db.bak.{ts}` first.

### 4.4 Archival

After 90 days, completed reminders move to `reminders_archive` (same shape, separate table) on a Honker `@every 24h` job. Keeps hot table small; preserves history for the event log.

---

## 5. Honker Integration

Honker's actual primitives (verified from honker.dev): durable queues with retries/priority/delayed jobs/dead-letter, durable streams with per-consumer offsets, ephemeral notify/listen, leader-elected cron scheduler, named locks, rate limiting. All in the same `.db` file as our domain tables — `INSERT INTO reminders` and `queue.enqueue(...)` commit in the same tx.

### 5.1 Queue topology

| Queue | Purpose | Producer | Consumer | Retry | DLQ |
|---|---|---|---|---|---|
| `due_reminders` | Fire a notification at a time | `scheduler` | `notifier` | 3, expo 2s/10s/60s | yes |
| `ai_classify` | Backfill classifier tags | post-completion hook | `ai_worker` | 5, expo 30s..1h | yes |
| `ai_parse_assist` | Disambiguate low-confidence NL | UI on capture | `ai_worker` | 2, fast (5s/30s) | yes |
| `sync_outbound` | Push op log entries | `store` triggers | `sync_worker` | infinite, capped 24h | no |
| `digest_build` | Build morning/evening digest | scheduler `@every` | `digest_worker` | 3 | yes |

Visibility timeout: 60s for fast queues, 300s default for `ai_*`. Priority: `due_reminders` priority encodes reminder.priority so urgent items lead.

### 5.2 Cron / scheduled jobs (Honker scheduler)

```
nightly_archive       0 3 * * *         → enqueue archive sweep
morning_digest        0 7 * * *         → enqueue digest_build per user
evening_review        0 21 * * *        → optional, opt-in
reconcile_missed      @every 5m         → scan occurrences with fire_at < now-2m, state=pending
prune_notifications   0 4 * * *         → db.prune_notifications(older_than_s=7*86400)
sync_pull             @every 30s        → only if online + opted in
```

### 5.3 Worker lifecycle

```rust
// pseudocode
let q = db.queue("due_reminders");
let mut stream = q.claim("notifier-1");
while let Some(job) = stream.next().await {
    match handle(&job).await {
        Ok(()) => job.ack(),
        Err(e) if e.is_transient() => job.retry(backoff(job.attempts)),
        Err(e) => job.fail(e.to_string()),   // → _honker_dead
    }
}
```

Workers are tokio tasks supervised by a `WorkerSupervisor` that restarts them on panic with capped backoff. One supervisor per queue. The supervisor logs crashes to `behavior_events` (`kind=worker_crash`).

### 5.4 Crash recovery rules

- Honker reclaims expired in-flight jobs automatically after visibility timeout.
- On boot, `notifier` deduplicates: before firing, check `notification_events` for `(occurrence_id, channel)` — skip if present.
- A job that fails `max_attempts` times moves to `_honker_dead`. A diagnostics view surfaces dead jobs to the user as a small "Something didn't work" entry — never silent.

### 5.5 Transactional outbox example

```rust
let tx = db.transaction()?;
tx.execute("INSERT INTO reminders (...) VALUES (...)", params)?;
tx.execute("INSERT INTO occurrences (...) VALUES (...)", params)?;
q.enqueue_in_tx(&tx, "due_reminders", &payload, delay_until(fire_at))?;
tx.execute("INSERT INTO sync_oplog (...) VALUES (...)", params)?;
tx.commit()?;
```

Either all of it happens or none of it does. There is no orphan reminder without a queued notification, and no queued notification without a reminder.

---

## 6. Natural Language Parsing Strategy

A **layered cascade**, cheapest layer first. Bail out the moment confidence is high enough.

### 6.1 Layers

| Layer | Engine | Latency | Confidence range | Cost |
|---|---|---|---|---|
| L0: Slash commands | hand-rolled | <1ms | 1.0 if matched | 0 |
| L1: Datetime regex + chrono-english | `chrono` + custom rules | 1–5ms | 0.7–0.99 | 0 |
| L2: Structured templates ("every X", "on Mondays") | rule engine | 5ms | 0.85–0.99 | 0 |
| L3: Local NLP (date span + intent) | `rust-bert` MiniLM or a 100MB on-disk model (opt-in) | 30–100ms | 0.6–0.9 | 0 |
| L4: NIM LLM with structured output | HTTP to NIM | 200–800ms | 0.9+ when reached | $ |

### 6.2 Confidence scoring

Each layer returns `Parsed { title, when, recurrence, priority, confidence }`. The orchestrator accepts if `confidence >= 0.85`. Between 0.6 and 0.85, ask one clarifying question in-UI (no LLM call). Below 0.6 and L3 still uncertain → L4 (only if user opted in to AI), else show the typed-time picker.

### 6.3 Clarification triggers

- Ambiguous date ("next Friday" said on a Friday).
- Multiple verbs ("call mom and email Jim").
- Implicit recurrence ("Mondays" without start).
- Past-time without explicit acknowledgement.

Clarifications are inline chips: `[tomorrow 6pm] [next Friday 6pm] [type a time]`. Never a modal.

### 6.4 Worked examples

| Input | Resolved by | Output |
|---|---|---|
| `call mom tomorrow at 6pm` | L1 | title=`call mom`, when=tomorrow 18:00 local |
| `pay rent on the 1st of every month` | L2 | RRULE=`FREQ=MONTHLY;BYMONTHDAY=1`, dtstart=next 1st 09:00 |
| `bug Sarah about the doc thing next week` | L1+L3 | title=`bug Sarah about the doc thing`, when=Mon 09:00 next week, confidence 0.7 → clarify |
| `every other Tuesday at 3, dentist follow-up` | L2 | RRULE=`FREQ=WEEKLY;INTERVAL=2;BYDAY=TU`, dtstart=next Tue 15:00 |
| `remind me when I get home to take the trash out` | L4 (or fallback prompt: "no location triggers yet — set a time?") | — |

### 6.5 Tokenization rules

- Strip leading "remind me to / remember to / i need to".
- Pull out the time/date phrase; the rest is the title.
- Normalize whitespace, lowercase only for matching, preserve original case for display.

---

## 7. AI Layer Design

AI is enhancement, never dependency. Three roles only:

1. **Parse assist (L4)** when deterministic parsing is uncertain.
2. **Background classification** — tag completed reminders for trends ("admin", "social", "errand"). Read-only insight, no effect on scheduling.
3. **Phrasing / decomposition help** when the user clicks "help me break this down" on a heavy task.

### 7.1 Where AI is and is not used

| Use | Allowed | Forbidden |
|---|---|---|
| Decide whether to fire a notification | ❌ | always deterministic |
| Adjust priority adaptively | ❌ (V1) | future, behind explicit opt-in |
| Translate NL → structured reminder | ✅ (fallback only) | as primary parser |
| Suggest snooze duration | ✅ | as autoplay |
| Generate guilt copy | ❌❌❌ | never |

### 7.2 Prompt skeleton (parse assist)

```
SYSTEM: You convert a user's reminder phrase into JSON matching this schema.
Output JSON only. No prose. If a field is unknown, set it to null.

Schema:
{
  "title": string,
  "fire_at_iso": string|null,
  "rrule": string|null,
  "priority": 0|1|2|3,
  "confidence": number   // 0..1
}

Context:
- now = {ISO now}
- tz  = {IANA tz}
- user_locale = {locale}

USER: {raw phrase}
```

Enforce structured output via NIM's JSON-mode / function-calling. Reject and retry once on schema-invalid output. Two strikes → fall back to clarification UI.

### 7.3 Local model story

Optional embedded model (Phi-3-mini Q4, ~2GB, or smaller distilled date-NER). Shipped as an opt-in download via Settings. Same prompt contract as NIM — the `ai_client` trait is the same, only the transport differs.

```rust
trait AiClient: Send + Sync {
    async fn parse_assist(&self, raw: &str, ctx: ParseCtx) -> Result<ParseHint>;
    async fn classify(&self, reminder: &Reminder, ctx: ClassifyCtx) -> Result<Vec<Tag>>;
}
```

Two implementations: `NimClient`, `LocalLlmClient`. Wire by setting.

### 7.4 Caching

- Parse-assist cache keyed by SHA256(raw_phrase + tz_date) with 7-day TTL.
- Classification results stored on the reminder row, never re-asked.
- Cache lives in SQLite (`ai_cache(key, value, expires_at)`).

### 7.5 Cost & privacy posture

- All AI calls opt-in, OFF by default. First use shows what is sent and why.
- A hard monthly token cap (user-configurable) routed through Honker rate-limiting.
- Logs of outbound prompts retained 7 days locally; surfaced in Settings > AI > Recent Calls.
- Never send historical behavior to the cloud LLM. Only the current raw phrase + local time context.

### 7.6 Behavioral adaptation guardrails

Adaptive features (e.g. "you usually finish errands at 5pm, schedule there?") run on `behavior_events` locally and surface as suggestions, never automatic edits. Hard rule: the user's stated time always wins. The system can suggest, never override.

---

## 8. ADHD-Oriented UX Design

These are hard constraints. Every UI change is evaluated against them before merging.

### 8.1 Quick capture

- Global hotkey (`Cmd+Shift+Space` default, user-rebindable).
- Single text field; Enter to save; Esc to dismiss without saving.
- Live parse preview inline: `[tomorrow 6pm]` chip shows what was detected.
- One keystroke after typing to commit (Enter). No mouse path required.
- The capture overlay vanishes; **no confirmation toast** (toasts add cognitive load).

### 8.2 Keyboard workflows

| Action | Key |
|---|---|
| Capture overlay | `Cmd+Shift+Space` |
| Today list | `Cmd+1` |
| Inbox | `Cmd+2` |
| Mark done | `Space` on row |
| Snooze 1h / tomorrow / next-week | `S` then `1/2/3` |
| Edit inline | `Enter` on row |
| Delete | `Cmd+Backspace` (with undo) |

### 8.3 Notification pacing

- One notification per occurrence, with three actions: **Done**, **Snooze 1h**, **Snooze later** (which opens a tiny inline picker).
- If three or more reminders are due within a 10-minute window → collapse into a "3 things due" digest with expandable rows.
- "Catastrophic backlog" guard: if >10 reminders fire after a wake-from-sleep, the app surfaces a single calm card: "You have 14 reminders from earlier. [Review] [Snooze all 1h] [Snooze all tomorrow]." Never 14 popups.

### 8.4 Anti-overwhelm patterns

- "Today" view defaults to **top 3 only**, with an explicit "show all" affordance.
- Past-due items live in a separate, calm "Reschedule" bin rather than mixed with today.
- No counters on the dock icon by default.
- No red. Status uses neutral text + a subtle dot. Done items fade, not strike-through with celebratory animation.

### 8.5 Decomposition help

A "Break this down" button appears on any reminder with a `title` > 60 chars or marked `priority >= 2`. Clicking calls the AI layer to suggest 3–5 sub-steps; user can accept all, edit, or dismiss. Sub-steps create child reminders linked via `parent_id`. AI is never invoked automatically.

### 8.6 Shame-free interaction

- Never count missed items.
- Never show "X days streak" or "X% completion".
- Past-due reminders display age in calm terms ("from yesterday"), not "OVERDUE 14h 23m".
- "Done" and "not anymore" (cancel) are equally weighted; canceling is not punished.

### 8.7 Adaptive escalation

Off by default. When opt-in, the user picks per-reminder which can escalate (sound, second notification 5 min later, persistent banner). Never platform-wide.

---

## 9. Sync Architecture

Sync is **optional and additive**. The laptop's SQLite is authoritative; the server is a relay.

### 9.1 Approach

Operation log over WebSocket. CRDTs are overkill here — reminders have a clear authoritative author at any moment, and conflicts are rare. We use **per-entity LWW with vector clocks** for edits, plus explicit move/delete reconciliation. (If conflicts become real we revisit.)

### 9.2 Components

```
Device A ─┐
          ├──► WebSocket sync server (Rust, axum) ──► Postgres (op log, identity, e2e blobs)
Device B ─┘
```

- Outbound: device tails `sync_oplog`, pushes batches over WS, marks `pushed_at`.
- Inbound: server pushes ops since `last_seen_seq`; device applies idempotently.
- Each op has `(device_id, lamport_clock, hlc_ts)` to order writes.

### 9.3 Conflict resolution

- Same-field edit on two devices: HLC wins; loser kept in `conflicts` table for user review.
- Delete vs edit: delete wins iff `delete_ts >= edit_ts`; otherwise edit revives.
- Completion is monotonic: once completed anywhere, completion stands until explicitly un-completed.

### 9.4 Auth & encryption

- Identity: passkey / WebAuthn first; email magic link fallback.
- Transport: WSS only.
- At-rest: ops are E2E-encrypted (libsodium secretbox) with a key derived from a user passphrase; the server stores ciphertext blobs.
- Server cannot read reminder content. The server is a relay.

### 9.5 Supabase vs custom server — frank take

**Use a minimal custom server.** Supabase is great when you want auth + Postgres + storage in a hurry, but here the data is end-to-end encrypted and the access pattern is just an op log over WebSocket. Supabase's Row Level Security and Realtime don't help much when payloads are opaque ciphertext; you end up paying for Postgres features you can't use and a vendor dependency you don't need. A ~500-line axum service backed by Postgres (or Litestream-backed SQLite for the brave) is cheaper, simpler, and avoids leaking metadata to a third party. Use Supabase only as a stop-gap during MVP if it accelerates Phase 3.

### 9.6 Mobile path (Flutter, future)

Same op log, same schema. `sqflite` for storage; a Rust core compiled to a static library via `flutter_rust_bridge` keeps parser/scheduler shared. Honker on mobile is single-process; the queue still lives in the SQLite file. iOS notifications use UNUserNotificationCenter; Android uses AlarmManager + a foreground service for reliability.

---

## 10. Suggested Tech Stack

### 10.1 Desktop core

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Tiny binary, Rust core, good OS integration |
| UI | SolidJS + Vite | Fine-grained reactivity, ~7KB runtime, suits keyboard UX |
| State | Solid stores + Tanstack Query (Solid) | Cache + reactive |
| Styling | UnoCSS or Tailwind | Utility-first, fast iteration |
| Icons | Lucide | Calm, restrained |
| Rust async | Tokio | Standard |
| DB | rusqlite + bundled SQLite | Predictable, no system deps |
| Queue | Honker (Rust crate) | Per spec |
| Date math | chrono + chrono-tz + rrule | IANA TZs, RFC 5545 |
| NL parsing | `nom` for slash + custom rules; optional `rust-bert` for L3 | Avoid heavy deps in MVP |
| HTTP | reqwest (rustls) | TLS without OpenSSL |
| OS notifications | tauri-plugin-notification + `notify-rust` fallback | Cross-platform |
| Tray | tauri-plugin-system-tray | Quiet-mode toggle |
| Hotkeys | tauri-plugin-global-shortcut | Required for capture |
| Logging | tracing + tracing-subscriber + tracing-appender | Structured |
| Tests | cargo test, vitest for UI, Playwright for end-to-end | — |
| Telemetry | None by default. Optional local-only `sentry`/`tracing` panic capture. | — |

### 10.2 Sync server

| Layer | Choice |
|---|---|
| Framework | axum + tokio-tungstenite |
| DB | Postgres (sqlx) |
| Identity | webauthn-rs + custom magic link |
| Crypto | sodiumoxide / dryoc |
| Deploy | Single VM behind Caddy (auto-TLS) or Fly.io |

### 10.3 Mobile (later)

Flutter + sqflite + flutter_rust_bridge to share the Rust core.

---

## 11. Development Roadmap

Concrete phases. Each phase ends at a usable build, not a half-built feature.

### Phase 0 — Skeleton (1 week)
- Tauri + SolidJS app boots, single window.
- SQLite opens with Honker loaded; migration runner works.
- Global hotkey opens QuickCapture; pressing Enter logs to console.

### Phase 1 — MVP, single device, deterministic only (3–4 weeks)
- Schema (§4).
- L0–L2 parser (§6).
- Scheduler, occurrence materialization, Honker `due_reminders` queue.
- OS notifications with Done/Snooze actions.
- Today / Inbox / Snoozed views.
- Recurrence (RRULE: DAILY/WEEKLY/MONTHLY common shapes).
- Reconcile on wake/boot.
- Settings: hotkey, quiet hours, archive policy.
- **Ship to self + friends. Live on this for 2 weeks. Fix what hurts.**

### Phase 2 — Quality of life (2–3 weeks)
- Digest morning/evening.
- "Break this down" without AI (manual sub-tasks).
- Catastrophic-backlog handling.
- Conflict-free undo for delete/complete.
- Behavior event log + a basic "Insights" tab (counts only).

### Phase 3 — Optional AI (2–3 weeks)
- NIM client with structured outputs.
- L4 parse-assist behind opt-in.
- Background classification.
- Cost cap + Recent Calls log.

### Phase 4 — Sync (3–5 weeks)
- Op log generation already exists (§4 + §5). Build server + WS + crypto.
- Two-device test loop.
- Conflict UI.

### Phase 5 — Mobile (open-ended)
- Flutter shell, shared Rust core via flutter_rust_bridge.

### Delay (do not build early)
- Location triggers.
- Calendar integration (Google/iCloud).
- Team/sharing features.
- Voice capture.
- Web app.
- AI behavioral overrides.

### Likely bottlenecks
- OS notification action callbacks differ per platform — budget time for macOS UNUserNotificationCenter quirks under Tauri.
- DST + recurrence edge cases.
- Honker on Windows: confirm the loadable extension builds and loads under MSVC early in Phase 0.
- Tray + hotkey permission UX on macOS (Accessibility, Notifications, Login Items).

---

## 12. Open Source Strategy

### 12.1 Repo layout

```
/                       (Tauri root, root README)
  src-tauri/            Rust core
    crates/
      core/             store, parser, scheduler, notifier (lib)
      ai/               ai_client trait + impls
      sync/             optional sync client
      ipc/              Tauri command surface
  src/                  SolidJS UI
  migrations/           numbered .sql
  docs/                 design docs + ADRs
    adr/0001-honker.md  etc.
  scripts/              dev tooling
  server/               sync server (separate crate, separate deploy)
  packaging/            installers, signing, notarization
```

### 12.2 License

**Apache-2.0** for code, **CC-BY-SA-4.0** for docs. Apache over MIT because of explicit patent grant — relevant for a notification/scheduling tool.

### 12.3 Contributor experience

- `make setup` provisions everything.
- `cargo xtask dev` runs Tauri + UI with hot reload.
- Pre-commit: `cargo fmt`, `cargo clippy -D warnings`, `vitest run`.
- CI: GitHub Actions, matrix (mac/linux/win), build + test + clippy + size budget on binary.
- Issue templates: bug, idea, ADHD-impact (a specific template for "this hurt my brain").
- A `CONTRIBUTING.md` with one rule above all others: **propose UX changes against the principles in §1 and §8 first.**

### 12.4 Docs strategy

- README is for users.
- `docs/architecture.md` is this file, kept current.
- ADRs in `docs/adr/` for any decision a future contributor will second-guess (Honker, no CRDT, no telemetry, no streaks).
- A short `PHILOSOPHY.md` so contributors can't accidentally turn it into Habitica.

### 12.5 Release cadence

- `main` always shippable.
- Tagged release every 2–4 weeks.
- Signed + notarized installers (macOS, Windows). Linux: AppImage + .deb.
- Auto-update via `tauri-plugin-updater` with explicit user prompt — never silent.

### 12.6 Privacy / security expectations

- No analytics. Period.
- Crash reports opt-in, local-only by default.
- Threat model in `SECURITY.md` (data-at-rest, sync server, plugin surface).
- Disclosure: 90-day private window, then publish.

---

## 13. Risks and Failure Modes

| Risk | Surface | Impact | Mitigation |
|---|---|---|---|
| Missed fire during sleep | Notifier | High — trust collapse | Reconcile on wake; digest if many; never silently drop |
| Honker scheduler loses leadership during a switch | Queue | Medium — duplicate fires | Idempotent `notification_events` UNIQUE index |
| SQLite corruption | Store | Critical | WAL + integrity_check on boot + nightly backup to `.bak` |
| Clock jump (laptop time set wrongly) | Scheduler | Medium | Detect jumps >5min, re-derive next_fire_at |
| Notification permission revoked | OS | High | Detect on boot, show calm banner with one-click re-grant |
| AI service down | Optional layer | Low (degrades) | Fallback to L1–L3 + clarification chip |
| Bad LLM output schema | AI | Medium | JSON-mode + one retry + manual fallback |
| Sync conflict storm | Sync | Medium | LWW + visible conflicts list; never silent overwrite |
| User feels nagged | UX | Existential | Quiet defaults; digest collapsing; no escalation w/o opt-in |
| Catastrophic backlog after vacation | UX | High | Collapse to one card; bulk snooze; never fire 200 popups |
| Recurrence + DST drift | Scheduler | Medium | Store TZ, recompute next at every fire; tests across DST transitions |
| Honker dead-letter accumulates silently | Queue | Medium | "Something didn't work" indicator + Settings > Diagnostics |
| Binary bloat | Packaging | Low | Size budget in CI (< 30MB target); reject deps that blow past |
| Plugin / OS API churn between Tauri versions | Shell | Medium | Pin Tauri minor versions; integration test on each bump |
| User's keyboard layout breaks the hotkey | UX | Medium | Detect on first run; offer rebind UI |

---

## 14. Future Possibilities

Grounded, opinionated, and explicitly guarded against scope creep. Anything below requires (a) an ADR explaining why it's worth the complexity and (b) a degraded path if it fails.

- **Attention modeling.** Use behavior_events to infer when the user actually acts vs dismisses, and *suggest* (never enforce) better fire times. Strict opt-in.
- **Focus orchestration.** Integrate with system Focus / Do-Not-Disturb signals — never override, only respect.
- **Context awareness (light).** Detect "you're in a meeting" from calendar (if connected) and defer non-urgent fires until after — with a visible banner that this is happening.
- **Local models as default.** As small models improve, ship a 500MB optional bundle that obviates the need for NIM for parse-assist.
- **Semantic clustering.** Group similar reminders ("admin", "errands") locally to enable batch handling.
- **Intelligent retry.** A reminder you've snoozed 4 times surfaces a calm "this one keeps escaping you — want help breaking it down?" prompt — once, never more.
- **Ambient integrations.** Read-only links to calendar, email triage, GitHub issues — strictly opt-in, strictly local, strictly one-way (in).
- **Voice capture** on mobile, transcribed locally where possible.
- **Sharing one reminder** (not whole lists) with a single other person via the sync server — explicit, time-bounded.

### Guardrails (the no-list)

These are the things we will not build, even when asked:

1. Streaks, points, levels, badges, leaderboards.
2. AI-authored autonomous edits to user data.
3. "Productivity scores."
4. Default-on escalating notifications.
5. Required cloud account.
6. Third-party analytics or behavioral telemetry to any vendor.
7. A web app with feature parity (the desktop is the contract).
8. Anything that requires the AI to be up for a reminder to fire.

---

## Appendix A — Minimal Rust trait surface

```rust
pub trait Store {
    fn create_reminder(&self, draft: ReminderDraft) -> Result<Reminder>;
    fn update_reminder(&self, id: &Ulid, patch: ReminderPatch) -> Result<Reminder>;
    fn complete_occurrence(&self, occ_id: &Ulid) -> Result<()>;
    fn snooze_occurrence(&self, occ_id: &Ulid, resume_at: i64) -> Result<()>;
    fn list_today(&self) -> Result<Vec<Reminder>>;
    fn append_behavior(&self, ev: BehaviorEvent) -> Result<()>;
}

pub trait Scheduler {
    fn schedule(&self, r: &Reminder) -> Result<Vec<Ulid>>;   // occurrence ids
    fn reconcile(&self) -> Result<ReconcileReport>;
}

pub trait Notifier {
    fn fire(&self, occ: &Occurrence, r: &Reminder) -> Result<()>;
    fn handle_action(&self, occ_id: &Ulid, action: NotifyAction) -> Result<()>;
}

pub trait AiClient { /* §7.3 */ }
pub trait SyncClient {
    fn push(&self, ops: &[OpLogEntry]) -> Result<u64>;
    fn pull(&self, since: u64) -> Result<Vec<OpLogEntry>>;
}
```

## Appendix B — Tauri command surface (IPC)

```
capture_submit(raw: String) -> CaptureResult
list_today() -> Vec<ReminderView>
list_view(view: ViewKind, filter: Filter) -> Vec<ReminderView>
complete(id: Ulid) -> ()
snooze(id: Ulid, preset: SnoozePreset) -> ()
edit(id: Ulid, patch: ReminderPatch) -> ReminderView
settings_get() / settings_set(key, value)
diagnostics() -> DiagnosticsReport       // dead-letter counts, last reconcile, etc.
```

Events emitted from core → UI (via Tauri event system, backed by Honker stream `ui_events`):

```
reminder.upserted, reminder.deleted, reminder.fired,
backlog.detected, diagnostics.changed, sync.state_changed
```

---

*End of blueprint. Build phase 1 first. Live on it. Adjust this document.*