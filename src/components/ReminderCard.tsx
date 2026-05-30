import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import type { Reminder } from "@/lib/types";
import { CheckIcon, ClockIcon, RescheduleIcon } from "./icons";
import { formatResolvedAgo, formatRelativeLive } from "@/lib/date";
import { playSfx } from "@/lib/audio";

export interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string) => void;
  onSnoozeRequest: (id: string) => void;
  isShaking?: boolean;
  suppressRise?: boolean;
  snoozeDeparting?: "left" | "right";
  /** True briefly after a SAME-TAB reschedule — the card stays in place and
   *  its time label animates the change instead of sliding away. */
  justRescheduled?: boolean;
}

/**
 * Total length (ms) of the completion sequence. Must stay in lockstep with the
 * `.reminder-card.completing` animations in App.css (card-fade + card-collapse).
 * `props.onToggle()` is called at the end so the card stays mounted for the
 * full ceremony before the hook's optimistic flip removes it.
 */
const COMPLETION_DURATION_MS = 1750;

export function ReminderCard(props: ReminderCardProps) {
  const [isCompleting, setIsCompleting] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  let cardRef: HTMLDivElement | undefined;

  // Live countdown — refresh `now` once a second while there's a fire_at to
  // count toward.
  createEffect(() => {
    if (props.reminder.fireAt && !props.reminder.done) {
      const t = window.setInterval(() => setNow(Date.now()), 1000);
      onCleanup(() => window.clearInterval(t));
    }
  });

  // Capture suppressRise ON MOUNT so it never changes for this specific card.
  const suppressRiseOnMount = props.suppressRise;

  const cardClass = () => {
    const classes = ["reminder-card"];
    if (props.reminder.done) classes.push("done");
    if (isCompleting()) classes.push("completing");
    if (suppressRiseOnMount) classes.push("no-rise");
    if (props.isShaking) classes.push("shaking");
    if (props.snoozeDeparting) classes.push(`snooze-depart-${props.snoozeDeparting}`);
    if (props.justRescheduled) classes.push("rescheduled");
    return classes.join(" ");
  };

  function onActivate() {
    if (props.reminder.done) return;
    if (isCompleting()) return;

    // Pin the natural height so the collapse keyframe animates from this card's
    // actual height to 0, regardless of how tall the (clamped) title is.
    if (cardRef) {
      cardRef.style.setProperty("--natural-height", `${cardRef.offsetHeight}px`);
    }

    playSfx("taskComplete");
    setIsCompleting(true);
    window.setTimeout(
      () => props.onToggle(props.reminder.id),
      COMPLETION_DURATION_MS,
    );
  }

  const showMeta = () =>
    !props.reminder.done &&
    (props.reminder.timeLabel !== null || props.reminder.tag !== null);
  const showResolved = () =>
    props.reminder.done && props.reminder.completedAt !== null;
  const showSnooze = () => !props.reminder.done && !isCompleting();

  return (
    <div
      ref={cardRef}
      class={cardClass()}
      role="button"
      tabIndex={0}
      aria-pressed={props.reminder.done}
      onClick={onActivate}
      onFocus={() => playSfx("focusTask")}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        } else if (e.key === "Escape") {
          e.currentTarget.blur();
        }
      }}
    >
      <div class={`check-wrap${props.reminder.done || isCompleting() ? " checked" : ""}`}>
        <CheckIcon />
      </div>

      <div class="reminder-body">
        <p class="reminder-title">{props.reminder.title}</p>

        <Show when={showMeta()}>
          <div class="reminder-meta">
            <Show when={props.reminder.fireAt || props.reminder.timeLabel}>
              {/* On a same-tab reschedule the parent adds `.rescheduled`, and
                  `.reminder-card.rescheduled .meta-time` plays the swap-in
                  animation while this value updates reactively. */}
              <span class="meta-time">
                <ClockIcon />
                {props.reminder.fireAt
                  ? formatRelativeLive(props.reminder.fireAt, now())
                  : props.reminder.timeLabel}
              </span>
            </Show>

            <Show when={props.reminder.tag} keyed>
              {tag => <span class={`meta-tag tag-${tag.tone}`}>{tag.label}</span>}
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

      <Show when={showSnooze()}>
        <button
          type="button"
          class="reschedule-btn"
          aria-label="Reschedule"
          onClick={e => {
            e.stopPropagation();
            props.onSnoozeRequest?.(props.reminder.id);
          }}
        >
          <RescheduleIcon />
        </button>
      </Show>
    </div>
  );
}
