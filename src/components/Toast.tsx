import { Show, createEffect, onCleanup } from "solid-js";
import { useToast, clearToast } from "@/lib/toast";
import { ClockIcon } from "./icons";

export function ToastRoot() {
  const { toast } = useToast();

  return (
    <Show when={toast()} keyed>
      {t => <ToastMessage t={t} />}
    </Show>
  );
}

function ToastMessage(props: { t: { id: number; message: string } }) {
  // Clear right as the CSS exit phase finishes (toast-in 0.45s + hold +
  // toast-out 0.55s starting at 2.85s ≈ 3.4s total). Keeping the unmount in
  // lockstep with the animation means the pill is never sitting invisible.
  createEffect(() => {
    const timer = setTimeout(() => clearToast(props.t.id), 3400);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div class="toast-pill">
      <div class="toast-icon-wrap">
        <ClockIcon />
      </div>
      <span>{props.t.message}</span>
    </div>
  );
}
