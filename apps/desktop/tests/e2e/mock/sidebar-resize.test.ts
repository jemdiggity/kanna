import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetDatabase } from "../helpers/reset";
import { WebDriverClient } from "../helpers/webdriver";

interface WorkspaceSnapshot {
  windows?: Array<{
    windowId?: string | null;
    sidebarWidth?: number | null;
  }>;
}

const SIDEBAR_SELECTOR = '[data-testid="sidebar-shell"]';
const RESIZE_HANDLE_SELECTOR = '[data-testid="sidebar-resize-handle"]';

async function getSidebarWidth(client: WebDriverClient): Promise<number> {
  return client.executeSync<number>(
    `const sidebar = document.querySelector(${JSON.stringify(SIDEBAR_SELECTOR)});
     return sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;`,
  );
}

async function getCurrentWindowId(client: WebDriverClient): Promise<string> {
  return client.executeSync<string>(
    "return window.__KANNA_E2E__.setupState.windowWorkspace.bootstrap.windowId;",
  );
}

async function readWorkspaceSnapshot(client: WebDriverClient): Promise<WorkspaceSnapshot> {
  const result = await client.executeAsync<WorkspaceSnapshot | { __error: string }>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     Promise.resolve(ctx.windowWorkspace.loadSnapshot())
       .then((snapshot) => cb(snapshot))
       .catch((error) => cb({ __error: error && error.message ? error.message : String(error) }));`,
  );
  if (typeof result === "object" && result !== null && "__error" in result) {
    throw new Error(result.__error);
  }
  return result;
}

async function getPersistedSidebarWidth(
  client: WebDriverClient,
  windowId: string,
): Promise<number | undefined> {
  const snapshot = await readWorkspaceSnapshot(client);
  const windowState = snapshot.windows?.find((entry) => entry.windowId === windowId);
  return typeof windowState?.sidebarWidth === "number" ? windowState.sidebarWidth : undefined;
}

async function waitForSidebarWidth(
  client: WebDriverClient,
  expected: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastWidth = 0;
  while (Date.now() < deadline) {
    lastWidth = await getSidebarWidth(client);
    if (lastWidth === expected) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for sidebar width ${expected}; last width was ${lastWidth}`);
}

async function waitForPersistedSidebarWidth(
  client: WebDriverClient,
  windowId: string,
  expected: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastWidth: number | undefined;
  while (Date.now() < deadline) {
    lastWidth = await getPersistedSidebarWidth(client, windowId);
    if (lastWidth === expected) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for persisted sidebar width ${expected}; last width was ${lastWidth}`);
}

async function dragSidebarHandleToWidth(
  client: WebDriverClient,
  targetWidth: number,
): Promise<void> {
  const result = await client.executeSync<string | { __error: string }>(
    `const sidebar = document.querySelector(${JSON.stringify(SIDEBAR_SELECTOR)});
     let handle = document.querySelector(${JSON.stringify(RESIZE_HANDLE_SELECTOR)});
     if (!sidebar) return { __error: "sidebar shell not found" };
     const sidebarRect = sidebar.getBoundingClientRect();
     handle = handle || document.elementFromPoint(
       Math.round(sidebarRect.right),
       Math.round(sidebarRect.top + sidebarRect.height / 2),
     );
     if (!handle) return { __error: "sidebar resize handle not found" };
     const handleRect = handle.getBoundingClientRect();
     const start = {
       x: Math.round(handleRect.left + handleRect.width / 2),
       y: Math.round(handleRect.top + handleRect.height / 2),
     };
     const end = {
       x: Math.round(sidebarRect.left + ${targetWidth}),
       y: Math.round(handleRect.top + handleRect.height / 2),
     };
     const pointerId = 42;
     const buildEvent = (type, point, buttons) => {
       const init = {
         bubbles: true,
         cancelable: true,
         pointerId,
         pointerType: "mouse",
         isPrimary: true,
         clientX: point.x,
         clientY: point.y,
         screenX: point.x,
         screenY: point.y,
         button: 0,
         buttons,
       };
       if (typeof PointerEvent === "function") return new PointerEvent(type, init);
       const event = new MouseEvent(type, init);
       Object.defineProperties(event, {
         pointerId: { value: pointerId },
         pointerType: { value: "mouse" },
         isPrimary: { value: true },
       });
       return event;
     };
     const originalSetPointerCapture = handle.setPointerCapture;
     // Synthetic pointer events in WKWebView are not active pointers, so capture
     // can throw even though the app's resize listeners are wired correctly.
     handle.setPointerCapture = () => {};
     try {
       handle.dispatchEvent(buildEvent("pointerdown", start, 1));
       document.dispatchEvent(buildEvent("pointermove", end, 1));
       document.dispatchEvent(buildEvent("pointerup", end, 0));
       return "ok";
     } catch (error) {
       return { __error: error && error.message ? error.message : String(error) };
     } finally {
       handle.setPointerCapture = originalSetPointerCapture;
     }`,
  );
  if (typeof result === "object" && result !== null && "__error" in result) {
    throw new Error(result.__error);
  }
}

describe("sidebar resize", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
  });

  afterAll(async () => {
    await client.deleteSession();
  });

  it("drags, clamps, persists, and restores the desktop sidebar width", async () => {
    const windowId = await getCurrentWindowId(client);
    await client.waitForElement(RESIZE_HANDLE_SELECTOR, 2_000);
    await waitForSidebarWidth(client, 260);

    await dragSidebarHandleToWidth(client, 360);
    await waitForSidebarWidth(client, 360);
    await waitForPersistedSidebarWidth(client, windowId, 360);

    await dragSidebarHandleToWidth(client, 50);
    await waitForSidebarWidth(client, 220);
    await waitForPersistedSidebarWidth(client, windowId, 220);

    await dragSidebarHandleToWidth(client, 600);
    await waitForSidebarWidth(client, 420);
    await waitForPersistedSidebarWidth(client, windowId, 420);

    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await waitForSidebarWidth(client, 420);
    expect(await getPersistedSidebarWidth(client, windowId)).toBe(420);
  });
});
