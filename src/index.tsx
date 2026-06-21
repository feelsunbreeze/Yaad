/* @refresh reload */
import { render } from "solid-js/web";

import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/500-italic.css";
import "@fontsource/dm-sans/300.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";

import App from "./App";

document.addEventListener("keydown", (e) => {
  if (
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") ||
    (e.metaKey && e.altKey && e.key.toLowerCase() === "i")
  ) {
    e.preventDefault();
  }
});

render(() => <App />, document.getElementById("root") as HTMLElement);
