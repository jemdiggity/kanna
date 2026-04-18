import { describe, expect, it } from "vitest";
import { emulatorPorts } from "../src/types";

describe("firebase emulator configuration", () => {
  it("exposes the expected emulator ports for auth, firestore, and functions", () => {
    expect(emulatorPorts).toEqual({
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    });
  });
});
