import { createSignal, createMemo, onMount, onCleanup } from "solid-js";
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
 * Notification permission bootstrap from PR #1 — preserved here because it's
 * functional, not visual. On Windows 11 the OS silently swallows toasts from
 * apps it hasn't been granted permission for, so we ask once on mount; the OS
 * remembers the choice forever after.
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
 * Thin composition root. All real logic lives in `useReminders` (state +
 * actions) and the component files. Layout follows the prototype exactly:
 *
 *   .app             (grid: auto 1fr auto, max 440px column)
 *   ├── .header      (greeting + progress + tabs, single rise animation)
 *   ├── .list-wrap   (scrollable section + cards / empty state)
 *   └── .add-bar     (input + quick tags)
 */
export default function App() {
  const r = useReminders();

  // Ticks the greeting / date pill once a minute so leaving the app open
  // across noon flips "good morning" → "good afternoon" without a refresh.
  const [now, setNow] = createSignal(new Date());
  const greeting = createMemo(() => formatGreeting(now()));
  const date     = createMemo(() => formatDatePill(now()));

  onMount(() => {
    void ensureNotificationPermission();
    void r.loadReminders();

    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    onCleanup(() => window.clearInterval(tick));
  });

  return (
    <div class="app">
      <header class="header">
        <Header greeting={greeting()} date={date()} />
        <ProgressBar
          done={r.done()}
          total={r.total()}
          percent={r.percent()}
        />
        <Tabs current={r.tab()} onChange={r.setTab} />
      </header>

      <ReminderList
        reminders={r.visible()}
        tab={r.tab()}
        onToggle={r.toggleDone}
      />

      <AddBar quickTags={QUICK_TAGS} onSubmit={r.addReminder} />
    </div>
  );
}
