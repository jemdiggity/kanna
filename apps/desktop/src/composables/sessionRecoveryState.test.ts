import { describe, expect, it } from "vitest";
import {
  loadSessionRecoveryState,
  shouldApplyRecoverySnapshot,
} from "./sessionRecoveryState";

describe("shouldApplyRecoverySnapshot", () => {
  it("accepts a snapshot when geometry matches", () => {
    expect(
      shouldApplyRecoverySnapshot(
        { serialized: "cached", cols: 80, rows: 24, savedAt: 1, sequence: 2 },
        { cols: 80, rows: 24 },
      ),
    ).toBe(true);
  });

  it("rejects a snapshot when geometry mismatches", () => {
    expect(
      shouldApplyRecoverySnapshot(
        { serialized: "cached", cols: 120, rows: 24, savedAt: 1, sequence: 2 },
        { cols: 80, rows: 24 },
      ),
    ).toBe(false);
  });

  it("allows restore before fitted geometry is available", () => {
    expect(
      shouldApplyRecoverySnapshot(
        { serialized: "cached", cols: 80, rows: 24, savedAt: 1, sequence: 2 },
        { cols: 0, rows: 0 },
      ),
    ).toBe(true);
  });
});

describe("loadSessionRecoveryState", () => {
  it("returns null when the Tauri command returns null", async () => {
    await expect(loadSessionRecoveryState("missing")).resolves.toBeNull();
  });
});
