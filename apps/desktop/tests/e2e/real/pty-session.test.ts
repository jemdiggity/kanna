import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { dismissStartupShortcutsModal } from "../helpers/startupOverlays";
import { submitTaskFromUi } from "../helpers/newTaskFlow";
import { nudgeTerminalTrustPrompt, sendKeysToActiveTerminal } from "../helpers/terminalInput";
import { waitForTaskCreated } from "../helpers/taskCreation";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { callVueMethod, execDb, getVueState, tauriInvoke } from "../helpers/vue";

interface WebDriverErrorValue {
  error?: string;
  message?: string;
}

interface WebDriverResponse<T> {
  value: T | WebDriverErrorValue;
}

interface TerminalBufferStats {
  matchingLineCount: number;
  firstMatchingLine: string | null;
  lastMatchingLine: string | null;
}

function getClientSessionId(client: WebDriverClient): string {
  const state = client as unknown as { sessionId?: string | null };
  if (!state.sessionId) {
    throw new Error("No WebDriver session. Call createSession() first.");
  }
  return state.sessionId;
}

async function getWindowHandles(client: WebDriverClient): Promise<string[]> {
  const sessionId = getClientSessionId(client);
  const response = await fetch(
    `${client.getBaseUrl()}/session/${sessionId}/window/handles`,
  );
  const body = await response.json() as WebDriverResponse<string[]>;
  if (
    typeof body.value === "object" &&
    body.value !== null &&
    "error" in body.value
  ) {
    throw new Error(`WebDriver error: ${body.value.message ?? "unknown error"}`);
  }
  return Array.isArray(body.value) ? body.value : [];
}

async function switchToWindow(client: WebDriverClient, handle: string): Promise<void> {
  const sessionId = getClientSessionId(client);
  const response = await fetch(`${client.getBaseUrl()}/session/${sessionId}/window`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handle }),
  });
  const body = await response.json() as WebDriverResponse<null>;
  if (
    typeof body.value === "object" &&
    body.value !== null &&
    "error" in body.value
  ) {
    throw new Error(`WebDriver error: ${body.value.message ?? "unknown error"}`);
  }
}

async function waitForWindowCount(
  client: WebDriverClient,
  count: number,
  timeoutMs = 10_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handles = await getWindowHandles(client);
    if (handles.length === count) {
      return handles;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${count} windows.`);
}

async function setSelectedItem(client: WebDriverClient, itemId: string): Promise<void> {
  await callVueMethod(client, "store.selectItem", itemId);
}

async function waitForCurrentItemId(
  client: WebDriverClient,
  itemId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentItem = await getVueState(client, "currentItem") as { id?: string | null } | null;
    if (currentItem?.id === itemId) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for current item ${itemId}`);
}

async function closeFocusedWindowThroughAppAction(client: WebDriverClient): Promise<void> {
  const result = await client.executeAsync(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     setTimeout(() => {
       void Promise.resolve(ctx.keyboardActions?.closeWindow?.() ?? ctx.windowWorkspace.closeWindow())
         .catch((error) => console.error("[e2e] close focused window failed", error));
     }, 0);
     cb("scheduled");`,
  );
  if (
    typeof result === "object" &&
    result !== null &&
    "__error" in result
  ) {
    throw new Error(String((result as { __error: unknown }).__error));
  }
}

async function invokeOrThrow(
  client: WebDriverClient,
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await tauriInvoke(client, cmd, args);
  if (
    typeof result === "object" &&
    result !== null &&
    "__error" in result
  ) {
    throw new Error(String((result as { __error: unknown }).__error));
  }
  return result;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForTerminalBufferText(
  client: WebDriverClient,
  sessionId: string,
  text: string,
  timeoutMs = 10_000,
): Promise<TerminalBufferStats> {
  const deadline = Date.now() + timeoutMs;
  const pattern = escapeRegExp(text);
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const stats = await client.executeSync<TerminalBufferStats>(
        `const hook = window.__KANNA_E2E__?.terminalBuffers;
         if (!hook) throw new Error("terminal buffer hook unavailable");
         return hook.stats(${JSON.stringify(sessionId)}, new RegExp(${JSON.stringify(pattern)}));`,
      );
      if (stats.matchingLineCount > 0) {
        return stats;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }

  throw new Error(
    `Timed out waiting for terminal buffer text "${text}" in ${sessionId}: ${String(lastError)}`,
  );
}

describe("pty session (real CLI)", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";
  let repoId = "";
  let deterministicSessionId = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);
    testRepoPath = await createFixtureRepo("claude-real-test");
    repoId = await importTestRepo(client, testRepoPath, "claude-real-test");
  });

  afterAll(async () => {
    if (deterministicSessionId) {
      await invokeOrThrow(client, "kill_session", { sessionId: deterministicSessionId }).catch(() => undefined);
    }
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
      await cleanupFixtureRepos([testRepoPath]);
    }
    await client.deleteSession();
  });

  it("creates a PTY task and renders terminal output", async () => {
    const prompt = "Respond with exactly: E2E_TEST_OK";

    await submitTaskFromUi(client, prompt);

    const task = await waitForTaskCreated(client, prompt);
    expect(task.agent_provider).toBe("codex");
    await nudgeTerminalTrustPrompt(client, {
      initialDelayMs: 5_000,
      attempts: 4,
      intervalMs: 5_000,
    });

    // In PTY mode, output appears in the terminal container
    // Wait for the terminal to have content (xterm.js renders into a canvas)
    const terminal = await client.waitForElement(".terminal-container", 15_000);
    expect(terminal).toBeTruthy();

    // Wait for session to exit — the terminal shows "[Process exited with code X]"
    await sleep(10_000);
    const termText = await client.executeSync<string>(
      `const el = document.querySelector(".xterm-screen");
       return el ? el.textContent : "";`
    );
    // Terminal should have some content from the real agent session
    expect(termText.length).toBeGreaterThan(0);
  });

  it("renders the terminal view for PTY mode", async () => {
    const container = await client.findElement(".terminal-container");
    expect(container).toBeTruthy();
  });

  it("keeps an existing PTY stream alive when a secondary window attaches and detaches", async () => {
    deterministicSessionId = `pty-window-${randomUUID()}`;
    const readyMarker = `KREADY_${randomUUID().replaceAll("-", "")}`;
    const liveMarker = `KLIVE_${randomUUID().replaceAll("-", "")}`;
    const afterDetachMarker = `KAFTER_${randomUUID().replaceAll("-", "")}`;
    const script = [
      `printf '${readyMarker}\\n'`,
      "while IFS= read -r line; do printf 'ECHO:%s\\n' \"$line\"; done",
    ].join("; ");

    await execDb(
      client,
      "INSERT INTO pipeline_item (id, repo_id, prompt, stage, agent_type) VALUES (?, ?, ?, ?, ?)",
      [deterministicSessionId, repoId, "Deterministic PTY echo fixture", "in progress", "pty"],
    );
    await invokeOrThrow(client, "spawn_session", {
      sessionId: deterministicSessionId,
      cwd: testRepoPath,
      executable: "/bin/zsh",
      args: ["-f", "-c", script],
      env: { TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    await callVueMethod(client, "loadItems", repoId);
    await setSelectedItem(client, deterministicSessionId);
    await waitForCurrentItemId(client, deterministicSessionId);
    await waitForTerminalBufferText(client, deterministicSessionId, readyMarker, 15_000);

    const initialHandles = await getWindowHandles(client);
    expect(initialHandles.length).toBeGreaterThanOrEqual(1);
    const sourceHandle = initialHandles[0];

    await client.executeAsync(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       Promise.resolve(
         ctx.windowWorkspace.openWindow({
           selectedRepoId: ${JSON.stringify(repoId)},
           selectedItemId: ${JSON.stringify(deterministicSessionId)},
         })
       ).then(() => cb("ok"))
        .catch((error) => cb({ __error: error?.message ?? String(error) }));`,
    );

    const handles = await waitForWindowCount(client, initialHandles.length + 1);
    const secondHandle = handles.find((handle) => !initialHandles.includes(handle));
    expect(secondHandle).toBeTruthy();

    await switchToWindow(client, secondHandle ?? "");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);
    await waitForCurrentItemId(client, deterministicSessionId);
    await waitForTerminalBufferText(client, deterministicSessionId, readyMarker, 15_000);

    await switchToWindow(client, sourceHandle);
    await client.waitForAppReady();
    await sendKeysToActiveTerminal(client, liveMarker);
    await client.pressKey("\uE007");
    await waitForTerminalBufferText(client, deterministicSessionId, `ECHO:${liveMarker}`, 10_000);

    await switchToWindow(client, secondHandle ?? "");
    await client.waitForAppReady();
    await waitForTerminalBufferText(client, deterministicSessionId, `ECHO:${liveMarker}`, 10_000);

    await closeFocusedWindowThroughAppAction(client);

    const remainingHandles = await waitForWindowCount(client, initialHandles.length);
    expect(remainingHandles).toContain(sourceHandle);
    expect(remainingHandles).not.toContain(secondHandle);

    await switchToWindow(client, sourceHandle);
    await client.waitForAppReady();
    await sendKeysToActiveTerminal(client, afterDetachMarker);
    await client.pressKey("\uE007");

    const afterDetachStats = await waitForTerminalBufferText(
      client,
      deterministicSessionId,
      `ECHO:${afterDetachMarker}`,
      10_000,
    );
    expect(afterDetachStats.lastMatchingLine).toContain(afterDetachMarker);
  });
});
