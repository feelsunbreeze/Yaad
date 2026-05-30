import { For, Show, createSignal, onMount, onCleanup, createMemo, createEffect } from "solid-js";
import type { Reminder, Tab } from "@/lib/types";
import { ReminderCard } from "./ReminderCard";
import { SmileIcon, SortTimeIcon } from "./icons";
import { playSfx } from "@/lib/audio";

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
  /** ID of a newly added task that triggered an auto-switch. */
  shakingTaskId?: string | null;
  /** Callback to load more completed tasks */
  onLoadMore?: () => void;
  /** Active snooze departure animation state */
  snoozeDeparting?: { id: string; direction: "left" | "right" } | null;
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

  // Track if we just switched between today and upcoming
  const [fastSwitch, setFastSwitch] = createSignal(false);
  let prevTab = props.tab;

  createEffect(() => {
    const current = props.tab;
    const isFast = (prevTab === "today" && current === "upcoming") || (prevTab === "upcoming" && current === "today");

    if (isFast) {
      setFastSwitch(true);
      const t = setTimeout(() => setFastSwitch(false), 350);
      onCleanup(() => clearTimeout(t));
    } else {
      setFastSwitch(false);
    }

    prevTab = current;
  });

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

      if (props.tab === "done" && props.onLoadMore) {
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
          props.onLoadMore();
        }
      }
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

  const [showSectionHeader, setShowSectionHeader] = createSignal(!isEmpty());
  let prevTabHeader = props.tab;

  createEffect(() => {
    const empty = isEmpty();
    const tabSwitched = prevTabHeader !== props.tab;
    prevTabHeader = props.tab;

    if (empty) {
      if (tabSwitched) {
        setShowSectionHeader(false);
      } else {
        const t = setTimeout(() => setShowSectionHeader(false), 600);
        onCleanup(() => clearTimeout(t));
      }
    } else {
      setShowSectionHeader(true);
    }
  });

  // ── Easter egg & Smiley Wobbly Scaling ───────────────
  const [smileyClickCount, setSmileyClickCount] = createSignal(0);
  const [smileyState, setSmileyState] = createSignal({ x: 0, y: 0, hover: false, pressed: false });

  const smileyTransform = createMemo(() => {
    const { x, y, hover, pressed } = smileyState();
    if (!hover) return "";

    // Wobbly effect: dramatic rotation and scale up
    const rotateX = -y / 0.5;
    const rotateY = x / 0.5;

    // Squeeze down slightly when clicked for dynamic feedback
    const scale = pressed ? 1.05 : 1.3;
    return `perspective(400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
  });

  const autoSwitch = createMemo(() => !!props.shakingTaskId);

  let prevCount = props.reminders.length;
  let prevTabEffect = props.tab;

  createEffect(() => {
    const currentCount = props.reminders.length;
    const currentTab = props.tab;

    // Trigger confetti when list becomes empty (and we didn't just switch tabs)
    if (prevTabEffect === currentTab && prevCount > 0 && currentCount === 0 && (currentTab === "today" || currentTab === "upcoming")) {
      // Wait for the empty-state fade-in animation to fully complete (1.2s)
      // before importing and firing confetti so we don't jank the CSS transition.
      setTimeout(triggerConfetti, 1050);
    }

    prevCount = currentCount;
    prevTabEffect = currentTab;
  });

  function handleSmileyMove(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setSmileyState(s => ({ ...s, x, y, hover: true }));
  }

  function handleSmileyLeave() {
    setSmileyState(s => ({ ...s, hover: false, pressed: false }));
  }

  function handleSmileyDown() {
    setSmileyState(s => ({ ...s, pressed: true }));
  }

  function handleSmileyUp() {
    setSmileyState(s => ({ ...s, pressed: false }));
  }

  function handleSmileyClick() {
    setSmileyClickCount(c => c + 1);
    if (smileyClickCount() >= 5) {
      triggerConfetti();
      setSmileyClickCount(0);
    }
  }

  async function triggerConfetti() {
    // Dynamic import first to avoid network latency messing up our audio timing
    const confetti = (await import('canvas-confetti')).default;

    playSfx("allDone");

    // Wait slightly so the visual burst hits exactly on the peak of the audio pop
    await new Promise(r => setTimeout(r, 150));

    // Lightweight dual burst
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.65 },
      colors: ['#B8924A', '#C96B5A', '#74c189', '#F5EFE0'],
      disableForReducedMotion: true,
      zIndex: 1000
    });
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.65 },
      colors: ['#B8924A', '#C96B5A', '#74c189', '#F5EFE0'],
      disableForReducedMotion: true,
      zIndex: 1000
    });
  }

  return (
    <main ref={listRef} class={listClass()}>
      <div class="list-transition-grid">
        <div class="list-content" ref={listContentRef} classList={{ "fade-out": isEmpty(), "sorting-active": isSorting(), "fast-switch": fastSwitch() && !autoSwitch(), "auto-switch": autoSwitch() }}>
          <Show when={showSectionHeader()}>
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
          </Show>
          <For each={sorted()}>
            {r => (
              <ReminderCard
                reminder={r}
                onToggle={props.onToggle}
                onSnoozeRequest={props.onSnoozeRequest}
                suppressRise={autoSwitch()}
                isShaking={props.shakingTaskId === r.id}
                snoozeDeparting={
                  props.snoozeDeparting?.id === r.id
                    ? props.snoozeDeparting.direction
                    : undefined
                }
              />
            )}
          </For>
          <div class="list-bottom-spacer" style={{ height: "1rem", "flex-shrink": 0 }} />
        </div>

        <Show when={isEmpty()}>
          <div class="empty-state">
            <div
              class="empty-icon"
              onMouseDown={handleSmileyDown}
              onMouseUp={handleSmileyUp}
              onClick={handleSmileyClick}
              onMouseMove={handleSmileyMove}
              onMouseLeave={handleSmileyLeave}
              style={{ transform: smileyTransform() }}
            >
              <SmileIcon />
            </div>
            <p class="empty-text">{EMPTY_TEXT[props.tab]}</p>
          </div>
        </Show>
      </div>
    </main>
  );
}

