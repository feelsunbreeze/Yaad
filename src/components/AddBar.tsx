import { createSignal, For } from "solid-js";
import type { QuickTag } from "@/lib/types";
import { PlusIcon } from "./icons";

export interface AddBarProps {
  /** Quick-tag chips rendered under the input. */
  quickTags: QuickTag[];
  /**
   * Fires when the user hits Enter or clicks the plus button with non-empty
   * input. `selectedTagIds` lists the QuickTag.id values that were toggled
   * on at submit time — the hook decides what those tags mean.
   */
  onSubmit: (title: string, selectedTagIds: string[]) => void;
}

/**
 * Bottom input bar plus the quick-tag row. Owns its own input + selected-tag
 * state because nothing outside the AddBar cares about the draft text — the
 * hook only hears about it once the user submits.
 */
export function AddBar(props: AddBarProps) {
  const [value, setValue] = createSignal("");
  const [selected, setSelected] = createSignal<string[]>([]);

  function toggleTag(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function submit() {
    const v = value().trim();
    if (!v) return;
    props.onSubmit(v, selected());
    setValue("");
    setSelected([]);
  }

  return (
    <footer class="add-bar">
      <div class="add-input-wrap">
        <input
          class="add-input"
          type="text"
          placeholder="remind me to…"
          autocomplete="off"
          spellcheck={false}
          value={value()}
          onInput={e => setValue(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          class="add-btn"
          type="button"
          aria-label="Add reminder"
          onClick={submit}
        >
          <PlusIcon />
        </button>
      </div>

      <div class="quick-tags">
        <For each={props.quickTags}>
          {tag => (
            <span
              class={`quick-tag${selected().includes(tag.id) ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected().includes(tag.id)}
              onClick={() => toggleTag(tag.id)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleTag(tag.id);
                }
              }}
            >
              {tag.label}
            </span>
          )}
        </For>
      </div>
    </footer>
  );
}
