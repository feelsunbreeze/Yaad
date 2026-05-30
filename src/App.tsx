import { createSignal, createMemo, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import "./App.css";

import { Header } from "@/components/Header";
import { ProgressBar } from "@/components/ProgressBar";
import { Tabs } from "@/components/Tabs";
import { ReminderList } from "@/components/ReminderList";
import { AddBar } from "@/components/AddBar";
import { playSfx } from "@/lib/audio";
import { useReminders } from "@/hooks/useReminders";
import { formatDatePill, formatGreeting, formatTimeLive } from "@/lib/date";
import { Onboarding } from "@/components/Onboarding";
import { SettingsModal } from "@/components/SettingsModal";
import { SnoozeModal } from "@/components/SnoozeModal";
import { Titlebar } from "@/components/Titlebar";
import { ToastRoot } from "@/components/Toast";

/**
 * Notification permission bootstrap from PR #1 — preserved here because
 * it's functional, not visual. Without granted permission Windows 11 /
 * macOS / Linux silently swallow toasts from the Rust worker, so we ask
 * once on mount; the OS remembers the choice forever after.
 */
async function ensureNotificationPermission(): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const res = await requestPermission();
      granted = res === "granted";
    }
    if (!granted) {
      console.warn(
        "Yaad: OS notification permission was not granted — system toasts will not appear."
      );
    }
  } catch (e) {
    console.error("Notification permission check failed:", e);
  }
}

/**
 * Thin composition root. Reminder data lifecycle (initial fetch, OS event
 * subscriptions, visibility refresh) lives inside `useReminders`. App owns
 * the notification permission flow, the greeting clock, and the test-alert
 * hook on the gear icon.
 *
 * Layout:
 *
 *   .app             (grid: auto auto auto 1fr auto, max 440px column)
 *   ├── Titlebar     (custom window minimize/close control bar)
 *   ├── .header      (greeting + progress + tabs, single rise animation)
 *   ├── .error-banner (mounted only when an invoke fails)
 *   ├── .list-wrap   (scrollable section + cards / empty state)
 *   └── .add-bar     (input + quick tags)
 *
 *   ToastRoot        (fixed-position in-app notification cue, fires on
 *                     reminder:fired even when the OS toast is suppressed)
 */
export default function App() {
  const r = useReminders();

  const [userName, setUserName] = createSignal<string | null>(null);
  const [timeFormat, setTimeFormat] = createSignal<string>("12h");
  const [snoozeReminder, setSnoozeReminder] = createSignal<{ id: string; title: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [loadingInitial, setLoadingInitial] = createSignal(true);

  // Re-evaluate greeting + date pill + live time
  const [now, setNow] = createSignal(new Date());
  const greeting = createMemo(() => formatGreeting(now(), userName() || undefined));
  const date     = createMemo(() => formatDatePill(now()));
  const time     = createMemo(() => formatTimeLive(now(), timeFormat()));

  onMount(async () => {
    void ensureNotificationPermission();

    try {
      const settings = await invoke<Record<string, string>>("get_settings");
      if (settings["name"]) {
        setUserName(settings["name"]);
      }
      if (settings["time_format"]) {
        setTimeFormat(settings["time_format"]);
      }
    } catch (e) {
      console.error("Failed to load settings on mount", e);
    } finally {
      setLoadingInitial(false);
    }

    const clockTick = window.setInterval(() => setNow(new Date()), 500);

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault(); // Prevent default OS/browser tab switching
        return;
      }

      // Ignore single-character shortcuts if the user is typing in an input
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector(".add-input") as HTMLInputElement | null;
        input?.focus();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        const cards = document.querySelectorAll(".reminder-card");
        if (cards[index]) {
          (cards[index] as HTMLElement).focus();
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        playSfx("tabSwitch");
        r.setTab(r.tab() === "today" ? "upcoming" : "today");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    onCleanup(() => {
      window.clearInterval(clockTick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });
  });

  function onSettings() {
    setIsSettingsOpen(true);
  }

  function handleFactoryReset() {
    setUserName(null);
    setIsSettingsOpen(false);
    r.loadReminders();
  }

  return (
    <div class="app">
      <Titlebar />

      {!loadingInitial() && !userName() && (
        <Onboarding onComplete={(name, format) => {
          setUserName(name);
          setTimeFormat(format);
        }} />
      )}

      <SettingsModal
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
        currentName={userName() || ""}
        onNameChange={(name) => setUserName(name)}
        timeFormat={timeFormat()}
        onTimeFormatChange={(fmt) => setTimeFormat(fmt)}
        onFactoryReset={handleFactoryReset}
      />

      <header class="header">
        <Header
          greeting={greeting()}
          date={date()}
          time={time()}
          onSettings={onSettings}
        />
        <ProgressBar
          done={r.done()}
          total={r.total()}
          percent={r.percent()}
        />
        <Tabs current={r.tab()} onChange={(t) => { playSfx("tabSwitch"); r.setTab(t); }} />
      </header>

      <Show when={r.error()} keyed>
        {msg => (
          <div class="error-banner" role="alert">
            <span class="error-banner-text">{msg}</span>
            <button
              type="button"
              class="error-banner-dismiss"
              aria-label="Dismiss error"
              onClick={r.dismissError}
            >
              ×
            </button>
          </div>
        )}
      </Show>

      <ReminderList
        reminders={r.visible()}
        tab={r.tab()}
        onToggle={r.toggleDone}
        onSnoozeRequest={(id) => {
          const rem = r.visible().find(x => x.id === id);
          if (rem) setSnoozeReminder({ id, title: rem.title });
        }}
        shakingTaskId={r.shakingTaskId()}
        onLoadMore={r.loadMoreCompleted}
        snoozeDeparting={r.snoozeDeparting()}
      />

      <SnoozeModal
        isOpen={snoozeReminder() !== null}
        taskTitle={snoozeReminder()?.title ?? ""}
        onClose={() => setSnoozeReminder(null)}
        onSubmit={(preset) => {
          const s = snoozeReminder();
          if (s) {
            r.snoozeReminder(s.id, preset);
          }
          setSnoozeReminder(null);
        }}
      />

      <AddBar onSubmit={r.addReminder} />

      <ToastRoot />
    </div>
  );
}
