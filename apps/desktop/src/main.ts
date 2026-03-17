import { createApp } from "vue";
import { invoke } from "@tauri-apps/api/core";
import App from "./App.vue";

// Forward all console output to Tauri backend for logging
const LOG_FILE = "/tmp/kanna-webview.log";

function forwardLog(level: string, origFn: (...args: any[]) => void) {
  return (...args: any[]) => {
    origFn.apply(console, args);
    const msg = args.map(a => {
      try { return typeof a === "string" ? a : JSON.stringify(a); }
      catch { return String(a); }
    }).join(" ");
    // Fire and forget — write to a temp log file via Tauri
    invoke("append_log", { message: `[${level}] ${msg}` }).catch(() => {});
  };
}

console.log = forwardLog("LOG", console.log);
console.warn = forwardLog("WARN", console.warn);
console.error = forwardLog("ERROR", console.error);

// Catch unhandled errors
window.addEventListener("error", (e) => {
  invoke("append_log", { message: `[UNCAUGHT] ${e.message} at ${e.filename}:${e.lineno}` }).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
  invoke("append_log", { message: `[UNHANDLED_REJECTION] ${e.reason}` }).catch(() => {});
});

createApp(App).mount("#app");
