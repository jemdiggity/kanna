/**
 * Global preload — runs before any E2E test file.
 * Checks that the Tauri app is running with WebDriver available.
 */

import { getWebDriverBaseUrl, getWebDriverPort } from "./helpers/config";

const WD_URL = getWebDriverBaseUrl();
const WD_PORT = getWebDriverPort();

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function fail(message: string): never {
  throw new Error(message);
}

const status = await fetch(`${WD_URL}/status`).catch(() => null);
if (!status?.ok) {
  fail(
    [
      `WebDriver not available on port ${WD_PORT}.`,
      "Start the app with:",
      `  TAURI_WEBDRIVER_PORT=${WD_PORT} KANNA_DB_NAME=kanna-test.db ./scripts/dev.sh start`,
      "Or run:",
      "  pnpm test:e2e",
    ].join("\n")
  );
}

// Quick check that Vue is mounted
const session = await fetch(`${WD_URL}/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ capabilities: {} }),
}).then((r) => r.json());

const sid = session.value?.sessionId;
if (!sid) {
  fail("Failed to create WebDriver session.");
}

async function executeSync(script: string): Promise<unknown> {
  const response = await fetch(`${WD_URL}/session/${sid}/execute/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, args: [] }),
  }).then((r) => r.json());
  if (response.value?.error) {
    throw new Error(String(response.value.message ?? response.value.error));
  }
  return response.value;
}

const readyDeadline = Date.now() + 15_000;
let vueReady = false;
while (Date.now() < readyDeadline) {
  try {
    vueReady = Boolean(await executeSync(
      "return Boolean(window.__KANNA_E2E__ && window.__KANNA_E2E__.setupState);"
    ));
    if (vueReady) break;
  } catch {
    // The window may still be booting.
  }
  await sleep(200);
}

if (!vueReady) {
  await fetch(`${WD_URL}/session/${sid}`, { method: "DELETE" });
  fail("Vue app not mounted. Wait for the Tauri window to fully load.");
}

// Verify the app is running with a test database — refuse to run tests against production data
const currentDb = await executeSync(
  "return window.__KANNA_E2E__ ? window.__KANNA_E2E__.dbName : null;"
);

await fetch(`${WD_URL}/session/${sid}`, { method: "DELETE" });

if (typeof currentDb !== "string" || !currentDb.includes("test")) {
  fail(
    [
      `REFUSING TO RUN: app is using database "${String(currentDb)}", not a test DB.`,
      "Start the app with:",
      `  TAURI_WEBDRIVER_PORT=${WD_PORT} KANNA_DB_NAME=kanna-test.db ./scripts/dev.sh start`,
    ].join("\n")
  );
}
