import { Show, createSignal, createEffect, on, onCleanup } from "solid-js";

export interface ParseTokenProps {
  /** The current value to display. When this changes, the previous value
   *  animates out as the new one animates in, in-place. */
  value: string;
  /** ms; must match the CSS keyframe duration on `.parse-token-in` /
   *  `.parse-token-out`. Default 240. */
  duration?: number;
}

/**
 * An inline span whose contents slide-swap when `value` changes.
 *
 * The outgoing value is absolutely positioned over the same spot so the
 * layout doesn't jump while it fades. The incoming value takes the new
 * width naturally and animates in from below. The wrapper is
 * `position: relative; display: inline-block` so it lives happily inside
 * a sentence without breaking the inline flow.
 *
 * Used by the AddBar's parse preview to soften the "↳ will surface
 * [token]" token swap. The token is the only thing that changes — the
 * static prefix and punctuation never re-animate.
 *
 * Implementation note: each value change forces a fresh mount of the
 * `.parse-token-in` span via `<Show ... keyed>` so the CSS enter
 * keyframe re-triggers on every swap (text-content changes alone don't
 * restart CSS animations).
 */
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
