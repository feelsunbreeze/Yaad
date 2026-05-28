import { Show, For, createSignal, createEffect, onCleanup } from "solid-js";
import type { Reminder, SnoozePreset } from "@/lib/types";
import { CheckIcon, ClockIcon } from "./icons";
import { formatResolvedAgo, formatRelativeLive } from "@/lib/date";

export interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string) => void;
  onSnooze: (id: string, preset: SnoozePreset) => void;
}

/** Snooze popover options. Order matches the Rust `snooze` command's
 *  accepted preset strings exactly. */
const SNOOZE_OPTIONS: { id: SnoozePreset; label: string }[] = [
  { id: "1h",        label: "in 1 hour"  },
  { id: "tonight",   label: "tonight"    },
  { id: "tomorrow",  label: "tomorrow"   },
  { id: "next_week", label: "next week"  },
];

/**
 * A single reminder row: check circle on the left, title + meta in the
 * middle, snooze button + urgent dot on the right.
 *
 * Click anywhere on the card (outside the snooze popover) to toggle done.
 * Keyboard: Enter/Space activates done. The snooze popover is opened with
 * its own button and dismisses on outside click or Escape.
 */
export function ReminderCard(props: ReminderCardProps) {
  const [snoozeOpen, setSnoozeOpen] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    if (props.reminder.fireAt && !props.reminder.done) {
      const t = window.setInterval(() => setNow(Date.now()), 1000);
      onCleanup(() => window.clearInterval(t));
    }
  });

  const cardClass = () => {
    const classes = ["reminder-card"];
    if (props.reminder.done) classes.push("done");
    // urgent treatment is suppressed once the reminder is done — keeps the
    // red spine from fighting the dimmed/strikethrough state visually.
    if (props.reminder.urgent && !props.reminder.done) classes.push("urgent");
    if (snoozeOpen()) classes.push("snooze-open");
    return classes.join(" ");
  };

  const onActivate = () => props.onToggle(props.reminder.id);

  // Outside-click + Escape close the snooze popover. Effect re-subscribes
  // whenever snoozeOpen flips so we don't leak listeners.
  createEffect(() => {
    if (!snoozeOpen()) return;
    const closeOnClick = () => setSnoozeOpen(false);
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSnoozeOpen(false);
    };
    // setTimeout so the click that opened us doesn't immediately close.
    const t = window.setTimeout(() => {
      window.addEventListener("click", closeOnClick);
    }, 0);
    window.addEventListener("keydown", closeOnEsc);
    onCleanup(() => {
      window.clearTimeout(t);
      window.removeEventListener("click", closeOnClick);
      window.removeEventListener("keydown", closeOnEsc);
    });
  });

  function pickSnooze(preset: SnoozePreset, e: MouseEvent) {
    e.stopPropagation();
    setSnoozeOpen(false);
    props.onSnooze(props.reminder.id, preset);
  }

  // The card meta row is hidden entirely when this reminder is done — the
  // strikethrough title + reduced opacity carry the visual weight and
  // showing a stale time label clutters the completed tab.
  const showMeta = () =>
    !props.reminder.done && (props.reminder.timeLabel !== null || props.reminder.tag !== null);
  const showResolved = () => props.reminder.done && props.reminder.completedAt !== null;
  const showSnooze   = () => !props.reminder.done;

  return (
    <div
      class={cardClass()}
      role="button"
      tabIndex={0}
      aria-pressed={props.reminder.done}
      onClick={onActivate}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <div class={`check-wrap${props.reminder.done ? " checked" : ""}`}>
        <CheckIcon />
      </div>

      <div class="reminder-body">
        <p class="reminder-title">{props.reminder.title}</p>

        <Show when={showMeta()}>
          <div class="reminder-meta">
            <Show when={props.reminder.fireAt || props.reminder.timeLabel}>
              <span class="meta-time">
                <ClockIcon />
                {props.reminder.fireAt ? formatRelativeLive(props.reminder.fireAt, now()) : props.reminder.timeLabel}
              </span>
            </Show>

            <Show when={props.reminder.tag} keyed>
              {tag => (
                <span class={`meta-tag tag-${tag.tone}`}>{tag.label}</span>
              )}
            </Show>
          </div>
        </Show>

        <Show when={showResolved()}>
          <div class="reminder-meta">
            <span class="meta-time completed-time">
              {formatResolvedAgo(props.reminder.completedAt)}
            </span>
          </div>
        </Show>
      </div>

      <div class="reminder-right">
        <Show when={props.reminder.urgent && !props.reminder.done}>
          <span class="dot dot-red" />
        </Show>

        <Show when={showSnooze()}>
          <div class="snooze-wrap" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              class="action-btn"
              aria-haspopup="menu"
              aria-expanded={snoozeOpen()}
              onClick={e => {
                e.stopPropagation();
                setSnoozeOpen(prev => !prev);
              }}
            >
              later
            </button>

            <Show when={snoozeOpen()}>
              <div class="snooze-popover" role="menu">
                <For each={SNOOZE_OPTIONS}>
                  {opt => (
                    <button
                      type="button"
                      class="snooze-option"
                      role="menuitem"
                      onClick={e => pickSnooze(opt.id, e)}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
