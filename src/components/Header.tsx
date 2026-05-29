import { Show } from "solid-js";
import { SettingsIcon } from "./icons";

export interface HeaderProps {
  /** Output of `formatGreeting(date)` — split so the tail can be italicised. */
  greeting: { lead: string; name?: string; tail: string };
  /** Output of `formatDatePill(date)` — e.g. "thursday, 29 may". */
  date: string;
  /** Live formatted time — e.g. "1:51:04 pm". */
  time: string;
  /** Optional click handler for the gear icon. App wires this to the
   *  `test_notification` IPC command so the user can verify OS toasts
   *  without opening a settings page. */
  onSettings?: () => void;
}

/**
 * Renders the top row of the app shell: italicised greeting on the left,
 * date pill underneath, settings icon on the right.
 *
 * Lives inside the parent `<header class="header">` element (owned by
 * App.tsx so the rise animation on `.header` runs once for the whole top
 * block, not per-subcomponent).
 */
export function Header(props: HeaderProps) {
  return (
    <>
      <div class="header-top">
        <div style={{ flex: 1, "margin-right": "1.5rem" }}>
          <h1 class="greeting">
            {props.greeting.lead}
            <Show when={props.greeting.name}>
              {n => <span class="greeting-name">{n()}</span>}
            </Show>
            <br />
            <em>{props.greeting.tail}</em>
          </h1>
        </div>
        <button
          class="icon-btn"
          aria-label="Settings"
          title="Settings"
          type="button"
          onClick={props.onSettings}
        >
          <SettingsIcon />
        </button>
      </div>
      <div class="date-time-row">
        <span class="date-pill">{props.date}</span>
        <span class="time-pill">{props.time}</span>
      </div>
    </>
  );
}
