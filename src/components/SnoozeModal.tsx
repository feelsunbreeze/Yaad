import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { ParseToken } from "./ParseToken";

export interface SnoozeModalProps {
  isOpen: boolean;
  taskTitle: string;
  onClose: () => void;
  onSubmit: (preset: string) => void;
}

export function SnoozeModal(props: SnoozeModalProps) {
  const [value, setValue] = createSignal("");
  const [parsedText, setParsedText] = createSignal("");
  
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: number | undefined;

  // Auto-focus input when modal opens
  createEffect(() => {
    if (props.isOpen) {
      setTimeout(() => {
        inputRef?.focus();
        inputRef?.select();
      }, 50);
    }
  });

  // Debounced parsing logic
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
    }, 250);
  });

  onCleanup(() => clearTimeout(debounceTimer));

  function handleSave() {
    const v = value().trim();
    if (!v) return;
    props.onSubmit(v);
    setValue("");
    setParsedText("");
  }

  function pickPreset(preset: string) {
    props.onSubmit(preset);
    setValue("");
    setParsedText("");
  }

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} ariaLabel="Reschedule Task">
      <header class="modal-header">
        <h2>Reschedule Task</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>

      <div class="settings-section">
        <Show when={props.taskTitle}>
          <p class="snooze-task-title">"{props.taskTitle}"</p>
        </Show>

        <div class="snooze-input-wrap">
          <input
            ref={inputRef}
            type="text"
            class="snooze-input"
            placeholder="e.g. 5pm, tomorrow morning, next friday..."
            autocomplete="off"
            spellcheck={false}
            value={value()}
            onInput={e => setValue(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <button
            class="snooze-save-btn"
            type="button"
            aria-label="Reschedule"
            onClick={handleSave}
            disabled={!value().trim()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        </div>

        <Show when={parsedText()}>
          <div class="snooze-preview">
            <span class="parse-prefix">↳ will surface&nbsp;</span>
            <ParseToken value={parsedText()} />
          </div>
        </Show>
      </div>

      <div class="settings-section" style="margin-bottom: 0;">
        <label>Quick Presets</label>
        <div class="snooze-presets-grid">
          <button type="button" class="preset-pill-btn" onClick={() => pickPreset("1h")}>
            <span>+1 Hour</span>
            <span class="preset-desc">in 60m</span>
          </button>
          <button type="button" class="preset-pill-btn" onClick={() => pickPreset("tonight")}>
            <span>Tonight</span>
            <span class="preset-desc">9:00 PM</span>
          </button>
          <button type="button" class="preset-pill-btn" onClick={() => pickPreset("tomorrow")}>
            <span>Tomorrow</span>
            <span class="preset-desc">9:00 AM</span>
          </button>
          <button type="button" class="preset-pill-btn" onClick={() => pickPreset("next_week")}>
            <span>Next Week</span>
            <span class="preset-desc">7 days</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
