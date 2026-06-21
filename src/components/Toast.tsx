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
