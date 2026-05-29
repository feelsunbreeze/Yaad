import { Show, createEffect, onCleanup } from "solid-js";
import { useToast, clearToast } from "@/lib/toast";
import { CheckIcon } from "./icons";

export function ToastRoot() {
  const { toast } = useToast();

  return (
    <Show when={toast()} keyed>
      {t => <ToastMessage t={t} />}
    </Show>
  );
}

function ToastMessage(props: { t: { id: number; message: string } }) {
  // Automatically clear this toast after the 3.5s CSS animation finishes
  createEffect(() => {
    const timer = setTimeout(() => {
      clearToast(props.t.id);
    }, 3500);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div class="toast-pill">
      <div class="toast-icon-wrap">
        <CheckIcon />
      </div>
      <span>{props.t.message}</span>
    </div>
  );
}
