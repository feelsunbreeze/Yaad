import { createSignal, createEffect, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export interface SettingsModalProps {
  currentName: string;
  isOpen: boolean;
  onClose: () => void;
  onNameChange: (newName: string) => void;
  onFactoryReset: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [name, setName] = createSignal(props.currentName);
  const [frequency, setFrequency] = createSignal("2");

  createEffect(() => {
    if (props.isOpen) {
      setName(props.currentName);
      loadSettings();
    }
  });

  async function loadSettings() {
    try {
      const settings = await invoke<Record<string, string>>("get_settings");
      if (settings["notification_frequency"]) {
        setFrequency(settings["notification_frequency"]);
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  }

  async function saveName() {
    const v = name().trim();
    if (!v) return;
    try {
      await invoke("set_settings", { key: "name", value: v });
      props.onNameChange(v);
    } catch (e) {
      console.error("Failed to save name", e);
    }
  }

  async function updateFrequency(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = el.value;
    setFrequency(v);
    try {
      await invoke("set_settings", { key: "notification_frequency", value: v });
    } catch (err) {
      console.error("Failed to save frequency", err);
    }
  }

  async function doReset() {
    if (confirm("Are you sure? This will delete all reminders and history.")) {
      try {
        await invoke("factory_reset");
        props.onFactoryReset();
      } catch (e) {
        console.error("Failed factory reset", e);
      }
    }
  }

  return (
    <Show when={props.isOpen}>
      <div class="modal-overlay" onClick={props.onClose}>
        <div class="modal-content" onClick={e => e.stopPropagation()}>
          <header class="modal-header">
            <h2>Settings</h2>
            <button class="modal-close" onClick={props.onClose}>×</button>
          </header>

          <div class="settings-section">
            <label>Your Name</label>
            <div class="settings-row">
              <input 
                class="settings-input"
                value={name()} 
                onInput={e => setName(e.currentTarget.value)}
                onKeyDown={e => e.key === "Enter" && saveName()}
              />
              <button class="settings-btn" onClick={saveName}>Save</button>
            </div>
          </div>

          <div class="settings-section">
            <label>Notification Frequency</label>
            <p class="settings-desc">
              How many times should we notify you? ({frequency()} time{frequency() === "1" ? "" : "s"})
            </p>
            <input 
              type="range" 
              min="1" 
              max="5" 
              value={frequency()} 
              onInput={updateFrequency}
              class="settings-slider"
            />
            <p class="settings-desc" style="margin-top: 0.4rem; opacity: 0.8; font-size: 0.7rem;">
              {frequency() === "1" 
                ? "We'll notify you exactly at the deadline." 
                : `We'll notify you ${parseInt(frequency()) - 1} time${parseInt(frequency()) - 1 === 1 ? "" : "s"} randomly before the deadline, and once exactly at the deadline.`}
            </p>
          </div>

          <div class="settings-section">
            <label>System</label>
            <div class="settings-actions">
              <button class="settings-btn danger" onClick={doReset}>Delete Database (Factory Reset)</button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
