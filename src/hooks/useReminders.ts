import { createSignal, createMemo, onMount, onCleanup, batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { playSfx, playRandomNotify } from "@/lib/audio";
import { showToast } from "@/lib/toast";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Reminder, Tab } from "@/lib/types";

/**
 * Wire shape returned by `list_reminders` / `list_completed`. Matches the
 * `ReminderView` struct in `src-tauri/src/commands.rs` exactly.
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

const URGENT_WINDOW_MS = 3 * 60 * 60 * 1000;

/** End-of-today epoch ms — anything firing before this is in the "today"
 *  bucket; anything after is "upcoming". */
function endOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function bucketFor(fireAt: number | null, now: number): "today" | "upcoming" {
  return fireAt === null || fireAt <= endOfTodayMs(now) ? "today" : "upcoming";
}

function mapBackend(b: BackendReminder, now: number): Reminder {
  const done = b.status === "completed";
  const fireAt = b.fire_at;
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
    bucket: bucketFor(fireAt, now),
  };
}

/**
 * Central reminder hook. Owns the entire data lifecycle.
 */
export function useReminders() {
  const [reminders, setReminders] = createStore<Reminder[]>([]);
  const [tab, setTab] = createSignal<Tab>("today");
  const [error, setError] = createSignal<string | null>(null);
  const [shakingTaskId, setShakingTaskId] = createSignal<string | null>(null);
  const [completedOffset, setCompletedOffset] = createSignal(0);
  const [hasMoreCompleted, setHasMoreCompleted] = createSignal(true);
  const [backendDoneCount, setBackendDoneCount] = createSignal(0);
  // Cross-tab reschedule → the departing card slides out in this direction.
  const [snoozeDeparting, setSnoozeDeparting] = createSignal<{ id: string; direction: "left" | "right" } | null>(null);
  // Same-tab reschedule → the card stays put and its time label animates.
  const [rescheduledId, setRescheduledId] = createSignal<string | null>(null);
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

  /**
   * Reschedule a reminder to an explicit fire time (computed on the frontend
   * by the edit modal — named preset, ± delta, or parsed natural language).
   * The backend stores the timestamp verbatim via `reschedule_at`, so there's
   * no parser drift.
   *
   * Animation:
   *   - If the new time keeps the card in the SAME tab, we DON'T slide it
   *     away — it stays in place and its time label gets a soft "rescheduled"
   *     animation (see `.reminder-card.rescheduled` in App.css).
   *   - If it crosses tabs, the card slides out (direction swapped vs the old
   *     behaviour at the user's request) and the list reloads after the slide.
   */
  async function rescheduleReminder(id: string, fireAtMs: number, humanTime: string): Promise<void> {
    const now = Date.now();
    const current = reminders.find(r => r.id === id);
    const currentBucket = current?.bucket ?? "today";
    const newBucket = bucketFor(fireAtMs, now);

    try {
      // Tauri v2 exposes snake_case Rust params as camelCase to JS, so the
      // keys MUST be camelCase here (fireAtMs / humanTime). Passing snake_case
      // fails with "missing required key fireAtMs".
      await invoke("reschedule_at", { id, fireAtMs, humanTime });
      playSfx("snooze");

      if (newBucket === currentBucket) {
        // Stays in this tab → reload, then flag for the in-place time-swap
        // animation. No slide, no collapse.
        await loadReminders();
        setRescheduledId(id);
        setTimeout(() => setRescheduledId(null), 1000);
      } else {
        // Crosses tabs → slide the card out, then reload. Direction swapped
        // from the previous mapping per request: a task moving to "upcoming"
        // now exits left; one moving to "today" exits right.
        const direction: "left" | "right" = currentBucket === "upcoming" ? "left" : "right";
        setSnoozeDeparting({ id, direction });
        await new Promise(r => setTimeout(r, 600));
        setSnoozeDeparting(null);
        await loadReminders();
      }
      setError(null);
    } catch (e) {
      console.error("reschedule failed:", e);
      setSnoozeDeparting(null);
      setError(`couldn't reschedule: ${stringify(e)}`);
    }
  }

  function dismissError() {
    setError(null);
  }

  function raiseError(msg: string) {
    setError(msg);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  onMount(() => {
    let unfire: UnlistenFn | undefined;

    function onVisibility() {
      if (!document.hidden) void loadReminders();
    }

    void (async () => {
      await loadReminders();
      unfire = await listen<FiredPayload>("reminder:fired", e => {
        if (e.payload?.due) {
          playSfx("dueNow");
        } else {
          playRandomNotify();
        }
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
    rescheduleReminder,
    loadReminders,
    shakingTaskId,
    snoozeDeparting,
    rescheduledId,
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
