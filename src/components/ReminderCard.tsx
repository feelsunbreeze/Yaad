import { Show } from "solid-js";
import type { Reminder } from "@/lib/types";
import { CheckIcon, ClockIcon } from "./icons";

export interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string) => void;
}

/**
 * A single reminder row: check circle on the left, title + meta in the middle,
 * urgent dot on the right.
 *
 * Click anywhere on the card to toggle done — same affordance as the
 * prototype, where the entire card has `cursor: pointer`. Keyboard users get
 * Enter/Space via the tabIndex + onKeyDown pair.
 */
export function ReminderCard(props: ReminderCardProps) {
  const cardClass = () => {
    const classes = ["reminder-card"];
    if (props.reminder.done) classes.push("done");
    // urgent treatment is suppressed once the reminder is done — keeps the
    // red spine from fighting the dimmed/strikethrough state visually.
    if (props.reminder.urgent && !props.reminder.done) classes.push("urgent");
    return classes.join(" ");
  };

  const onActivate = () => props.onToggle(props.reminder.id);

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

        <Show when={props.reminder.timeLabel || props.reminder.tag}>
          <div class="reminder-meta">
            <Show when={props.reminder.timeLabel}>
              <span class="meta-time">
                <ClockIcon />
                {props.reminder.timeLabel}
              </span>
            </Show>

            <Show when={props.reminder.tag} keyed>
              {tag => (
                <span class={`meta-tag tag-${tag.tone}`}>{tag.label}</span>
              )}
            </Show>
          </div>
        </Show>
      </div>

      <Show when={props.reminder.urgent && !props.reminder.done}>
        <div class="reminder-right">
          <span class="dot dot-red" />
        </div>
      </Show>
    </div>
  );
}
