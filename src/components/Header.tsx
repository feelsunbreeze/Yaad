import { Show } from "solid-js";
import { SettingsIcon } from "./icons";

export interface HeaderProps {
  greeting: { lead: string; name?: string; tail: string };
  date: string;
  time: string;
  onSettings?: () => void;
}

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
