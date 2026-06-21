import { For } from "solid-js";
import type { Tab } from "@/lib/types";

const ALL_TABS: readonly Tab[] = ["today", "upcoming", "done"] as const;

export interface TabsProps {
  current: Tab;
  onChange: (next: Tab) => void;
}

export function Tabs(props: TabsProps) {
  return (
    <div class="tabs" role="tablist">
      <For each={ALL_TABS}>
        {t => (
          <div
            class={`tab${props.current === t ? " active" : ""}`}
            role="tab"
            tabIndex={0}
            aria-selected={props.current === t}
            onClick={() => props.onChange(t)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onChange(t);
              }
            }}
          >
            {t}
          </div>
        )}
      </For>
    </div>
  );
}
