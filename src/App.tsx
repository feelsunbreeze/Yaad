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
import { useReminders, QUICK_TAGS } from "@/hooks/useReminders";
import { formatDatePill, formatGreeting } from "@/lib/date";

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
 * subscriptions, 60s relative-time tick, visibility pause) lives inside
 * `useReminders`. App owns the notification permission flow, the greeting
 * clock, and the test-alert hook on the gear icon.
 *
 * Layout follows the prototype exactly:
 *
 *   .app             (grid: auto 1fr auto, max 440px column)
 *   ├── .header      (greeting + progress + tabs, single rise animation)
 *   ├── .error-banner (mounted only when an invoke fails)
 *   ├── .list-wrap   (scrollable section + cards / empty state)
 *   └── .add-bar     (input + quick tags)
 */
export default function App() {
  const r = useReminders();

  // Re-evaluate greeting + date pill every minute so leaving the app open
  // across noon flips "good morning" → "good afternoon" without a refresh.
  const [now, setNow] = createSignal(new Date());
  const greeting = createMemo(() => formatGreeting(now()));
  const date     = createMemo(() => formatDatePill(now()));

  onMount(() => {
    void ensureNotificationPermission();

    const clockTick = window.setInterval(() => setNow(new Date()), 60_000);
    onCleanup(() => window.clearInterval(clockTick));
  });

  /**
   * Gear icon → fire an OS test notification. If the call rejects (OS has
   * denied us / not bundled with a registered AUMID on Windows / libnotify
   * missing on Linux), surface the underlying reason through the same
   * error banner the hook uses for IPC failures.
   */
  async function onTestNotification() {
    try {
      await invoke("test_notification");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("test_notification failed:", msg);
      r.raiseError(`notification test failed: ${msg}`);
    }
  }

  return (
    <div class="app">
      <header class="header">
        <Header
          greeting={greeting()}
          date={date()}
          onSettings={onTestNotification}
        />
        <ProgressBar
          done={r.done()}
          total={r.total()}
          percent={r.percent()}
        />
        <Tabs current={r.tab()} onChange={r.setTab} />
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
        onSnooze={r.snoozeReminder}
      />

      <AddBar quickTags={QUICK_TAGS} onSubmit={r.addReminder} />
    </div>
  );
}
