import { For, Show } from "solid-js";
import type { Reminder, Tab, SnoozePreset } from "@/lib/types";
import { ReminderCard } from "./ReminderCard";
import { SmileIcon } from "./icons";

const SECTION_LABEL: Record<Tab, string> = {
  today:    "to do",
  upcoming: "coming up",
  done:     "completed",
};

const EMPTY_TEXT: Record<Tab, string> = {
  today:    "nothing here, breathe easy.",
  upcoming: "no future plans, just now.",
  done:     "nothing checked off, yet.",
};

export interface ReminderListProps {
  /** Reminders for the active tab — already filtered upstream by the hook. */
  reminders: Reminder[];
  /** Active tab — picks the section label + empty-state copy. */
  tab: Tab;
  /** Forwarded down to each card. */
  onToggle: (id: string) => void;
  /** Forwarded to each card's snooze popover. */
  onSnooze: (id: string, preset: SnoozePreset) => void;
}

/**
 * The scrollable middle panel. When the active tab has nothing, the
 * empty-state (smiley + italic line) takes the whole panel. Otherwise we
 * render the section label and a `<For>` over the cards.
 */
export function ReminderList(props: ReminderListProps) {
  return (
    <main class="list-wrap">
      <Show
        when={props.reminders.length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-icon">
              <SmileIcon />
            </div>
            <p class="empty-text">{EMPTY_TEXT[props.tab]}</p>
          </div>
        }
      >
        <p class="section-label">{SECTION_LABEL[props.tab]}</p>
        <For each={props.reminders}>
          {r => (
            <ReminderCard
              reminder={r}
              onToggle={props.onToggle}
              onSnooze={props.onSnooze}
            />
          )}
        </For>
      </Show>
    </main>
  );
}
