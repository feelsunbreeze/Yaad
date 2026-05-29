import { Show, For, createSignal, createEffect, onCleanup } from "solid-js";
import type { Reminder } from "@/lib/types";
import { CheckIcon, ClockIcon } from "./icons";
import { formatResolvedAgo, formatRelativeLive } from "@/lib/date";

export interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string) => void;
  onSnoozeRequest: (id: string) => void;
}

/**
 * Total length (ms) of the completion sequence, including the isolated
 * layout-collapse tail. Must stay in lockstep with the two
 * `.reminder-card.completing` animations in App.css:
 *
 *   card-fade     (1250ms) — visual ceremony, NO height change
 *   card-collapse ( 250ms)  — layout collapse, siblings slide up
 *
 *   Total: 1500ms
 *
 * `props.onToggle()` is called at the end of this window so the card stays
 * mounted for the full ceremony before the hook's optimistic flip removes
 * it from the visible list.
 */
const COMPLETION_DURATION_MS = 1750;

/**
 * A single reminder row. The visual is unchanged from the prototype —
 * check circle, body, snooze affordance — but the toggle interaction is a
 * sequenced ceremony rather than a snap:
 *
 *   1. Check strokes in from the left tip, sweeps through the apex,
 *      arrives at the right tail (~500ms). The check circle blooms in an
 *      over-shoot scale, like ink setting.
 *   2. Card background washes from cream to a muted-green success tone,
 *      border + soft green glow growing in. (~300ms)
 *   3. A brief hold while the eye registers the completion. (~300ms)
 *   4. Card opacity fades to 0, still at full height. (~200ms)
 *   5. CSS `card-collapse` animation kicks in: max-height + padding +
 *      margin + border-width all → 0 over 250ms. Siblings slide up smoothly
 *      to fill the gap. THIS is the only stage where neighbours move.
 *
 * Splitting the visual fade (steps 1-4) from the layout collapse (step 5)
 * is what makes the multi-task case feel deliberate — other cards no
 * longer flicker or shift while the ceremony is in flight. They wait
 * their turn, then slide up as a clean follow-through after the
 * completing card is fully invisible.
 */
export function ReminderCard(props: ReminderCardProps) {
  const [isCompleting, setIsCompleting] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  let cardRef: HTMLDivElement | undefined;

  // Live countdown — refresh `now` once a second while there's a fire_at to
  // count toward. The interval clears itself when the reminder is marked
  // done (no more countdown to render).
  createEffect(() => {
    if (props.reminder.fireAt && !props.reminder.done) {
      const t = window.setInterval(() => setNow(Date.now()), 1000);
      onCleanup(() => window.clearInterval(t));
    }
  });

  const cardClass = () => {
    const classes = ["reminder-card"];
    if (props.reminder.done) classes.push("done");
    if (isCompleting()) classes.push("completing");
    return classes.join(" ");
  };

  function onActivate() {
    // Don't toggle when:
    //   - already done (backend has no reopen)
    //   - animation already in flight (double-click guard)
    if (props.reminder.done) return;
    if (isCompleting()) return;

    // Pin the natural height as a CSS variable so the collapse keyframe
    // animates from "this card's actual height" to 0, rather than from a
    // magic-number max-height that may clip long titles.
    if (cardRef) {
      cardRef.style.setProperty("--natural-height", `${cardRef.offsetHeight}px`);
    }

    setIsCompleting(true);
    const t = window.setTimeout(
      () => props.onToggle(props.reminder.id),
      COMPLETION_DURATION_MS,
    );
    onCleanup(() => window.clearTimeout(t));
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
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
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

      <div class="reminder-right">
        <Show when={showSnooze()}>
          <div class="snooze-wrap" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              class="action-btn"
              onClick={e => {
                e.stopPropagation();
                props.onSnoozeRequest?.(props.reminder.id);
              }}
            >
              later
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
