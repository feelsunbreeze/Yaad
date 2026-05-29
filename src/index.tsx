/* @refresh reload */
import { render } from "solid-js/web";

// Self-hosted fonts via @fontsource — bundles the woff2 files into the
// Tauri app so the UI doesn't hit fonts.googleapis.com at startup. Lets
// the app render typographically-correct on first launch + offline, and
// avoids a CSP exception for fonts.gstatic.com.
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/500-italic.css";
import "@fontsource/dm-sans/300.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";

import App from "./App";

// Prevent devtools shortcuts in production
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
