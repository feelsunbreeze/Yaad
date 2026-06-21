import { createSignal, createMemo, onMount, onCleanup, batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { playSfx, playRandomNotify } from "@/lib/audio";
import { showToast } from "@/lib/toast";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Reminder, Tab } from "@/lib/types";

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

interface FiredPayload {
  reminder_id: string;
  title: string;
  due: boolean;
}

const URGENT_WINDOW_MS = 3 * 60 * 60 * 1000;

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

export function useReminders() {
  const [reminders, setReminders] = createStore<Reminder[]>([]);
  const [tab, setTab] = createSignal<Tab>("today");
  const [error, setError] = createSignal<string | null>(null);
  const [shakingTaskId, setShakingTaskId] = createSignal<string | null>(null);
  const [completedOffset, setCompletedOffset] = createSignal(0);
  const [hasMoreCompleted, setHasMoreCompleted] = createSignal(true);
  const [backendDoneCount, setBackendDoneCount] = createSignal(0);
  const [snoozeDeparting, setSnoozeDeparting] = createSignal<{ id: string; direction: "left" | "right" } | null>(null);
  const [inlineReschedule, setInlineReschedule] = createSignal<{ id: string; fireAt: number; timeLabel: string } | null>(null);
  let isLoadingMore = false;

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

  async function rescheduleReminder(id: string, fireAtMs: number, humanTime: string): Promise<void> {
    const now = Date.now();
    const current = reminders.find(r => r.id === id);
    const currentBucket = current?.bucket ?? "today";
    const newBucket = bucketFor(fireAtMs, now);

    try {
      await invoke("reschedule_at", { id, fireAtMs, humanTime });

      if (newBucket === currentBucket) {
        playSfx("snoozeCurrent");
        setInlineReschedule({ id, fireAt: fireAtMs, timeLabel: humanTime });
        setTimeout(() => {
          setInlineReschedule(null);
          void loadReminders();
        }, 4000);
      } else {
        playSfx("snooze");
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
    reminders,
    tab,
    setTab,
    error,
    dismissError,
    raiseError,
    visible,
    total,
    done,
    percent,
    toggleDone,
    addReminder,
    rescheduleReminder,
    loadReminders,
    shakingTaskId,
    snoozeDeparting,
    inlineReschedule,
    hasMoreCompleted,
    loadMoreCompleted,
  };
}

function stringify(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
