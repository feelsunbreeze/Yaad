import { createSignal, onMount, Show, batch } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { setSfxMuted, playSfx } from "@/lib/audio";

export interface OnboardingProps {
  onComplete: (name: string, format: string) => void;
}

const STEPS = 4;

/**
 * A slow, deliberate welcome — one question at a time, each with a line of
 * flavor, gracefully transitioning in and out. The final step sets the
 * notification frequency, so the last thing the user tunes is the thing that
 * defines how Yaad will actually speak to them.
 */
export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = createSignal(1);
  const [leaving, setLeaving] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  const [closing, setClosing] = createSignal(false);

  const [name, setName] = createSignal("");
  const [format, setFormat] = createSignal("12h");
  const [soundOn, setSoundOn] = createSignal(true);
  const [frequency, setFrequency] = createSignal(2);

  let nameRef: HTMLInputElement | undefined;

  onMount(() => {
    setTimeout(() => setVisible(true), 60);
    setTimeout(() => nameRef?.focus(), 700);
  });

  // Cross-step transition: play the exit on the current step, then swap.
  function go(to: number) {
    if (to < 1 || to > STEPS || to === step() || leaving()) return;
    playSfx("tabSwitch");
    setLeaving(true);
    setTimeout(() => {
      // Batch so the incoming step mounts with leaving=false in a single DOM
      // pass — otherwise the fresh element can briefly inherit `.leaving` and
      // flash the exit animation.
      batch(() => {
        setStep(to);
        setLeaving(false);
      });
    }, 240);
  }

  function next() {
    if (step() === 1 && !name().trim()) return;
    go(step() + 1);
  }

  function back() {
    go(step() - 1);
  }

  async function finish() {
    const v = name().trim();
    if (!v) return;

    // Apply sound immediately so the closing chime respects the choice.
    setSfxMuted(!soundOn());
    setClosing(true);
    playSfx("allDone");

    try {
      await invoke("set_settings", { key: "name", value: v });
      await invoke("set_settings", { key: "time_format", value: format() });
      await invoke("set_settings", { key: "sound_enabled", value: soundOn() ? "true" : "false" });
      await invoke("set_settings", { key: "notification_frequency", value: String(frequency()) });
    } catch (e) {
      console.error("Failed to save onboarding settings", e);
    }

    setTimeout(() => props.onComplete(v, format()), 650);
  }

  const freqFlavor = () => {
    switch (frequency()) {
      case 1: return "Once, exactly when it's due. Quiet and precise.";
      case 2: return "A gentle nudge before, and once at the deadline.";
      case 3: return "A couple of nudges, then the deadline. A steady hand.";
      case 4: return "Several nudges before it lands. Hard to miss.";
      default: return "Persistent. Yaad will keep surfacing it until it's done.";
    }
  };

  return (
    <div class={`onboarding-overlay ${visible() ? "open" : ""} ${closing() ? "closing" : ""}`}>
      <div class="onboarding-content ob-card">
        <div class="ob-wordmark">YAAD</div>

        <Show when={step()} keyed>
          {s => (
            <div class={`ob-step ${leaving() ? "leaving" : ""}`}>
              {/* ── Step 1 · Name ── */}
              {s === 1 && (
                <>
                  <span class="ob-eyebrow">Welcome</span>
                  <h1 class="ob-title">First — your name.</h1>
                  <p class="ob-flavor">So this stays a conversation, not a system.</p>
                  <div class="onboarding-input-wrap">
                    <input
                      ref={nameRef}
                      type="text"
                      class="onboarding-input"
                      placeholder="what should I call you?"
                      autocomplete="off"
                      spellcheck={false}
                      value={name()}
                      onInput={e => setName(e.currentTarget.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          next();
                        }
                      }}
                    />
                    <button
                      class="onboarding-btn"
                      type="button"
                      aria-label="Continue"
                      onClick={next}
                      disabled={!name().trim()}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </button>
                  </div>
                </>
              )}

              {/* ── Step 2 · Time format ── */}
              {s === 2 && (
                <>
                  <span class="ob-eyebrow">A small preference</span>
                  <h1 class="ob-title">How do you keep time?</h1>
                  <p class="ob-flavor">Some read the day in halves, some in twenty-four.</p>
                  <div class="segmented-control">
                    <button type="button" class={`segment-option${format() === "12h" ? " active" : ""}`} onClick={() => setFormat("12h")}>
                      12-Hour <span class="ob-seg-sub">1:51 PM</span>
                    </button>
                    <button type="button" class={`segment-option${format() === "24h" ? " active" : ""}`} onClick={() => setFormat("24h")}>
                      24-Hour <span class="ob-seg-sub">13:51</span>
                    </button>
                  </div>
                  <div class="ob-nav">
                    <button type="button" class="ob-back" onClick={back}>← back</button>
                    <button type="button" class="ob-primary" onClick={next}>Continue</button>
                  </div>
                </>
              )}

              {/* ── Step 3 · Sound ── */}
              {s === 3 && (
                <>
                  <span class="ob-eyebrow">Yaad has a voice</span>
                  <h1 class="ob-title">Should it make a sound?</h1>
                  <p class="ob-flavor">Soft tones as things surface and settle — silenced anytime.</p>
                  <div class="segmented-control">
                    <button type="button" class={`segment-option${soundOn() ? " active" : ""}`} onClick={() => { setSoundOn(true); setSfxMuted(false); playSfx("focusTask"); }}>
                      On
                    </button>
                    <button type="button" class={`segment-option${!soundOn() ? " active" : ""}`} onClick={() => { setSoundOn(false); setSfxMuted(true); }}>
                      Off
                    </button>
                  </div>
                  <div class="ob-nav">
                    <button type="button" class="ob-back" onClick={back}>← back</button>
                    <button type="button" class="ob-primary" onClick={next}>Continue</button>
                  </div>
                </>
              )}

              {/* ── Step 4 · Notification frequency (final) ── */}
              {s === 4 && (
                <>
                  <span class="ob-eyebrow">Last thing</span>
                  <h1 class="ob-title">How often should I nudge?</h1>
                  <p class="ob-flavor">{freqFlavor()}</p>
                  <div class="ob-freq">
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={frequency()}
                      onInput={e => setFrequency(parseInt(e.currentTarget.value, 10))}
                      class="settings-slider"
                    />
                    <div class="ob-freq-scale">
                      <span>once</span>
                      <span>often</span>
                    </div>
                  </div>
                  <div class="ob-nav">
                    <button type="button" class="ob-back" onClick={back}>← back</button>
                    <button type="button" class="ob-primary ob-begin" onClick={finish}>Begin</button>
                  </div>
                </>
              )}
            </div>
          )}
        </Show>

        <div class="ob-dots" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span class={`ob-dot${step() === i + 1 ? " active" : ""}${step() > i + 1 ? " done" : ""}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
