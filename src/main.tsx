import React from "react";
import ReactDOM from "react-dom/client";
import "argentui/styles.css";
import "./styles.css";
import "./theme-clean.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// A browser only offers "install on the home screen" once a service worker with
// a fetch handler is registered; the same worker keeps the shell reachable
// offline. Skipped in dev so a stale shell never hides a change.
const env = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
if (env?.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
