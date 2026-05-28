import { createSignal, createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import type { Reminder, Tab, QuickTag } from "@/lib/types";

/**
 * Seed data so the prototype renders something on first run.
 *
 * Replace with `await invoke("list_reminders")` inside `loadReminders()`
 * — the call sites for every backend command (capture_submit, list_reminders,
 * complete, list_completed, snooze) are flagged with `TODO: invoke(...)`
 * below so wiring them up is a search-and-replace exercise.
 */
const SEED: Reminder[] = [
  {
    id: "r1",
    title: "reply to email",
    timeLabel: "10:30 am",
    fireAt: null,
    done: false,
    urgent: true,
    tag: { label: "important", tone: "warm" },
    bucket: "today",
  },
  {
    id: "r2",
    title: "call dad",
    timeLabel: "2:00 pm",
    fireAt: null,
    done: false,
    urgent: false,
    tag: { label: "family", tone: "green" },
    bucket: "today",
  },
  {
    id: "r3",
    title: "buy oat milk",
    timeLabel: null,
    fireAt: null,
    done: false,
    urgent: false,
    tag: null,
    bucket: "today",
  },
  {
    id: "r4",
    title: "renew library card",
    timeLabel: "next monday",
    fireAt: null,
    done: false,
    urgent: false,
    tag: { label: "errand", tone: "muted" },
    bucket: "upcoming",
  },
  {
    id: "r5",
    title: "submit timesheet",
    timeLabel: "9:00 am",
    fireAt: null,
    done: true,
    urgent: false,
    tag: null,
    bucket: "today",
  },
];

/**
 * Quick-tag chips rendered under the bottom input. Selecting one before
 * submitting tags the resulting reminder. `marksUrgent: true` flips the
 * `urgent` flag (red left spine + red dot on the right of the card).
 */
export const QUICK_TAGS: QuickTag[] = [
  { id: "morning", label: "🌅 morning", tone: "warm", marksUrgent: false },
  { id: "urgent",  label: "⚡ urgent",  tone: "red",  marksUrgent: true  },
];

/**
 * Central reminder state. Returns plain accessors + action callbacks so the
 * components stay dumb and the data plumbing lives in one file.
 *
 * State shape:
 *   - `reminders`  : full Reminder[] store
 *   - `tab`        : currently-selected tab signal
 *
 * Derived:
 *   - `visible`    : Reminder[] filtered for the active tab
 *   - `total`      : total reminder count (drives progress bar denominator)
 *   - `done`       : completed reminder count
 *   - `percent`    : `done/total * 100`, rounded
 *
 * Actions:
 *   - `setTab(t)`              : switch tab
 *   - `toggleDone(id)`         : flip a reminder's done state
 *   - `addReminder(text, ids)` : push a new reminder, applying quick-tag effects
 *   - `loadReminders()`        : refresh from backend (stub — wire to invoke)
 */
export function useReminders() {
  const [reminders, setReminders] = createStore<Reminder[]>(SEED);
  const [tab, setTab] = createSignal<Tab>("today");

  const visible = createMemo<Reminder[]>(() => {
    const t = tab();
    if (t === "done") return reminders.filter(r => r.done);
    if (t === "today") return reminders.filter(r => !r.done && r.bucket === "today");
    return reminders.filter(r => !r.done && r.bucket === "upcoming");
  });

  const total   = createMemo(() => reminders.length);
  const done    = createMemo(() => reminders.filter(r => r.done).length);
  const percent = createMemo(() =>
    total() === 0 ? 0 : Math.round((done() / total()) * 100)
  );

  function toggleDone(id: string) {
    setReminders(r => r.id === id, "done", d => !d);
    // TODO: invoke("complete", { id })  — and refetch via loadReminders().
    //   On uncomplete, you'll need a new Rust command (none exists yet) or
    //   adjust the schema so the UI can re-open a completed reminder.
  }

  function addReminder(rawTitle: string, selectedTagIds: string[]) {
    const title = rawTitle.trim();
    if (!title) return;

    const matched   = QUICK_TAGS.filter(q => selectedTagIds.includes(q.id));
    const urgent    = matched.some(q => q.marksUrgent);
    const firstTone = matched.find(q => q.tone !== null) ?? null;
    const tag = firstTone
      ? {
          // strip the leading emoji+space so the pill reads "morning" / "urgent"
          // rather than "🌅 morning".
          label: firstTone.label.replace(/^\S+\s+/, ""),
          tone:  firstTone.tone!,
        }
      : null;

    const next: Reminder = {
      id: "r" + Date.now().toString(36),
      title,
      timeLabel: null,
      fireAt: null,
      done: false,
      urgent,
      tag,
      bucket: "today",
    };
    setReminders(curr => [...curr, next]);
    // TODO: invoke("capture_submit", { raw: title })
    //   then `await loadReminders()` to pick up the parsed fireAt + human_time
    //   from the Rust parser.
  }

  async function loadReminders(): Promise<void> {
    // TODO: replace the body with:
    //   const data = await invoke<BackendReminder[]>("list_reminders");
    //   const completed = await invoke<BackendReminder[]>("list_completed");
    //   setReminders([...data, ...completed].map(mapBackend));
    //
    // Where `mapBackend` converts the Rust ReminderView into our UI Reminder:
    //   - title         → title
    //   - human_time    → timeLabel
    //   - fire_at       → fireAt
    //   - status === "completed" → done
    //   - bucket can be derived from `fire_at` (today vs. upcoming)
  }

  return {
    // state
    reminders,
    tab,
    setTab,
    // derived
    visible,
    total,
    done,
    percent,
    // actions
    toggleDone,
    addReminder,
    loadReminders,
  };
}
