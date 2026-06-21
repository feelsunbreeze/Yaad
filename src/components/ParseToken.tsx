import { Show, createSignal, createEffect, on, onCleanup } from "solid-js";

export interface ParseTokenProps {
  value: string;
  duration?: number;
}

export function ParseToken(props: ParseTokenProps) {
  const [current, setCurrent] = createSignal(props.value);
  const [outgoing, setOutgoing] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.value,
      (next, prev) => {
        if (prev === undefined || next === prev) {
          setCurrent(next);
          return;
        }
        setOutgoing(current());
        setCurrent(next);
        const t = window.setTimeout(
          () => setOutgoing(null),
          props.duration ?? 240,
        );
        onCleanup(() => window.clearTimeout(t));
      },
    ),
  );

  return (
    <span class="parse-token-wrap">
      <Show when={outgoing()} keyed>
        {old => <span class="parse-token parse-token-out">{old}</span>}
      </Show>
      <Show when={current()} keyed>
        {val => <span class="parse-token parse-token-in">{val}</span>}
      </Show>
    </span>
  );
}
