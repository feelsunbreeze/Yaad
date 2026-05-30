import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { Transition } from "solid-transition-group";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { ParseToken } from "./ParseToken";
import { describeTime } from "@/lib/date";

export interface SnoozeModalProps {
  isOpen: boolean;
  taskTitle: string;
  /** The reminder's current fire time, so ± nudges and relative input adjust
   *  relative to it. Null falls back to "now". */
  currentFireAt: number | null;
  onClose: () => void;
  /** Reschedule to an explicit absolute time + a human label. The modal owns
   *  all time math so the backend just stores what it's given. */
  onReschedule: (fireAtMs: number, humanTime: string) => void;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative adjustments applied to the current fire time. Three sooner, three
 *  later — laid out as a symmetric 6-up grid. */
const DELTAS: { label: string; ms: number; dir: "minus" | "plus" }[] = [
  { label: "−1d",  ms: -DAY,      dir: "minus" },
  { label: "−1h",  ms: -HOUR,     dir: "minus" },
  { label: "−15m", ms: -15 * MIN, dir: "minus" },
  { label: "+15m", ms: 15 * MIN,  dir: "plus" },
  { label: "+1h",  ms: HOUR,      dir: "plus" },
  { label: "+1d",  ms: DAY,       dir: "plus" },
];

type Jump = "tonight" | "tomorrow" | "next_week" | "next_month";

const JUMPS: { id: Jump; label: string; sub: string }[] = [
  { id: "tonight",    label: "Tonight",    sub: "9:00 PM" },
  { id: "tomorrow",   label: "Tomorrow",   sub: "9:00 AM" },
  { id: "next_week",  label: "Next Week",  sub: "7 days" },
  { id: "next_month", label: "Next Month", sub: "~30 days" },
];

function jumpTime(kind: Jump): number {
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
  if (kind === "next_week") {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  // next_month
  d.setMonth(d.getMonth() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** Recognise a leading-sign relative expression, e.g. "+2h", "-30m",
 *  "+ 23 mins", "-10 hours". Interpreted as a shift of the CURRENT fire
 *  time → "23 mins later" / "10 hours earlier". Returns null if it doesn't
 *  match so we fall through to the backend natural-language parser. */
// Accepts an ASCII "-", a unicode minus "−" (U+2212, what the chips show), or "+".
const REL_RE = /^([+\-−])\s*(\d+)\s*(mins?|minutes?|m|hrs?|hours?|h|days?|d|weeks?|w)$/i;
function parseRelative(text: string, baseMs: number): { ms: number; preview: string; human: string } | null {
  const m = text.trim().match(REL_RE);
  if (!m) return null;
  const sign = (m[1] === "-" || m[1] === "−") ? -1 : 1;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[3].toLowerCase();

  let stepMs: number;
  let word: string;
  if (unit.startsWith("h")) { stepMs = HOUR; word = n === 1 ? "hour" : "hours"; }
  else if (unit.startsWith("d")) { stepMs = DAY; word = n === 1 ? "day" : "days"; }
  else if (unit.startsWith("w")) { stepMs = 7 * DAY; word = n === 1 ? "week" : "weeks"; }
  else { stepMs = MIN; word = n === 1 ? "min" : "mins"; }

  let next = baseMs + sign * n * stepMs;
  const floor = Date.now() + MIN;
  if (next < floor) next = floor;

  return {
    ms: next,
    preview: `${n} ${word} ${sign < 0 ? "earlier" : "later"}`,
    human: describeTime(next),
  };
}

export function SnoozeModal(props: SnoozeModalProps) {
  const [value, setValue] = createSignal("");
  const [parsedText, setParsedText] = createSignal("");
  const [lastParsed, setLastParsed] = createSignal<{ ms: number; human: string } | null>(null);
  // Cached so the content stays stable DURING the close animation.
  const [displayTitle, setDisplayTitle] = createSignal(props.taskTitle);

  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: number | undefined;

  createEffect(() => {
    if (props.isOpen) {
      setValue("");
      setParsedText("");
      setLastParsed(null);
      if (props.taskTitle) setDisplayTitle(props.taskTitle);
      setTimeout(() => inputRef?.focus(), 60);
    }
  });

  // Debounced parse for the live preview — relative shift first, else backend NL.
  createEffect(() => {
    const text = value();
    clearTimeout(debounceTimer);

    if (text.trim().length < 2) {
      setParsedText("");
      setLastParsed(null);
      return;
    }

    const rel = parseRelative(text, props.currentFireAt ?? Date.now());
    if (rel) {
      setParsedText(rel.preview);
      setLastParsed({ ms: rel.ms, human: rel.human });
      return;
    }

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
    }, 200);
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
    const rel = parseRelative(v, props.currentFireAt ?? Date.now());
    if (rel) {
      commit(rel.ms, rel.human);
      return;
    }
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
    const floor = Date.now() + MIN;
    if (next < floor) next = floor;
    commit(next, describeTime(next));
  }

  function applyJump(kind: Jump) {
    const ms = jumpTime(kind);
    commit(ms, describeTime(ms));
  }

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} ariaLabel="Reschedule Task">
      <header class="modal-header reschedule-header">
        <h2>Reschedule</h2>
        <button type="button" class="modal-close" aria-label="Close" onClick={props.onClose}>
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
          placeholder="5pm, +2h, −30m, next friday…"
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      </div>

      <Transition name="preview">
        <Show when={parsedText()}>
          <div class="snooze-preview">
            <span class="parse-prefix">↳ will surface&nbsp;</span>
            <ParseToken value={parsedText()} />
          </div>
        </Show>
      </Transition>

      <div class="reschedule-adjust">
        <label class="reschedule-label">Nudge</label>
        <div class="delta-row">
          <For each={DELTAS}>
            {d => (
              <button type="button" class={`delta-chip ${d.dir}`} onClick={() => applyDelta(d.ms)}>
                {d.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="reschedule-adjust reschedule-adjust-last">
        <label class="reschedule-label">Jump to</label>
        <div class="snooze-presets-grid">
          <For each={JUMPS}>
            {j => (
              <button type="button" class="preset-pill-btn" onClick={() => applyJump(j.id)}>
                <span>{j.label}</span>
                <span class="preset-desc">{j.sub}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Modal>
  );
}
