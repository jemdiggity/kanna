import { describe, expect, it } from "vitest";
import { formatTaskPortAllocationLog } from "./portAllocationLog";

describe("formatTaskPortAllocationLog", () => {
  it("includes requested and assigned ports for each env", () => {
    expect(formatTaskPortAllocationLog("task-123", [
      {
        envName: "KANNA_DEV_PORT",
        requestedPort: 1420,
        assignedPort: 1421,
        reusedExisting: false,
      },
      {
        envName: "KANNA_RELAY_PORT",
        requestedPort: 7555,
        assignedPort: 7555,
        reusedExisting: true,
      },
    ])).toBe(
      "[store] task ports reserved: item=task-123 KANNA_DEV_PORT requested=1420 assigned=1421 reused=false, KANNA_RELAY_PORT requested=7555 assigned=7555 reused=true",
    );
  });
});
