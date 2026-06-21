import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import type { Reminder } from "@/lib/types";
import { CheckIcon, ClockIcon, RescheduleIcon } from "./icons";
import { formatResolvedAgo, formatRelativeLive, formatExactDate } from "@/lib/date";
import { playSfx } from "@/lib/audio";

export interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string) => void;
  onSnoozeRequest: (id: string) => void;
  isShaking?: boolean;
  suppressRise?: boolean;
  snoozeDeparting?: "left" | "right";
  inlineReschedule?: { fireAt: number; timeLabel: string };
}

const COMPLETION_DURATION_MS = 1750;

export function ReminderCard(props: ReminderCardProps) {
  const [isCompleting, setIsCompleting] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  let cardRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.reminder.fireAt && !props.reminder.done) {
      const t = window.setInterval(() => setNow(Date.now()), 1000);
      onCleanup(() => window.clearInterval(t));
    }
  });

  const suppressRiseOnMount = props.suppressRise;

  const cardClass = () => {
    const classes = ["reminder-card"];
    if (props.reminder.done) classes.push("done");
    if (isCompleting()) classes.push("completing");
    if (suppressRiseOnMount) classes.push("no-rise");
    if (props.isShaking) classes.push("shaking");
    if (props.snoozeDeparting) classes.push(`snooze-depart-${props.snoozeDeparting}`);
    return classes.join(" ");
  };

  const [displayedTime, setDisplayedTime] = createSignal<{ fireAt: number | null; timeLabel: string | null }>({
    fireAt: props.reminder.fireAt,
    timeLabel: props.reminder.timeLabel,
  });
  const [timeSwapping, setTimeSwapping] = createSignal(false);

  createEffect(() => {
    const override = props.inlineReschedule;
    if (!override) return;

    const t = window.setTimeout(() => {
      setTimeSwapping(true);
      window.setTimeout(() => {
        setDisplayedTime({ fireAt: override.fireAt, timeLabel: override.timeLabel });
      }, 200);
      window.setTimeout(() => setTimeSwapping(false), 450);
    }, 700);

    onCleanup(() => window.clearTimeout(t));
  });

  createEffect(() => {
    if (!props.inlineReschedule) {
      setDisplayedTime({ fireAt: props.reminder.fireAt, timeLabel: props.reminder.timeLabel });
    }
  });

  const shownFireAt = () => displayedTime().fireAt;
  const shownTimeLabel = () => displayedTime().timeLabel;

  function onActivate() {
    if (props.reminder.done) return;
    if (isCompleting()) return;

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

  let ignoreFocus = false;

  return (
    <div
      ref={cardRef}
      class={cardClass()}
      role="button"
      tabIndex={0}
      aria-pressed={props.reminder.done}
      onClick={onActivate}
      onPointerDown={() => { ignoreFocus = true; }}
      onFocus={() => {
        if (!ignoreFocus) playSfx("focusTask");
        ignoreFocus = false;
      }}
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
            <Show when={shownFireAt() || shownTimeLabel()}>
              <span
                class={`meta-time${timeSwapping() ? " time-swapping" : ""}`}
                data-tooltip={shownFireAt() ? formatExactDate(shownFireAt()!) : undefined}
              >
                <ClockIcon />
                {shownFireAt()
                  ? formatRelativeLive(shownFireAt()!, now())
                  : shownTimeLabel()}
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
