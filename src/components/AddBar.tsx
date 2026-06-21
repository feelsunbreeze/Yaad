import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { Transition } from "solid-transition-group";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon } from "./icons";
import { ParseToken } from "./ParseToken";

export interface AddBarProps {
  onSubmit: (title: string) => void;
}

export function AddBar(props: AddBarProps) {
  const [value, setValue] = createSignal("");
  const [parsedText, setParsedText] = createSignal("");
  const [isFocused, setIsFocused] = createSignal(false);

  let debounceTimer: number | undefined;

  createEffect(() => {
    const text = value();

    clearTimeout(debounceTimer);

    if (text.trim().length < 3) {
      setParsedText("");
      return;
    }

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
          placeholder="remind me to… (/)"
          autocomplete="off"
          spellcheck={false}
          value={value()}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onInput={e => setValue(e.currentTarget.value)}
          onKeyDown={e => {
            import("@/lib/audio").then(({ playKeyboardSfx }) => playKeyboardSfx(e.key));
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
        />
        <button
          class="add-btn"
          type="button"
          aria-label="Add reminder"
          onMouseDown={e => e.preventDefault()}
          onClick={submit}
        >
          <PlusIcon />
        </button>
      </div>

      <Transition name="preview">
        <Show when={isFocused() && parsedText()}>
          <div class="parse-preview">
            <span class="parse-prefix">↳ will surface&nbsp;</span>
            <ParseToken value={parsedText()} />
          </div>
        </Show>
      </Transition>
    </footer>
  );
}
