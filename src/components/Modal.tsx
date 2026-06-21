import { Show, createSignal, createEffect, onCleanup, type JSX } from "solid-js";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  exitDuration?: number;
  contentClass?: string;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  children: JSX.Element;
}

export function Modal(props: ModalProps) {
  const [render, setRender] = createSignal(props.isOpen);
  const [closing, setClosing] = createSignal(false);

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
