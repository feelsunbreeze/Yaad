import { createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";

export interface SettingsModalProps {
  currentName: string;
  isOpen: boolean;
  onClose: () => void;
  onNameChange: (newName: string) => void;
  timeFormat: string;
  onTimeFormatChange: (fmt: string) => void;
  onFactoryReset: () => void;
}

/**
 * The Settings panel. Lives on top of the reusable Modal shell so the
 * enter/exit animations (backdrop fade + content scale-and-rise) come for
 * free; clicking the backdrop, the X button, or hitting Escape all route
 * through the same `onClose` deferred-unmount path.
 *
 * The factory-reset button no longer triggers a native window.confirm() —
 * it opens a themed ConfirmDialog stacked above this modal. The
 * destructive button is styled red; the dialog matches the cream/amber
 * palette and animates in/out with the same easing as the parent.
 */
export function SettingsModal(props: SettingsModalProps) {
  const [name, setName] = createSignal(props.currentName);
  const [frequency, setFrequency] = createSignal("2");
  const [quietHours, setQuietHours] = createSignal("false");
  const [isResetConfirmOpen, setIsResetConfirmOpen] = createSignal(false);

  // Keep the local name in sync with whatever App.tsx hands us, and pull
  // the latest settings from the backend every time the modal opens.
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
      setQuietHours(settings["quiet_hours_enabled"] === "true" ? "true" : "false");
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

  async function updateQuietHours(value: string) {
    setQuietHours(value);
    try {
      await invoke("set_settings", { key: "quiet_hours_enabled", value });
    } catch (err) {
      console.error("Failed to save quiet hours", err);
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
          <label>Quiet Hours</label>
          <p class="settings-desc">
            When on, reminders that would fire between midnight and 7 AM are held until 7 AM instead.
          </p>
          <div class="segmented-control">
            <button
              type="button"
              class={`segment-option${quietHours() === "false" ? " active" : ""}`}
              onClick={() => updateQuietHours("false")}
            >
              Off
            </button>
            <button
              type="button"
              class={`segment-option${quietHours() === "true" ? " active" : ""}`}
              onClick={() => updateQuietHours("true")}
            >
              On (12–7 AM)
            </button>
          </div>
        </div>

        <div class="settings-section">
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
