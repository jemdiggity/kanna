import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "@desktop/App.vue";
import type { DbHandle } from "@kanna/db";

// Mark this as mobile build — used by shared components for conditional rendering
declare global {
  const __KANNA_MOBILE__: boolean;
}

// Mobile uses a stub DB handle for now — relay not connected yet
// All queries return empty results until relay is set up
const db: DbHandle = {
  async execute(_query: string, _bindValues?: unknown[]): Promise<{ rowsAffected: number }> {
    return { rowsAffected: 0 };
  },
  async select<T>(_query: string, _bindValues?: unknown[]): Promise<T[]> {
    return [];
  },
};

try {
  const app = createApp(App);
  app.use(createPinia());
  app.provide("db", db);
  app.provide("dbName", "mobile");
  app.mount("#app");
} catch (e) {
  console.error("[mobile] fatal:", e);
  const el = document.getElementById("app");
  if (el) el.textContent = `Failed to initialize: ${e}`;
}
