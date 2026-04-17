import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSessionRecoveryState,
  shouldApplyRecoverySnapshot,
} from "./sessionRecoveryState";

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("../invoke", () => ({
  invoke: invokeMock,
}));

describe("shouldApplyRecoverySnapshot", () => {
  it("accepts a snapshot when geometry matches", () => {
    expect(
      shouldApplyRecoverySnapshot(
        {
          serialized: "cached",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 2,
          cursorVisible: true,
          savedAt: 1,
          sequence: 2,
        },
        { cols: 80, rows: 24 },
      ),
    ).toBe(true);
  });

  it("rejects a snapshot when geometry mismatches", () => {
    expect(
      shouldApplyRecoverySnapshot(
        {
          serialized: "cached",
          cols: 120,
          rows: 24,
          cursorRow: 1,
          cursorCol: 2,
          cursorVisible: true,
          savedAt: 1,
          sequence: 2,
        },
        { cols: 80, rows: 24 },
      ),
    ).toBe(false);
  });

  it("allows restore before fitted geometry is available", () => {
    expect(
      shouldApplyRecoverySnapshot(
        {
          serialized: "cached",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 2,
          cursorVisible: true,
          savedAt: 1,
          sequence: 2,
        },
        { cols: 0, rows: 0 },
      ),
    ).toBe(true);
  });
});

describe("loadSessionRecoveryState", () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it("returns null when the Tauri command returns null", async () => {
    invokeMock.mockResolvedValue(null);
    await expect(loadSessionRecoveryState("missing")).resolves.toBeNull();
  });

  it("rejects snapshots that do not include cursor fields", async () => {
    invokeMock.mockResolvedValue({
      serialized: "cached",
      cols: 80,
      rows: 24,
      savedAt: 1,
      sequence: 2,
    });

    await expect(loadSessionRecoveryState("missing-cursor")).resolves.toBeNull();
  });

  it("returns a snapshot when the payload includes cursor metadata", async () => {
    invokeMock.mockResolvedValue({
      serialized: "cached",
      cols: 80,
      rows: 24,
      cursorRow: 1,
      cursorCol: 2,
      cursorVisible: false,
      savedAt: 123,
      sequence: 7,
    });

    await expect(loadSessionRecoveryState("with-cursor")).resolves.toEqual({
      serialized: "cached",
      cols: 80,
      rows: 24,
      cursorRow: 1,
      cursorCol: 2,
      cursorVisible: false,
      savedAt: 123,
      sequence: 7,
    });
  });
});
