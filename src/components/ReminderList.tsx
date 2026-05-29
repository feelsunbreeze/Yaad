import { For, Show, createSignal, onMount, onCleanup, createMemo } from "solid-js";
import type { Reminder, Tab } from "@/lib/types";
import { ReminderCard } from "./ReminderCard";
import { SmileIcon, SortTimeIcon } from "./icons";

const SECTION_LABEL: Record<Tab, string> = {
  today: "to do",
  upcoming: "coming up",
  done: "completed",
};

const EMPTY_TEXT: Record<Tab, string> = {
  today: "nothing here, breathe easy.",
  upcoming: "no future plans, just now.",
  done: "nothing checked off, yet.",
};

export interface ReminderListProps {
  /** Reminders for the active tab — already filtered upstream by the hook. */
  reminders: Reminder[];
  /** Active tab — picks the section label + empty-state copy. */
  tab: Tab;
  /** Forwarded down to each card. */
  onToggle: (id: string) => void;
  /** Callback to request a snooze modal for a reminder card. */
  onSnoozeRequest: (id: string) => void;
}

/**
 * The scrollable middle panel. When the active tab has nothing, the
 * empty-state (smiley + italic line) takes the whole panel. Otherwise we
 * render the section label and a `<For>` over the cards.
 *
 * Scroll shadow: a sticky bottom gradient fades in when there's more content
 * below, disappears when scrolled to the bottom.
 *
 * Scrollbar: uses `overflow: overlay` (Chromium) so the thumb is drawn ON TOP
 * of content with zero width reservation — no layout shift ever. The thumb is
 * invisible until scrolling begins (.scrolling class), then fades out 1.2 s
 * after the last scroll event via an idle timer.
 */
export function ReminderList(props: ReminderListProps) {
  let listRef: HTMLElement | undefined;
  let listContentRef: HTMLDivElement | undefined;
  const [showShadow, setShowShadow] = createSignal(false);
  const [isScrolling, setIsScrolling] = createSignal(false);

  // ── Sort toggle ──────────────────────────────────────────────
  // true = soonest first (ascending fireAt), false = latest first
  const [sortAsc, setSortAsc] = createSignal(true);

  const sorted = createMemo(() => {
    const items = [...props.reminders];
    // Only sort time-based tabs; "done" keeps its natural order
    if (props.tab === "done") return items;

    return items.sort((a, b) => {
      const aTime = a.fireAt ?? Infinity;
      const bTime = b.fireAt ?? Infinity;
      return sortAsc() ? aTime - bTime : bTime - aTime;
    });
  });

  const [isSorting, setIsSorting] = createSignal(false);

  function toggleSort() {
    if (isSorting()) return;

    // 1. Trigger compression
    setIsSorting(true);

    // 2. Wait for the CSS compress transition to finish (350ms)
    setTimeout(() => {
      // 3. Swap order while everything is hidden/compressed
      setSortAsc(v => !v);

      // 4. Hold the compressed state for an elegant beat (120ms) before decompressing
      setTimeout(() => {
        setIsSorting(false);
      }, 150);
    }, 500);
  }

  onMount(() => {
    if (!listRef) return;
    const el = listRef;

    // ── Scroll shadow ──────────────────────────────────────────
    function check() {
      // Require at least 24px of scrollable area to consider it overflowing,
      // avoiding sticky scroll shadow artifacts on near-perfect fits (e.g. 2 tasks).
      const overflow = el.scrollHeight > el.clientHeight + 24;
      const notAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 24;
      setShowShadow(overflow && notAtBottom);
    }
    check();

    // ── Scrollbar fade ─────────────────────────────────────────
    // Show the thumb the moment scrolling starts; hide 1.2 s after last event.
    let idleTimer: number | undefined;
    function onScroll() {
      check();
      setIsScrolling(true);
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setIsScrolling(false), 1200);
    }

    el.addEventListener("scroll", onScroll, { passive: true });

    // Re-check whenever the list resizes (window resize, height drag, etc).
    const ro = new ResizeObserver(check);
    ro.observe(el);

    // Re-check whenever visible children change (card added/completed/tab switch).
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });

    onCleanup(() => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(idleTimer);
      ro.disconnect();
      mo.disconnect();
    });
  });

  const listClass = () => {
    let c = "list-wrap";
    if (showShadow()) c += " show-scroll-shadow";
    if (isScrolling()) c += " scrolling";
    return c;
  };

  const isEmpty = () => props.reminders.length === 0;

  return (
    <main ref={listRef} class={listClass()}>
      <div class="list-transition-grid">
        <div class="list-content" ref={listContentRef} classList={{ "fade-out": isEmpty(), "sorting-active": isSorting() }}>
          <div class="section-header">
            <p class="section-label">{SECTION_LABEL[props.tab]}</p>
            <Show when={props.tab !== "done"}>
              <button
                type="button"
                class="sort-btn"
                classList={{ flipped: !sortAsc() }}
                aria-label={sortAsc() ? "Sorted soonest first" : "Sorted latest first"}
                data-tooltip={sortAsc() ? "Soonest first" : "Latest first"}
                onClick={toggleSort}
              >
                <SortTimeIcon />
              </button>
            </Show>
          </div>
          <For each={sorted()}>
            {r => (
              <ReminderCard
                reminder={r}
                onToggle={props.onToggle}
                onSnoozeRequest={props.onSnoozeRequest}
              />
            )}
          </For>
          <div class="list-bottom-spacer" style={{ height: "1rem", "flex-shrink": 0 }} />
        </div>

        <Show when={isEmpty()}>
          <div class="empty-state">
            <div class="empty-icon">
              <SmileIcon />
            </div>
            <p class="empty-text">{EMPTY_TEXT[props.tab]}</p>
          </div>
        </Show>
      </div>
    </main>
  );
}

