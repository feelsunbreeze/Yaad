import { createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { setSfxMuted } from "@/lib/audio";

export interface SettingsModalProps {
  currentName: string;
  isOpen: boolean;
  onClose: () => void;
  onNameChange: (newName: string) => void;
  timeFormat: string;
  onTimeFormatChange: (fmt: string) => void;
  onFactoryReset: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [name, setName] = createSignal(props.currentName);
  const [frequency, setFrequency] = createSignal("2");
  const [soundOn, setSoundOn] = createSignal(true);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = createSignal(false);

  createEffect(() => {
    if (props.isOpen) {
      setName(props.currentName);
      void loadSettings();
    }
  });

  async function loadSettings() {
    try {
      const settings = await invoke<Record<string, string>>("get_settings");
      if (settings["notification_frequency"]) {
        setFrequency(settings["notification_frequency"]);
      }
      setSoundOn(settings["sound_enabled"] !== "false");
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

  async function updateTimeFormat(fmt: string) {
    try {
      await invoke("set_settings", { key: "time_format", value: fmt });
      props.onTimeFormatChange(fmt);
    } catch (err) {
      console.error("Failed to save time format", err);
    }
  }

  async function updateSound(on: boolean) {
    setSoundOn(on);
    setSfxMuted(!on);
    try {
      await invoke("set_settings", { key: "sound_enabled", value: on ? "true" : "false" });
    } catch (err) {
      console.error("Failed to save sound setting", err);
    }
  }

  function requestFactoryReset() {
    setIsResetConfirmOpen(true);
  }

  async function confirmFactoryReset() {
    setIsResetConfirmOpen(false);
    try {
      await invoke("factory_reset");
      props.onFactoryReset();
    } catch (e) {
      console.error("Failed factory reset", e);
    }
  }

  return (
    <>
      <Modal isOpen={props.isOpen} onClose={props.onClose} ariaLabel="Settings">
        <header class="modal-header">
          <h2>Settings</h2>
          <button
            type="button"
            class="modal-close"
            aria-label="Close settings"
            onClick={props.onClose}
          >
            ×
          </button>
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
            <button class="settings-btn" type="button" onClick={saveName}>
              Save
            </button>
          </div>
        </div>

        <div class="settings-section">
          <label>Time Format</label>
          <div class="segmented-control">
            <button
              type="button"
              class={`segment-option${props.timeFormat === "12h" ? " active" : ""}`}
              onClick={() => updateTimeFormat("12h")}
            >
              12-Hour (1:51 PM)
            </button>
            <button
              type="button"
              class={`segment-option${props.timeFormat === "24h" ? " active" : ""}`}
              onClick={() => updateTimeFormat("24h")}
            >
              24-Hour (13:51)
            </button>
          </div>
        </div>

        <div class="settings-section">
          <label>Sound</label>
          <div class="segmented-control">
            <button
              type="button"
              class={`segment-option${soundOn() ? " active" : ""}`}
              onClick={() => updateSound(true)}
            >
              On
            </button>
            <button
              type="button"
              class={`segment-option${!soundOn() ? " active" : ""}`}
              onClick={() => updateSound(false)}
            >
              Off
            </button>
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
          <p class="settings-desc" style="margin-top: 0.2rem; opacity: 0.8; font-size: 0.7rem;">
            {frequency() === "1"
              ? "We'll notify you exactly at the deadline."
              : `We'll notify you ${parseInt(frequency()) - 1} time${parseInt(frequency()) - 1 === 1 ? "" : "s"} randomly before the deadline, and once exactly at the deadline.`}
          </p>
        </div>

        <div class="settings-section" style="margin-bottom: 0;">
          <label>System</label>
          <div class="settings-actions">
            <button
              type="button"
              class="settings-btn danger"
              onClick={requestFactoryReset}
            >
              Delete Database (Factory Reset)
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={isResetConfirmOpen()}
        title="Delete everything?"
        message="This permanently removes every reminder, every entry in your completed log, and every saved setting. There is no undo."
        confirmLabel="Delete everything"
        cancelLabel="Keep my data"
        destructive
        onConfirm={confirmFactoryReset}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </>
  );
}
