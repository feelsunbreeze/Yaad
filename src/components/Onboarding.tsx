import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export interface OnboardingProps {
  onComplete: (name: string, format: string) => void;
}

export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = createSignal(1);
  const [name, setName] = createSignal("");
  const [format, setFormat] = createSignal("12h");
  const [visible, setVisible] = createSignal(false);
  const [closing, setClosing] = createSignal(false);

  onMount(() => {
    // Small delay to allow CSS animations to trigger
    setTimeout(() => setVisible(true), 50);
  });

  function nextStep() {
    if (!name().trim()) return;
    setStep(2);
  }

  async function finish() {
    const v = name().trim();
    if (!v) return;
    setClosing(true);
    
    try {
      await invoke("set_settings", { key: "name", value: v });
      await invoke("set_settings", { key: "time_format", value: format() });
    } catch (e) {
      console.error("Failed to save settings", e);
    }
    
    // Wait for fade out
    setTimeout(() => props.onComplete(v, format()), 600);
  }

  return (
    <div class={`onboarding-overlay ${visible() ? "open" : ""} ${closing() ? "closing" : ""}`}>
      <div class="onboarding-content">
        <h1>Welcome to Yaad.</h1>
        
        <Show when={step() === 1}>
          <div class="onboarding-step-view" style="animation: rise 0.5s var(--ease-decel) both;">
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
                    nextStep();
                  }
                }}
              />
              <button
                class="onboarding-btn"
                type="button"
                aria-label="Continue"
                onClick={nextStep}
                disabled={!name().trim()}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </Show>

        <Show when={step() === 2}>
          <div class="onboarding-step-view" style="animation: rise 0.5s var(--ease-decel) both;">
            <p>Nice to meet you, {name().toLowerCase()}. How do you prefer to see time?</p>
            
            <div class="segmented-control" style="margin-bottom: 2rem;">
              <button
                type="button"
                class={`segment-option${format() === "12h" ? " active" : ""}`}
                onClick={() => setFormat("12h")}
              >
                12-Hour (1:51 PM)
              </button>
              <button
                type="button"
                class={`segment-option${format() === "24h" ? " active" : ""}`}
                onClick={() => setFormat("24h")}
              >
                24-Hour (13:51)
              </button>
            </div>

            <button
              class="settings-btn"
              type="button"
              onClick={finish}
              style="width: 100%; font-size: 0.95rem; padding: 0.75rem; border-radius: 12px;"
            >
              Get Started
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
