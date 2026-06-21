import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

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
