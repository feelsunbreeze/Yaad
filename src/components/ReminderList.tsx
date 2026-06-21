import { For, Show, createSignal, onMount, onCleanup, createMemo, createEffect } from "solid-js";
import type { Reminder, Tab } from "@/lib/types";
import { ReminderCard } from "./ReminderCard";
import { SmileIcon, SortTimeIcon } from "./icons";
import { playSfx } from "@/lib/audio";
import confetti from "canvas-confetti";

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
  reminders: Reminder[];
  tab: Tab;
  onToggle: (id: string) => void;
  onSnoozeRequest: (id: string) => void;
  shakingTaskId?: string | null;
  onLoadMore?: () => void;
  snoozeDeparting?: { id: string; direction: "left" | "right" } | null;
  inlineReschedule?: { id: string; fireAt: number; timeLabel: string } | null;
}

export function ReminderList(props: ReminderListProps) {
  let listRef: HTMLElement | undefined;
  let listContentRef: HTMLDivElement | undefined;
  const [showShadow, setShowShadow] = createSignal(false);
  const [isScrolling, setIsScrolling] = createSignal(false);

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

  const [sortAsc, setSortAsc] = createSignal(true);

  const sorted = createMemo(() => {
    const items = [...props.reminders];
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
    playSfx("sort");

    setIsSorting(true);

    setTimeout(() => {
      setSortAsc(v => !v);

      setTimeout(() => {
        setIsSorting(false);
      }, 150);
    }, 500);
  }

  onMount(() => {
    if (!listRef) return;
    const el = listRef;

    function check() {
      const overflow = el.scrollHeight > el.clientHeight + 24;
      const notAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 24;
      setShowShadow(overflow && notAtBottom);
    }
    check();

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

    const ro = new ResizeObserver(check);
    ro.observe(el);

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

  const [smileyClickCount, setSmileyClickCount] = createSignal(0);
  const [smileyState, setSmileyState] = createSignal({ x: 0, y: 0, hover: false, pressed: false });

  const smileyTransform = createMemo(() => {
    const { x, y, hover, pressed } = smileyState();
    if (!hover) return "";

    const rotateX = -y / 0.5;
    const rotateY = x / 0.5;

    const scale = pressed ? 1.05 : 1.3;
    return `perspective(400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
  });

  const autoSwitch = createMemo(() => !!props.shakingTaskId);

  let prevCount = props.reminders.length;
  let prevTabEffect = props.tab;

  createEffect(() => {
    const currentCount = props.reminders.length;
    const currentTab = props.tab;

    if (prevTabEffect === currentTab && prevCount > 0 && currentCount === 0 && (currentTab === "today" || currentTab === "upcoming")) {
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
    playSfx("allDone");

    await new Promise(r => setTimeout(r, 150));

    if (typeof document === "undefined") return;

    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "1000";
    document.body.appendChild(canvas);

    const fire = confetti.create(canvas, { resize: true, useWorker: false });
    const colors = ["#B8924A", "#C96B5A", "#74c189", "#F5EFE0"];

    void fire({
      particleCount: 50,
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.65 },
      colors,
      disableForReducedMotion: true,
    });
    void fire({
      particleCount: 50,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.65 },
      colors,
      disableForReducedMotion: true,
    });

    window.setTimeout(() => {
      try { fire.reset(); } catch { /* noop */ }
      canvas.remove();
    }, 3500);
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
                inlineReschedule={
                  props.inlineReschedule?.id === r.id
                    ? { fireAt: props.inlineReschedule.fireAt, timeLabel: props.inlineReschedule.timeLabel }
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
