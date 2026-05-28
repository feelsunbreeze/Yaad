import { createSignal, createEffect, onCleanup } from "solid-js";
import { PlusIcon } from "./icons";
import { invoke } from "@tauri-apps/api/core";

export interface AddBarProps {
  onSubmit: (title: string) => void;
}

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
        const res = await invoke<{ human_time: string }>("parse_time", { raw: text });
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
      
      {parsedText() && (
        <div class="parse-preview">
          ↳ will surface randomly before {parsedText()}
        </div>
      )}
    </footer>
  );
}
