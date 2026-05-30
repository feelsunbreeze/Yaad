import { createSignal, createMemo, onMount, onCleanup, batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { playSfx, playRandomNotify } from "@/lib/audio";
import { showToast } from "@/lib/toast";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Reminder, Tab, SnoozePreset } from "@/lib/types";

/**
 * Wire shape returned by `list_reminders` / `list_completed`. Matches the
 * `ReminderView` struct in `src-tauri/src/commands.rs` exactly — if you
 * change that struct, mirror it here. Field names use snake_case because
 * Serde serialises Rust struct fields verbatim.
 */
interface BackendReminder {
  id: string;
  title: string;
  status: string;
  priority: number;
  created_at: number;
  fire_at: number | null;
  human_time: string | null;
  completed_at: number | null;
}

/** Payload emitted by the Rust worker on every fire. `due` is set by the
 *  backend at enqueue time: true for the exact-deadline fire, false for a
 *  pre-deadline nudge. We trust it rather than re-deriving from clocks. */
interface FiredPayload {
  reminder_id: string;
  title: string;
  due: boolean;
}

/** Three-hour urgency window, milliseconds. Same threshold the prior UI
 *  used for the "Right now" partition, so the red treatment surfaces at
 *  the time bound the user already calibrated against. */
const URGENT_WINDOW_MS = 3 * 60 * 60 * 1000;


/** End-of-today epoch ms — anything firing before this is in the "today"
 *  bucket; anything after is "upcoming". */
function endOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Map a Rust `ReminderView` into the UI `Reminder` shape.
 *
 * Derived fields:
 *   - `bucket`  : null / past / before-end-of-day → "today", else → "upcoming"
 *   - `urgent`  : not done AND fires within 3h (or overdue)
 */
function mapBackend(b: BackendReminder, now: number): Reminder {
  const done = b.status === "completed";
  const fireAt = b.fire_at;
  const bucket: "today" | "upcoming" =
    fireAt === null || fireAt <= endOfTodayMs(now) ? "today" : "upcoming";
  const urgent = !done && fireAt !== null && fireAt <= now + URGENT_WINDOW_MS;

  return {
    id: b.id,
    title: b.title,
    timeLabel: b.human_time,
    fireAt,
    completedAt: b.completed_at,
    done,
    urgent,
    tag: null,
    bucket,
  };
}


/**
 * Central reminder hook. Owns the entire data lifecycle:
 *
 *   - initial fetch
 *   - listen("reminder:fired") refresh
 *   - on fire: play the right sound (due_now vs random nudge) + in-app toast
 *   - visibility-aware refresh on resume
 *   - surfaces invoke errors via the `error` signal (App.tsx renders a banner)
 *
 * Returns plain accessors + action callbacks so the components stay dumb.
 */
export function useReminders() {
  const [reminders, setReminders] = createStore<Reminder[]>([]);
  const [tab, setTab] = createSignal<Tab>("today");
  const [error, setError] = createSignal<string | null>(null);
  const [shakingTaskId, setShakingTaskId] = createSignal<string | null>(null);
  const [completedOffset, setCompletedOffset] = createSignal(0);
  const [hasMoreCompleted, setHasMoreCompleted] = createSignal(true);
  const [backendDoneCount, setBackendDoneCount] = createSignal(0);
  const [snoozeDeparting, setSnoozeDeparting] = createSignal<{ id: string; direction: "left" | "right" } | null>(null);
  let isLoadingMore = false;

  // ── Derived ─────────────────────────────────────────────────────────────

  const visible = createMemo<Reminder[]>(() => {
    const t = tab();
    if (t === "done") return reminders.filter(r => r.done);
    if (t === "today") return reminders.filter(r => !r.done && r.bucket === "today");
    return reminders.filter(r => !r.done && r.bucket === "upcoming");
  });

  const done = createMemo(() => {
    const optimistic = reminders.filter(r => r.done && r.completedAt === null).length;
    return backendDoneCount() + optimistic;
  });

  const total = createMemo(() => {
    const active = reminders.filter(r => !r.done).length;
    return active + done();
  });

  const percent = createMemo(() =>
    total() === 0 ? 0 : Math.round((done() / total()) * 100)
  );

  // ── Actions ─────────────────────────────────────────────────────────────

  async function loadReminders(): Promise<void> {
    try {
      const currentCompletedCount = Math.max(10, completedOffset() + 10);

      const [active, completed, doneCount] = await Promise.all([
        invoke<BackendReminder[]>("list_reminders"),
        invoke<BackendReminder[]>("list_completed", { limit: currentCompletedCount, offset: 0 }),
        invoke<number>("count_completed"),
      ]);
      const now = Date.now();

      setHasMoreCompleted(completed.length >= currentCompletedCount);
      setBackendDoneCount(doneCount);

      setReminders(reconcile([...active, ...completed].map(b => mapBackend(b, now))));
      setError(null);
    } catch (e) {
      console.error("loadReminders failed:", e);
      setError(`couldn't load reminders: ${stringify(e)}`);
    }
  }

  async function loadMoreCompleted(): Promise<void> {
    if (!hasMoreCompleted() || isLoadingMore) return;
    isLoadingMore = true;
    const newOffset = completedOffset() + 10;
    try {
      const moreCompleted = await invoke<BackendReminder[]>("list_completed", { limit: 10, offset: newOffset });
      if (moreCompleted.length < 10) {
        setHasMoreCompleted(false);
      }
      if (moreCompleted.length > 0) {
        const now = Date.now();
        const mapped = moreCompleted.map(b => mapBackend(b, now));
        // We append to the store's array directly.
        setReminders(prev => [...prev, ...mapped]);
        setCompletedOffset(newOffset);
      }
    } catch (e) {
      console.error("loadMoreCompleted failed:", e);
    } finally {
      isLoadingMore = false;
    }
  }

  async function toggleDone(id: string): Promise<void> {
    const r = reminders.find(x => x.id === id);
    if (!r) return;
    // Backend `complete` is one-way — Yaad has no "reopen" command. Clicking
    // a done card is a deliberate no-op until the Rust side grows one.
    if (r.done) return;


    // Optimistic flip — the check fills immediately, then reconcile with
    // backend truth on refresh.
    setReminders(x => x.id === id, "done", true);

    try {
      await invoke("complete", { id });
      await loadReminders();
    } catch (e) {
      console.error("complete failed:", e);
      setReminders(x => x.id === id, "done", false);
      setError(`couldn't mark done: ${stringify(e)}`);
    }
  }

  async function addReminder(rawTitle: string): Promise<void> {
    const title = rawTitle.trim();
    if (!title) return;

    try {
      const beforeIds = new Set(reminders.map(r => r.id));
      await invoke("capture_submit", { raw: title });
      await loadReminders();

      const newTasks = reminders.filter(r => !beforeIds.has(r.id));
      if (newTasks.length > 0) {
        const newTask = newTasks[0];

        // If it landed in a different time-based tab, smoothly auto-switch
        if (newTask.bucket !== tab()) {
          batch(() => {
            setShakingTaskId(newTask.id);
            setTab(newTask.bucket);
          });

          setTimeout(() => setShakingTaskId(null), 850);
        }
      }
      playSfx("addTask");
      setError(null);
    } catch (e) {
      console.error("capture_submit failed:", e);
      setError(`couldn't add reminder: ${stringify(e)}`);
    }
  }

  async function snoozeReminder(id: string, preset: SnoozePreset): Promise<void> {
    try {
      // Determine the current bucket so we know which direction to slide
      const currentReminder = reminders.find(r => r.id === id);
      const currentBucket = currentReminder?.bucket ?? "today";

      await invoke("snooze", { id, preset });
      playSfx("snooze");

      // Snoozing usually pushes a task later → slide left.
      // If it somehow moves earlier (rare), slide right.
      const direction = currentBucket === "upcoming" ? "right" : "left";
      setSnoozeDeparting({ id, direction });

      // Wait for the slide-out + collapse animation before refreshing
      await new Promise(r => setTimeout(r, 600));
      setSnoozeDeparting(null);
      await loadReminders();
    } catch (e) {
      console.error("snooze failed:", e);
      setError(`couldn't snooze: ${stringify(e)}`);
    }
  }

  function dismissError() {
    setError(null);
  }

  /** External (App / components) entry point to surface a one-shot error
   *  through the same banner the hook uses for invoke failures. */
  function raiseError(msg: string) {
    setError(msg);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  //
  // Owns:
  //   - first load
  //   - reminder:fired subscription (sound + in-app cue + refresh)
  //   - visibility-aware refresh on resume

  onMount(() => {
    let unfire: UnlistenFn | undefined;

    function onVisibility() {
      if (!document.hidden) {
        // Immediate refresh on resume — relative timestamps and any reminders
        // fired while hidden are now up to date.
        void loadReminders();
      }
    }

    void (async () => {
      await loadReminders();
      unfire = await listen<FiredPayload>("reminder:fired", e => {
        // `due` is authoritative — set by the backend at enqueue time. The
        // exact-deadline fire plays due_now; pre-deadline nudges play a random
        // notify tone. No clock-skew inference.
        if (e.payload?.due) {
          playSfx("dueNow");
        } else {
          playRandomNotify();
        }

        // Guaranteed-visible in-app cue — fires even when the OS toast is
        // suppressed (Windows dev-mode AUMID, denied permission, etc).
        const title = e.payload?.title?.trim();
        showToast(title ? `Surfacing: ${title}` : "A reminder is surfacing");

        void loadReminders();
      });
    })();

    document.addEventListener("visibilitychange", onVisibility);

    onCleanup(() => {
      unfire?.();
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  return {
    // state
    reminders,
    tab,
    setTab,
    error,
    dismissError,
    raiseError,
    // derived
    visible,
    total,
    done,
    percent,
    // actions
    toggleDone,
    addReminder,
    snoozeReminder,
    loadReminders,
    shakingTaskId,
    snoozeDeparting,
    hasMoreCompleted,
    loadMoreCompleted,
  };
}

/** Stringify an unknown error in a way that survives both `Error` and Tauri's
 *  string error payloads. */
function stringify(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
