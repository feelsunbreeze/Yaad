import { Show, createSignal, createEffect, onCleanup, type JSX } from "solid-js";

export interface ModalProps {
  /** Drives mount + animation phase. */
  isOpen: boolean;
  /** Called when the user clicks the backdrop, presses Escape, or activates
   *  any explicit close affordance inside the modal (X button, Cancel, etc).
   *  The shell defers the actual unmount until the exit animation completes. */
  onClose: () => void;
  /** ms to keep the element mounted after `isOpen` flips false. Must match
   *  the CSS exit keyframe duration (.modal-overlay.closing). Default 280. */
  exitDuration?: number;
  /** Extra class applied to the modal-content div, e.g. "modal-confirm". */
  contentClass?: string;
  /** ARIA role for the dialog element. `alertdialog` for destructive
   *  confirms; `dialog` for general modals. */
  role?: "dialog" | "alertdialog";
  /** ARIA label for the dialog itself. If null, callers should rely on a
   *  visible `<h2>` inside and aria-labelledby. */
  ariaLabel?: string;
  children: JSX.Element;
}

/**
 * Reusable modal shell with a deferred-unmount enter/exit animation.
 *
 * The standard Solid `<Show>` pattern snaps the element in and out of the
 * DOM — there's no opportunity for an exit animation because the children
 * vanish the moment `when` flips false. This shell keeps the element
 * mounted, toggles a `.closing` class, waits `exitDuration` ms for the CSS
 * exit keyframe to complete, and then unmounts cleanly.
 *
 * It also wires up the two universal close affordances:
 *   - clicking the backdrop (outside the content div)
 *   - pressing Escape anywhere while the modal is open
 *
 * Everything else (close buttons, cancel buttons, explicit dismissals) is
 * the consumer's job — they should call `onClose` and the shell will do
 * the rest.
 */
export function Modal(props: ModalProps) {
  const [render, setRender] = createSignal(props.isOpen);
  const [closing, setClosing] = createSignal(false);

  // Drive the mount/closing state from `isOpen`. When isOpen flips false we
  // hold the element in the DOM, mark it closing, and unmount after the
  // exit duration elapses.
  createEffect(() => {
    if (props.isOpen) {
      setClosing(false);
      setRender(true);
      return;
    }
    if (!render()) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setRender(false);
      setClosing(false);
    }, props.exitDuration ?? 280);
    onCleanup(() => window.clearTimeout(t));
  });

  // Escape key dismisses the modal at the top of the modal stack. We attach
  // only while the modal is rendered + not already closing.
  createEffect(() => {
    if (!render() || closing()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={render()}>
      <div
        class={`modal-overlay${closing() ? " closing" : ""}`}
        onClick={() => props.onClose()}
        role="presentation"
      >
        <div
          class={`modal-content${props.contentClass ? " " + props.contentClass : ""}`}
          role={props.role ?? "dialog"}
          aria-modal="true"
          aria-label={props.ariaLabel}
          onClick={e => e.stopPropagation()}
        >
          {props.children}
        </div>
      </div>
    </Show>
  );
}
