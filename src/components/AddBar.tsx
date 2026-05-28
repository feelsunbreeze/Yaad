import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon } from "./icons";
import { ParseToken } from "./ParseToken";

export interface AddBarProps {
  onSubmit: (title: string) => void;
}

/**
 * Bottom input bar with a live parse preview underneath.
 *
 * As the user types, a debounced call to the Rust `parse_time` IPC returns
 * the parser's interpretation of any time phrase in the text. The preview
 * line keeps a static prefix ("↳ will surface ") and lets the variable
 * token swap smoothly via `<ParseToken>` — so "in 1 hour" gracefully
 * crossfades into "tomorrow at 5 PM" in-place, never hard-cuts.
 *
 * The whole preview line itself fades in/out depending on whether there's
 * any input — that's the outer animation, handled by `.parse-preview`'s
 * own `rise` keyframe.
 */
export function AddBar(props: AddBarProps) {
  const [value, setValue] = createSignal("");
  const [parsedText, setParsedText] = createSignal("");

  let debounceTimer: number | undefined;

  createEffect(() => {
    const text = value();
    if (!text.trim()) {
      setParsedText("");
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      try {
        const res = await invoke<{ human_time: string }>("parse_time", {
          raw: text,
        });
        setParsedText(res.human_time);
      } catch (e) {
        console.error("Parse error", e);
      }
    }, 300);
  });

  onCleanup(() => clearTimeout(debounceTimer));

  function submit() {
    const v = value().trim();
    if (!v) return;
    props.onSubmit(v);
    setValue("");
    setParsedText("");
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

      <Show when={parsedText()}>
        <div class="parse-preview">
          <span class="parse-prefix">↳ will surface&nbsp;</span>
          <ParseToken value={parsedText()} />
        </div>
      </Show>
    </footer>
  );
}
