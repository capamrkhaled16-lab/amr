import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress Supabase realtime internal socket errors that originate from the
// library's state machine (e.g. "Connect confirmed object to primitive value").
// These are non-fatal connection-state noise, not application bugs.
const REALTIME_NOISE = [
  "Connect confirmed object to primitive value",
  "Cannot read properties of undefined (reading 'subscribe')",
];

function isRealtimeNoise(msg: string): boolean {
  return REALTIME_NOISE.some((p) => msg.includes(p));
}

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message ?? String(e.reason ?? "");
  if (isRealtimeNoise(msg)) {
    e.preventDefault();
    return;
  }
  console.error("[unhandledrejection]", e.reason);
});

const origError = window.console.error;
window.console.error = (...args: unknown[]) => {
  const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  if (isRealtimeNoise(msg)) return;
  origError.call(window.console, ...args);
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// In standalone PWA mode, open external links in a new browser tab
if (window.matchMedia("(display-mode: standalone)").matches) {
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement)?.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    if (href.startsWith("http") && !href.startsWith(window.location.origin)) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
    if (href.startsWith("https://wa.me") || href.startsWith("https://api.whatsapp.com")) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
