import { createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export interface OnboardingProps {
  onComplete: (name: string) => void;
}

export function Onboarding(props: OnboardingProps) {
  const [name, setName] = createSignal("");
  const [visible, setVisible] = createSignal(false);
  const [closing, setClosing] = createSignal(false);

  onMount(() => {
    // Small delay to allow CSS animations to trigger
    setTimeout(() => setVisible(true), 50);
  });

  async function submit() {
    const v = name().trim();
    if (!v) return;
    setClosing(true);
    
    try {
      await invoke("set_settings", { key: "name", value: v });
    } catch (e) {
      console.error("Failed to save name", e);
    }
    
    // Wait for fade out
    setTimeout(() => props.onComplete(v), 600);
  }

  return (
    <div class={`onboarding-overlay ${visible() ? "open" : ""} ${closing() ? "closing" : ""}`}>
      <div class="onboarding-content">
        <h1>Welcome to Yaad.</h1>
        <p>Before we begin, what should I call you?</p>
        
        <div class="onboarding-input-wrap">
          <input
            type="text"
            class="onboarding-input"
            placeholder="Your name"
            autocomplete="off"
            spellcheck={false}
            value={name()}
            onInput={e => setName(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            class="onboarding-btn"
            type="button"
            aria-label="Continue"
            onClick={submit}
            disabled={!name().trim()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
