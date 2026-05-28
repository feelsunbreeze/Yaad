import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
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
 *
 * Adds a fade-in scroll shadow at the bottom edge when the list overflows
 * and the user isn't yet at the bottom. The shadow disappears when there's
 * nothing more to scroll to — a quiet visual affordance that "there's more
 * below" without ever being shouty.
 */
export function ReminderList(props: ReminderListProps) {
  let listRef: HTMLElement | undefined;
  const [showShadow, setShowShadow] = createSignal(false);

  onMount(() => {
    if (!listRef) return;
    const el = listRef;

    function check() {
      const overflow = el.scrollHeight > el.clientHeight + 4;
      const notAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
      setShowShadow(overflow && notAtBottom);
    }
    check();
    el.addEventListener("scroll", check, { passive: true });

    // Re-check whenever the list or its parent resizes (e.g. window resize,
    // address bar collapse on mobile, etc).
    const ro = new ResizeObserver(check);
    ro.observe(el);

    // Re-check whenever the visible children change (new reminder added,
    // card collapses on completion, tab switch). Cheaper than firing on
    // every list prop change at the parent level.
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });

    onCleanup(() => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
      mo.disconnect();
    });
  });

  return (
    <main
      ref={listRef}
      class={`list-wrap${showShadow() ? " show-scroll-shadow" : ""}`}
    >
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
