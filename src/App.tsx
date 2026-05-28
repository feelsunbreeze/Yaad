import {
  createSignal, onMount, For, Show, createMemo, onCleanup
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import "./App.css";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";

// ── Types ────────────────────────────────────────────────────────────────────

interface ReminderView {
  id: string;
  title: string;
  status: string;
  priority: number;
  created_at: number;
  fire_at: number | null;
  human_time: string | null;
}

type SnoozePreset = "1h" | "tonight" | "tomorrow" | "next_week";

// ── Time helpers ─────────────────────────────────────────────────────────────

const NOW = () => Date.now();

function relativeTime(fire_at: number | null): { label: string; kind: "urgent" | "overdue" | "normal" } {
  if (!fire_at) return { label: "no time set", kind: "normal" };
  const diff = fire_at - NOW();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const mins = Math.floor(abs / 60000);
  const hrs = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);

  let label: string;
  if (past) {
    if (days >= 2) label = `${days} days past`;
    else if (days === 1) label = "from yesterday";
    else if (hrs >= 1) label = `${hrs}h ago`;
    else label = mins < 1 ? "just now" : `${mins}m ago`;
    return { label, kind: "overdue" };
  }
  if (mins < 1) return { label: "now", kind: "urgent" };
  if (hrs < 1) return { label: `in ${mins}m`, kind: "urgent" };
  if (hrs < 24) return { label: `in ${hrs}h`, kind: hrs < 3 ? "urgent" : "normal" };
  return { label: `in ${days}d`, kind: "normal" };
}

function isUrgentSection(fire_at: number | null): boolean {
  if (!fire_at) return true;
  return fire_at <= NOW() + 3_600_000 * 3; // ≤3h from now
}

function formatCompletedTime(completedAt: number | null): string {
  if (!completedAt) return "resolved";
  const diff = Date.now() - completedAt;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const hrs = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);

  if (days >= 2) return `resolved ${days} days ago`;
  if (days === 1) return "resolved yesterday";
  if (hrs >= 1) return `resolved ${hrs}h ago`;
  return mins < 1 ? "resolved just now" : `resolved ${mins}m ago`;
}


// ── Live parse preview (lightweight client-side approximation) ───────────────

function sniffTime(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/in (\d+)\s*min(ute)?s?/, m => `in ${m[1]} min`],
    [/in (\d+)\s*h(our)?s?/, m => `in ${m[1]}h`],
    [/in (\d+)\s*day(s)?/, m => `in ${m[1]}d`],
    [/tonight/, () => "tonight ~9 PM"],
    [/tomorrow/, () => "tomorrow ~9 AM"],
    [/noon/, () => "today at noon"],
    [/morning/, () => "tomorrow morning"],
    [/evening/, () => "this evening"],
    [/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/, m => `this ${m[1]}`],
    [/(\d{1,2}):(\d{2})\s*(am|pm)/, m => `at ${m[1]}:${m[2]} ${m[3].toUpperCase()}`],
    [/(\d{1,2})\s*(am|pm)/, m => `at ${m[1]} ${m[2].toUpperCase()}`],
  ];
  for (const [re, fmt] of patterns) {
    const m = s.match(re);
    if (m) return fmt(m);
  }
  return null;
}

// ── Notification permission ──────────────────────────────────────────────────
//
// On Windows 11 (and macOS / Linux), the OS will silently swallow any toast
// from an app that hasn't been granted notification permission. We ask once
// on app mount; once granted, the OS remembers forever. After this runs,
// every `app.notification().builder()...show()` call from the Rust side
// (worker.rs, commands.rs) will surface as a real Windows 11 toast in Action
// Center — not as an in-program <div>.
async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const res = await requestPermission();
      granted = res === "granted";
    }
    if (!granted) {
      console.warn("Yaad: OS notification permission was not granted — system toasts will not appear.");
    }
    return granted;
  } catch (e) {
    console.error("Notification permission check failed:", e);
    return false;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [reminders, setReminders] = createSignal<ReminderView[]>([]);
  const [completedReminders, setCompletedReminders] = createSignal<ReminderView[]>([]);
  const [currentTab, setCurrentTab] = createSignal<"active" | "completed">("active");
  const [raw, setRaw] = createSignal("");
  const [overlay, setOverlay] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [dissolving, setDissolving] = createSignal(new Set<string>());
  const [snoozeFor, setSnoozeFor] = createSignal<string | null>(null);
  const [showAlert, setShowAlert] = createSignal(false);

  const chip = createMemo(() => sniffTime(raw()));

  // ── Partitioned lists ─────────────────────────────────────────────────────
  const nowSection = createMemo(() => reminders().filter(r => isUrgentSection(r.fire_at)));
  const upcomingSection = createMemo(() => reminders().filter(r => !isUrgentSection(r.fire_at)));

  // ── Data ──────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const data = await invoke<ReminderView[]>("list_reminders");
      setReminders(data);
    } catch (e) { console.error(e); }
  }

  async function loadCompleted() {
    try {
      const data = await invoke<ReminderView[]>("list_completed");
      setCompletedReminders(data);
    } catch (e) { console.error(e); }
  }

  async function triggerTestNotification() {
    // Show the animated in-app alert
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 3000);

    // Make sure the OS will accept our toast. No in-app fallback rendering —
    // if Windows refuses the toast, we want to know, not paper over it.
    const ok = await ensureNotificationPermission();
    if (!ok) return;
    try {
      await invoke("test_notification");
    } catch (e) { console.error(e); }
  }

  // ── Capture ───────────────────────────────────────────────────────────────
  async function submit(e: Event) {
    e.preventDefault();
    const text = raw().trim();
    if (!text || saving()) return;
    setSaving(true);
    try {
      await invoke("capture_submit", { raw: text });
      setRaw("");
      setOverlay(false);
      await load();
      await loadCompleted();
    } finally { setSaving(false); }
  }

  // ── Complete ──────────────────────────────────────────────────────────────
  async function complete(id: string) {
    fade(id);
    try { await invoke("complete", { id }); } catch { }
    setTimeout(() => { load(); loadCompleted(); }, 300);
  }

  // ── Snooze ────────────────────────────────────────────────────────────────
  async function snooze(id: string, preset: SnoozePreset) {
    setSnoozeFor(null);
    fade(id);
    try { await invoke("snooze", { id, preset }); } catch { }
    setTimeout(() => { load(); loadCompleted(); }, 300);
  }

  // ── Dissolve animation helper ─────────────────────────────────────────────
  function fade(id: string) {
    setDissolving(prev => new Set([...prev, id]));
  }

  // ── Open capture ──────────────────────────────────────────────────────────
  function openCapture() {
    setRaw("");
    setOverlay(true);
    setTimeout(() => {
      (document.getElementById("cap") as HTMLInputElement | null)?.focus();
    }, 50);
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    // Request OS notification permission up front. Once granted (Windows 11
    // remembers per-AUMID forever), the Rust worker's `.notification()...show()`
    // calls become real Windows toasts in Action Center.
    await ensureNotificationPermission();

    await load();
    await loadCompleted();

    // Tauri events: when a reminder fires in the Rust worker, the OS toast is
    // dispatched there. The JS side only refreshes the visible lists — it does
    // NOT render an in-program toast. The OS is the source of truth for alerts.
    const unlisten1 = await listen<{ title: string }>("reminder:fired", () => {
      load();
      loadCompleted();
    });
    const unlisten2 = await listen("reminder:snoozed_quiet", () => {
      load();
      loadCompleted();
    });

    // Refresh relative timestamps every 30s
    const tick = setInterval(() => {
      load();
      loadCompleted();
    }, 30_000);

    // Keyboard
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOverlay(false); setSnoozeFor(null); return; }
      if (!overlay() && (e.key === "/" || (e.ctrlKey && e.code === "Space"))) {
        e.preventDefault();
        openCapture();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", () => setSnoozeFor(null));

    onCleanup(() => {
      unlisten1(); unlisten2();
      clearInterval(tick);
      window.removeEventListener("keydown", onKey);
    });
  });

  // ── Sub-components ────────────────────────────────────────────────────────

  const Card = (p: { r: ReminderView }) => {
    const { label, kind } = relativeTime(p.r.fire_at);
    const dissolve = () => dissolving().has(p.r.id);
    const cardClass = () =>
      `card${kind === "urgent" ? " urgent" : ""}${kind === "overdue" ? " overdue" : ""}${dissolve() ? " dissolving" : ""}`;

    return (
      <div class={cardClass()}>
        <div class="card-content">
          <div class="card-title">{p.r.title}</div>
          <div class="card-meta">
            <span class="card-fire-dot" />
            <span class={`card-time ${kind}`}>{label}</span>
          </div>
        </div>
        <div class="card-actions">
          <div class="snooze-wrap" onClick={e => e.stopPropagation()}>
            <button
              class="act act-snooze"
              onClick={() => setSnoozeFor(snoozeFor() === p.r.id ? null : p.r.id)}
            >Later</button>
            <Show when={snoozeFor() === p.r.id}>
              <div class="snooze-menu">
                {([["1h", "In 1 hour", "1"], ["tonight", "Tonight", "T"], ["tomorrow", "Tomorrow", "2"], ["next_week", "Next week", "W"]] as const).map(([preset, label, k]) => (
                  <button class="snooze-opt" onClick={() => snooze(p.r.id, preset)}>
                    {label}
                    <span class="snooze-opt-key">{k}</span>
                  </button>
                ))}
              </div>
            </Show>
          </div>
          <button class="act act-done" onClick={() => complete(p.r.id)}>Done</button>
        </div>
      </div>
    );
  };

  const CompletedCard = (p: { r: ReminderView }) => {
    return (
      <div class="card completed-card">
        <div class="card-content">
          <div class="card-title completed-title">{p.r.title}</div>
          <div class="card-meta">
            <span class="card-fire-dot completed-dot" />
            <span class="card-time completed-time">{formatCompletedTime(p.r.fire_at)}</span>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div class="app">
      {/* ── Header ── */}
      <header class="header">
        <div class="header-brand">
          <div class="wordmark"><em>Yaad</em><span style="color: var(--text-dim)">.</span></div>
          <div class="byline">remember / remember / remember</div>
        </div>
        <div class="header-right">
          <div class="pulse-dot" />
          <button class="test-notify-btn" onClick={triggerTestNotification}>
            Test Alert
          </button>
          <button class="capture-btn" onClick={openCapture}>
            <span>+</span> Capture
            <span class="kbd">/</span>
          </button>
        </div>
      </header>

      {/* ── Test Alert ── */}
      <Show when={showAlert()}>
        <div class="px-7 pt-4 animate-in fade-in slide-in-from-top-4 duration-300 zoom-in-95 ease-out">
          <Alert>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <AlertTitle>System Notice</AlertTitle>
            <AlertDescription>
              The shadcn-solid components have been successfully installed and configured.
            </AlertDescription>
          </Alert>
        </div>
      </Show>

      {/* ── Tab Switcher ── */}
      <div class="navigation-tabs">
        <button
          class={`nav-tab ${currentTab() === "active" ? "active" : ""}`}
          onClick={() => setCurrentTab("active")}
        >
          Surfacing
          <span class="nav-tab-dot" />
        </button>
        <button
          class={`nav-tab ${currentTab() === "completed" ? "active" : ""}`}
          onClick={() => {
            setCurrentTab("completed");
            loadCompleted();
          }}
        >
          Logged
          <span class="nav-tab-dot" />
        </button>
      </div>

      {/* ── Main ── */}
      <main class="main">
        {/* Active Reminders Tab */}
        <Show when={currentTab() === "active"}>
          {/* Now & Today */}
          <section class="section">
            <div class="section-label">
              <span class="section-label-text">Right now</span>
              <span class="section-label-line" />
              <span class="section-label-count">{nowSection().length}</span>
            </div>
            <div class="card-list">
              <Show when={nowSection().length === 0}>
                <div class="empty">
                  <div class="empty-glyph">∅</div>
                  <div class="empty-title">The moment is clear.</div>
                  <div class="empty-sub">
                    Nothing pressing its weight upon this hour.<br />
                    A rare silence. Note it.
                  </div>
                </div>
              </Show>
              <For each={nowSection()}>{r => <Card r={r} />}</For>
            </div>
          </section>

          {/* Upcoming */}
          <Show when={upcomingSection().length > 0}>
            <section class="section">
              <div class="section-label">
                <span class="section-label-text">Coming</span>
                <span class="section-label-line" />
                <span class="section-label-count">{upcomingSection().length}</span>
              </div>
              <div class="card-list">
                <For each={upcomingSection()}>{r => <Card r={r} />}</For>
              </div>
            </section>
          </Show>
        </Show>

        {/* Completed Reminders Tab */}
        <Show when={currentTab() === "completed"}>
          <section class="section">
            <div class="section-label">
              <span class="section-label-text">Logged thoughts</span>
              <span class="section-label-line" />
              <span class="section-label-count">{completedReminders().length}</span>
            </div>
            <div class="card-list">
              <Show when={completedReminders().length === 0}>
                <div class="empty">
                  <div class="empty-glyph">∅</div>
                  <div class="empty-title">The logbook is clear.</div>
                  <div class="empty-sub">
                    No completed thoughts have been logged yet.<br />
                    Every journey begins with a single completed step.
                  </div>
                </div>
              </Show>
              <For each={completedReminders()}>{r => <CompletedCard r={r} />}</For>
            </div>
          </section>
        </Show>
      </main>

      {/* In-program toasts removed — alerts are dispatched to the OS
          (Windows 11 Action Center / macOS Notification Center / libnotify). */}

      {/* ── Capture Overlay ── */}
      <Show when={overlay()}>
        <div class="overlay" onClick={() => setOverlay(false)}>
          <div class="capture-shell" onClick={e => e.stopPropagation()}>
            <div class="capture-prompt">capture a thought</div>
            <div class="capture-wrap">
              <form onSubmit={submit}>
                <input
                  id="cap"
                  class="capture-input"
                  value={raw()}
                  onInput={e => setRaw(e.currentTarget.value)}
                  placeholder="What must not be forgotten…"
                  autocomplete="off"
                  spellcheck={false}
                  disabled={saving()}
                />
              </form>
            </div>
            <div class="parse-row">
              <Show when={chip()}>
                <span class="parse-chip">
                  <span>⏱</span> {chip()}
                </span>
              </Show>
              <Show when={!chip() && raw().length > 3}>
                <span class="parse-chip-fallback">
                  no time detected — will surface in 1 hour
                </span>
              </Show>
            </div>
            <div class="capture-footer">
              <span class="capture-footer-key">
                <span class="kbd">Enter</span> commit to memory
              </span>
              <span class="capture-footer-key">
                <span class="kbd">Esc</span> release
              </span>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
