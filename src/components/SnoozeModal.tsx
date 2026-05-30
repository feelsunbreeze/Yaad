import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { ParseToken } from "./ParseToken";
import { describeTime } from "@/lib/date";

export interface SnoozeModalProps {
  isOpen: boolean;
  taskTitle: string;
  /** The reminder's current fire time, so the ± chips can adjust relative to
   *  it. Null falls back to "now". */
  currentFireAt: number | null;
  onClose: () => void;
  /** Reschedule to an explicit absolute time + a human label. The modal owns
   *  all time math (presets, ± deltas, parsed NL) so the backend just stores
   *  what it's given. */
  onReschedule: (fireAtMs: number, humanTime: string) => void;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative adjustments, applied to the reminder's current fire time.
 *  Subtract = sooner (cool/red), add = later (calm/green). */
const DELTAS: { label: string; ms: number; dir: "minus" | "plus" }[] = [
  { label: "−1d",  ms: -DAY,      dir: "minus" },
  { label: "−1h",  ms: -HOUR,     dir: "minus" },
  { label: "−15m", ms: -15 * MIN, dir: "minus" },
  { label: "+15m", ms: 15 * MIN,  dir: "plus" },
  { label: "+1h",  ms: HOUR,      dir: "plus" },
  { label: "+1d",  ms: DAY,       dir: "plus" },
];

/** Named jump targets. Computed on the frontend so we can pre-decide the
 *  resulting tab for the reschedule animation. */
function presetTime(kind: "tonight" | "tomorrow" | "next_week"): number {
  const d = new Date();
  if (kind === "tonight") {
    d.setHours(21, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  // next_week
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function SnoozeModal(props: SnoozeModalProps) {
  const [value, setValue] = createSignal("");
  const [parsedText, setParsedText] = createSignal("");
  const [lastParsed, setLastParsed] = createSignal<{ ms: number; human: string } | null>(null);
  // Cached so the content stays stable DURING the close animation — the title
  // prop nulls out the moment the parent clears its selection, and letting the
  // title row vanish mid-exit is what made the close look like a "collapse".
  const [displayTitle, setDisplayTitle] = createSignal(props.taskTitle);

  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: number | undefined;

  // On OPEN: reset to a clean slate + cache the title + focus. We deliberately
  // do NOT reset on close, so nothing reflows while the modal animates out.
  createEffect(() => {
    if (props.isOpen) {
      setValue("");
      setParsedText("");
      setLastParsed(null);
      if (props.taskTitle) setDisplayTitle(props.taskTitle);
      setTimeout(() => inputRef?.focus(), 60);
    }
  });

  // Debounced natural-language parse for the live preview.
  createEffect(() => {
    const text = value();
    clearTimeout(debounceTimer);

    if (text.trim().length < 3) {
      setParsedText("");
      setLastParsed(null);
      return;
    }

    debounceTimer = window.setTimeout(async () => {
      try {
        const res = await invoke<{ fire_at_ms: number; human_time: string }>("parse_time", {
          raw: text,
        });
        setParsedText(res.human_time);
        setLastParsed({ ms: res.fire_at_ms, human: res.human_time });
      } catch (e) {
        console.error("Parse error", e);
      }
    }, 220);
  });

  onCleanup(() => clearTimeout(debounceTimer));

  function commit(fireAtMs: number, human: string) {
    props.onReschedule(Math.round(fireAtMs), human);
  }

  async function handleSave() {
    const v = value().trim();
    if (!v) return;
    const cached = lastParsed();
    if (cached) {
      commit(cached.ms, cached.human);
      return;
    }
    // No debounced result yet — parse on demand.
    try {
      const res = await invoke<{ fire_at_ms: number; human_time: string }>("parse_time", { raw: v });
      commit(res.fire_at_ms, res.human_time);
    } catch (e) {
      console.error("Parse error", e);
    }
  }

  function applyDelta(deltaMs: number) {
    const base = props.currentFireAt ?? Date.now();
    let next = base + deltaMs;
    // Never reschedule into the past — clamp to ~a minute out so a subtraction
    // below "now" just means "surface very soon" rather than instantly/again.
    const floor = Date.now() + MIN;
    if (next < floor) next = floor;
    commit(next, describeTime(next));
  }

  function applyPreset(kind: "tonight" | "tomorrow" | "next_week") {
    const ms = presetTime(kind);
    commit(ms, describeTime(ms));
  }

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} ariaLabel="Reschedule Task">
      <header class="modal-header">
        <h2>Reschedule</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>

      <Show when={displayTitle()}>
        <p class="snooze-task-title">"{displayTitle()}"</p>
      </Show>

      <div class="snooze-input-wrap">
        <input
          ref={inputRef}
          type="text"
          class="snooze-input"
          placeholder="5pm, tomorrow morning, next friday…"
          autocomplete="off"
          spellcheck={false}
          value={value()}
          onInput={e => setValue(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        <button
          class="snooze-save-btn"
          type="button"
          aria-label="Reschedule"
          onClick={() => void handleSave()}
          disabled={!value().trim()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      </div>

      <Show when={parsedText()}>
        <div class="snooze-preview">
          <span class="parse-prefix">↳ will surface&nbsp;</span>
          <ParseToken value={parsedText()} />
        </div>
      </Show>

      <div class="reschedule-adjust">
        <label class="reschedule-label">Nudge from current</label>
        <div class="delta-row">
          <For each={DELTAS}>
            {d => (
              <button
                type="button"
                class={`delta-chip ${d.dir}`}
                onClick={() => applyDelta(d.ms)}
              >
                {d.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="reschedule-adjust" style="margin-bottom: 0;">
        <label class="reschedule-label">Jump to</label>
        <div class="snooze-presets-grid">
          <button type="button" class="preset-pill-btn" onClick={() => applyPreset("tonight")}>
            <span>Tonight</span>
            <span class="preset-desc">9:00 PM</span>
          </button>
          <button type="button" class="preset-pill-btn" onClick={() => applyPreset("tomorrow")}>
            <span>Tomorrow</span>
            <span class="preset-desc">9:00 AM</span>
          </button>
          <button type="button" class="preset-pill-btn" onClick={() => applyPreset("next_week")}>
            <span>Next Week</span>
            <span class="preset-desc">7 days</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
