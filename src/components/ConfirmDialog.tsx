import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** Headline of the dialog — short, declarative. */
  title: string;
  /** Body copy explaining what's about to happen. Keep it under ~2 lines. */
  message: string;
  /** Label for the affirmative button. */
  confirmLabel: string;
  /** Label for the cancel button. Default "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as a destructive action (red). */
  destructive?: boolean;
  /** Called when the user confirms. The dialog does NOT auto-close — the
   *  caller decides whether to dismiss on confirm (usually yes) or keep
   *  the modal open (for multi-step flows). */
  onConfirm: () => void;
  /** Called on cancel button, backdrop click, or Escape. */
  onCancel: () => void;
}

/**
 * Themed confirmation dialog. Lives on top of the Modal shell so it
 * inherits the deferred-unmount enter/exit animations automatically.
 *
 * Use this for any destructive or irreversible action that needs the
 * user's explicit consent — factory reset, delete-everything, log out,
 * sign-off-on-warnings, etc. Never use native window.confirm() for these:
 * it doesn't match the cream/amber palette and snaps in without
 * ceremony.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      contentClass="modal-confirm"
      role="alertdialog"
      exitDuration={260}
    >
      <header class="modal-header">
        <h2>{props.title}</h2>
      </header>

      <p class="modal-message">{props.message}</p>

      <div class="modal-actions">
        <button
          type="button"
          class="settings-btn"
          onClick={props.onCancel}
        >
          {props.cancelLabel ?? "Cancel"}
        </button>
        <button
          type="button"
          class={`settings-btn ${props.destructive ? "danger-solid" : "primary"}`}
          onClick={props.onConfirm}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
