// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TerminalView from "../TerminalView.vue";

const markTaskSwitchMountedMock = vi.fn();
const markTaskSwitchReadyMock = vi.fn();
const useTerminalMock = vi.fn(() => ({
  terminal: ref({ focus: focusMock }),
  init: initMock,
  startListening: startListeningMock,
  fit: fitMock,
  fitDeferred: fitDeferredMock,
  redraw: redrawMock,
  ensureConnected: ensureConnectedMock,
  dispose: disposeMock,
}));

const focusMock = vi.fn();
const initMock = vi.fn();
const startListeningMock = vi.fn(async () => {});
const fitMock = vi.fn();
const fitDeferredMock = vi.fn();
const redrawMock = vi.fn();
const ensureConnectedMock = vi.fn(async () => {});
const disposeMock = vi.fn();
const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

async function flushLifecycle() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

vi.mock("../../composables/useTerminal", () => ({
  useTerminal: (...args: unknown[]) => useTerminalMock(...args),
}));

vi.mock("../../composables/terminalSessionRecovery", () => ({
  shouldDelayConnectUntilAfterInitialLayout: () => false,
}));

vi.mock("../../perf/taskSwitchPerf", () => ({
  markTaskSwitchMounted: (...args: unknown[]) => markTaskSwitchMountedMock(...args),
  markTaskSwitchReady: (...args: unknown[]) => markTaskSwitchReadyMock(...args),
}));

describe("TerminalView", () => {
  beforeEach(() => {
    useTerminalMock.mockClear();
    focusMock.mockReset();
    initMock.mockReset();
    startListeningMock.mockReset();
    fitMock.mockReset();
    fitDeferredMock.mockReset();
    redrawMock.mockReset();
    ensureConnectedMock.mockReset();
    disposeMock.mockReset();
    markTaskSwitchMountedMock.mockReset();
    markTaskSwitchReadyMock.mockReset();

    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    } as typeof ResizeObserver;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("focuses the active terminal on first mount", async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: {
        sessionId: "session-1",
        active: true,
        agentTerminal: true,
      },
    });

    await flushLifecycle();

    expect(useTerminalMock).toHaveBeenCalledWith(
      "session-1",
      undefined,
      expect.objectContaining({ agentTerminal: true }),
    );
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(startListeningMock).toHaveBeenCalledTimes(1);
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(markTaskSwitchMountedMock).toHaveBeenCalledWith("session-1");
    expect(markTaskSwitchReadyMock).toHaveBeenCalledWith("session-1", "cold");

    wrapper.unmount();
  });

  it("does not steal focus while a modal is open", async () => {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    document.body.appendChild(modal);

    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: {
        sessionId: "session-1",
        active: true,
      },
    });

    await flushLifecycle();

    expect(focusMock).not.toHaveBeenCalled();

    wrapper.unmount();
    modal.remove();
  });
});
