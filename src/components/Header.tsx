import { SettingsIcon } from "./icons";

export interface HeaderProps {
  /** Output of `formatGreeting(date)` — split so the tail can be italicised. */
  greeting: { lead: string; tail: string };
  /** Output of `formatDatePill(date)` — e.g. "thursday, 29 may". */
  date: string;
  /** Optional click handler for the gear icon. */
  onSettings?: () => void;
}

/**
 * Renders the top row of the app shell: italicised greeting on the left,
 * date pill underneath, settings icon on the right.
 *
 * Lives inside the parent `<header class="header">` element (which is owned
 * by App.tsx so the entrance animation on `.header` runs once for the whole
 * top block, not per-subcomponent).
 */
export function Header(props: HeaderProps) {
  return (
    <div class="header-top">
      <div>
        <h1 class="greeting">
          {props.greeting.lead}
          <br />
          <em>{props.greeting.tail}</em>
        </h1>
        <p class="date-pill">{props.date}</p>
      </div>
      <button
        class="icon-btn"
        aria-label="Settings"
        type="button"
        onClick={props.onSettings}
      >
        <SettingsIcon />
      </button>
    </div>
  );
}
