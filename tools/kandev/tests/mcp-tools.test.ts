import { describe, expect, it } from "vitest";
import { buildMcpToolDefinitions } from "../src/mcp/tool-registry";

describe("MCP tool registry", () => {
  it("exposes high-value kandev tools", () => {
    expect(buildMcpToolDefinitions().map((tool) => tool.name)).toEqual([
      "dev_up",
      "dev_down",
      "dev_status",
      "dev_log",
      "dev_seed",
      "emulators_up",
      "emulators_down",
      "emulators_status",
      "daemon_kill",
      "mobile_device_smoke",
      "doctor"
    ]);
  });
});
