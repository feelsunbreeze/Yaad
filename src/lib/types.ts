/**
 * UI-side types for the Yaad reminder app.
 *
 * The shape here is intentionally separate from whatever the Rust backend
 * returns (see `src-tauri/src/commands.rs::ReminderView`). The hook
 * (`useReminders`) owns the `BackendReminder` ↔ `Reminder` mapping so the
 * components stay decoupled from the wire format.
 */

/** Which list is currently visible in the tab strip. */
export type Tab = "today" | "upcoming" | "done";

/** Tone of the small pill rendered next to a reminder's time. */
export type TagTone = "warm" | "green" | "red" | "muted";

/** Snooze presets understood by the Rust `snooze` IPC command. */
export type SnoozePreset = "1h" | "tonight" | "tomorrow" | "next_week";

export interface ReminderTag {
  /** lowercase display text, e.g. "important" */
  label: string;
  tone: TagTone;
}

export interface Reminder {
  id: string;
  /** human-written reminder text, e.g. "reply to email" */
  title: string;
  /**
   * Pre-formatted time label shown in the card meta row, e.g. "10:30 am".
   * Null when the reminder has no time set yet — the meta row is then hidden.
   */
  timeLabel: string | null;
  /** ms-since-epoch the reminder is meant to fire. Reserved for sorting; the
   *  card itself only displays `timeLabel`. */
  fireAt: number | null;
  /** ms-since-epoch when the reminder was completed (only set for done items). */
  completedAt: number | null;
  /** Whether the user has checked this off. Drives the strike-through state. */
  done: boolean;
  /** Marks the card with the red left spine + red dot on the right. */
  urgent: boolean;
  /** Optional pill in the meta row. */
  tag: ReminderTag | null;
  /** Which tab this reminder lives in. `done` is computed separately. */
  bucket: Exclude<Tab, "done">;
}

/** A clickable shortcut shown under the add-bar. */
export interface QuickTag {
  id: string;
  /** Visible text, may include emoji, e.g. "🌅 morning". */
  label: string;
  /**
   * Text prepended to the raw input when this tag is selected at submit time.
   * The Rust parser at `src-tauri/src/parser.rs` reads phrases like "tomorrow
   * morning" / "in 30 minutes" and sets `fire_at` accordingly, so we bake the
   * time cue into the text instead of inventing a new tag schema in the DB.
   * Null = no-op selector.
   */
  injectPrefix: string | null;
}
