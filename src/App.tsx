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
import { playSfx, setSfxMuted } from "@/lib/audio";
import { useReminders } from "@/hooks/useReminders";
import { formatDatePill, formatGreeting, formatTimeLive } from "@/lib/date";
import { Onboarding } from "@/components/Onboarding";
import { SettingsModal } from "@/components/SettingsModal";
import { SnoozeModal } from "@/components/SnoozeModal";
import { Titlebar } from "@/components/Titlebar";
import { ToastRoot } from "@/components/Toast";

/**
 * Notification permission bootstrap — preserved because it's functional, not
 * visual. Without granted permission Windows / macOS / Linux silently swallow
 * toasts from the Rust worker, so we ask once on mount.
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

export default function App() {
  const r = useReminders();

  const [userName, setUserName] = createSignal<string | null>(null);
  const [timeFormat, setTimeFormat] = createSignal<string>("12h");
  const [snoozeReminder, setSnoozeReminder] =
    createSignal<{ id: string; title: string; fireAt: number | null } | null>(null);
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
      // Sound defaults ON; only an explicit "false" mutes.
      setSfxMuted(settings["sound_enabled"] === "false");
    } catch (e) {
      console.error("Failed to load settings on mount", e);
    } finally {
      setLoadingInitial(false);
    }

    const clockTick = window.setInterval(() => setNow(new Date()), 500);

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        return;
      }

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
          if (rem) setSnoozeReminder({ id, title: rem.title, fireAt: rem.fireAt });
        }}
        shakingTaskId={r.shakingTaskId()}
        onLoadMore={r.loadMoreCompleted}
        snoozeDeparting={r.snoozeDeparting()}
        rescheduledId={r.rescheduledId()}
      />

      <SnoozeModal
        isOpen={snoozeReminder() !== null}
        taskTitle={snoozeReminder()?.title ?? ""}
        currentFireAt={snoozeReminder()?.fireAt ?? null}
        onClose={() => setSnoozeReminder(null)}
        onReschedule={(fireAtMs, humanTime) => {
          const s = snoozeReminder();
          if (s) {
            r.rescheduleReminder(s.id, fireAtMs, humanTime);
          }
          setSnoozeReminder(null);
        }}
      />

      <AddBar onSubmit={r.addReminder} />

      <ToastRoot />
    </div>
  );
}
