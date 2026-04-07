import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const warningToastMock = vi.fn();
const errorToastMock = vi.fn();
const eventListeners = new Map<string, ((event: any) => void)[]>();

interface PendingWrite {
  data: string | Uint8Array;
  callback?: () => void;
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  buffer = {
    active: {
      viewportY: 0,
      getLine: () => null,
    },
  };
  element: HTMLElement | null = null;
  pendingStringWrites: PendingWrite[] = [];
  reset = vi.fn();
  loadAddon = vi.fn();
  open = vi.fn((element: HTMLElement) => {
    this.element = element;
  });
  attachCustomKeyEventHandler = vi.fn();
  onData = vi.fn();
  onResize = vi.fn();
  registerLinkProvider = vi.fn();
  getSelection = vi.fn(() => "");
  scrollToLine = vi.fn();
  dispose = vi.fn();
  write = vi.fn((data: string | Uint8Array, callback?: () => void) => {
    if (typeof data === "string") {
      this.pendingStringWrites.push({ data, callback });
      return;
    }
    callback?.();
  });

  flushNextStringWrite() {
    const pending = this.pendingStringWrites.shift();
    pending?.callback?.();
  }
}

const terminals: FakeTerminal[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => {
    const terminal = new FakeTerminal();
    terminals.push(terminal);
    return terminal;
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {},
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../tauri-mock", () => ({
  isTauri: false,
  mockInvoke: invokeMock,
  mockListen: listenMock,
}));

vi.mock("./useToast", () => ({
  useToast: () => ({
    warning: warningToastMock,
    error: errorToastMock,
  }),
}));

vi.mock("../i18n", () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}));

describe("useTerminal", () => {
  beforeEach(() => {
    if (!("SVGElement" in globalThis)) {
      // happy-dom preload does not currently expose this global.
      // Vue runtime-dom checks it during mount.
      // @ts-expect-error test shim
      globalThis.SVGElement = class SVGElement {};
    }
    if (!("Element" in globalThis)) {
      // @ts-expect-error test shim
      globalThis.Element = window.Element;
    }
    invokeMock.mockReset();
    listenMock.mockReset();
    warningToastMock.mockReset();
    errorToastMock.mockReset();
    eventListeners.clear();
    terminals.length = 0;
    listenMock.mockImplementation(async (eventName: string, handler: (event: any) => void) => {
      const listeners = eventListeners.get(eventName) ?? [];
      listeners.push(handler);
      eventListeners.set(eventName, listeners);
      return () => {
        const current = eventListeners.get(eventName) ?? [];
        eventListeners.set(
          eventName,
          current.filter((listener) => listener !== handler),
        );
      };
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 1,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    listenMock.mockReset();
    eventListeners.clear();
    warningToastMock.mockReset();
    errorToastMock.mockReset();
    vi.clearAllMocks();
  });

  it("restores recovery state before attaching the live session", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 7,
        };
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toContain("get_session_recovery_state");
    expect(callOrder).not.toContain("attach_session");
    expect(terminal.reset).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("restored scrollback", expect.any(Function));

    terminal.flushNextStringWrite();
    await startPromise;

    expect(callOrder).toEqual([
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
      "resize_session",
    ]);
  });

  it("does not respawn a task terminal when the initial attach races session creation", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 7,
        };
      }
      if (cmd === "attach_session") {
        if (spawnFn.mock.calls.length === 0) {
          throw new Error("session not found: session-1");
        }
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();
    await startPromise;

    expect(errorToastMock).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session")).toHaveLength(1);
  });

  it("respawns once when a previously attached task session disappears and daemon_ready fires", async () => {
    let attachCount = 0;
    let resolveSpawn: (() => void) | null = null;
    let spawnCompleted = false;
    const spawnFn = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveSpawn = () => {
            spawnCompleted = true;
            resolve();
          };
        }),
    );
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 7,
        };
      }
      if (cmd === "attach_session") {
        attachCount += 1;
        if (attachCount === 1) {
          return null;
        }
        if (!spawnCompleted) {
          throw new Error("session not found: session-1");
        }
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();
    await startPromise;

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    const daemonReadyListeners = eventListeners.get("daemon_ready") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    expect(daemonReadyListeners).toHaveLength(1);

    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();

    for (let attempt = 0; attempt < 10 && spawnFn.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    daemonReadyListeners[0]({ payload: {} });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    resolveSpawn?.();

    for (let attempt = 0; attempt < 10 && invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session").length < 3; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(errorToastMock).toHaveBeenCalledWith("toasts.sessionRespawnedWithScrollback");
  });

  it("applies Copilot recovery before attach and only performs a single resize", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored copilot scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 9,
        };
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toContain("get_session_recovery_state");
    expect(callOrder).not.toContain("attach_session");
    expect(terminal.reset).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("restored copilot scrollback", expect.any(Function));

    terminal.flushNextStringWrite();
    await startPromise;

    expect(callOrder).toEqual([
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
    ]);
  });

  it("reconnects immediately after session_stream_lost for task terminals", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored copilot scrollback",
          cols: 80,
          rows: 24,
          savedAt: 1,
          sequence: 10,
        };
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();
    await startPromise;

    expect(callOrder).toEqual([
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
    ]);

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    const daemonReadyListeners = eventListeners.get("daemon_ready") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    expect(daemonReadyListeners).toHaveLength(1);

    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    terminal.flushNextStringWrite();

    for (let attempt = 0; attempt < 10 && callOrder.length < 6; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual([
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
    ]);
  });

  it("keeps the restored screen when reattach snapshot fetch fails during daemon turnover", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    let recoveryFetchCount = 0;

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "get_session_recovery_state") {
        recoveryFetchCount += 1;
        if (recoveryFetchCount === 1) {
          return {
            serialized: "restored copilot scrollback",
            cols: 80,
            rows: 24,
            savedAt: 1,
            sequence: 11,
          };
        }
        throw new Error("failed to write command: Broken pipe (os error 32)");
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();
    await startPromise;
    expect(terminal.reset).toHaveBeenCalledTimes(1);

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && callOrder.length < 6; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual([
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
      "get_session_recovery_state",
      "attach_session",
      "resize_session",
    ]);
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });
});
