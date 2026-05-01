import { describe, expect, it } from "vitest";
import { createInstanceConfig } from "./runConfig";

describe("createInstanceConfig", () => {
  it("uses the explicit daemon dir for both start and stop commands", () => {
    const config = createInstanceConfig({
      daemonDir: "/tmp/e2e-daemon",
      dbName: "test-task-primary.db",
      devPortEnvValue: 1421,
      env: {},
      effectiveWebDriverPort: 4445,
      sessionName: "kanna-e2e-test-session",
      transferPortEnvValue: 48121,
      webDriverPortEnvValue: 4445,
    });

    expect(config.startCommand).toEqual([
      "./scripts/dev.sh",
      "start",
      "--db",
      "test-task-primary.db",
      "--delete-db",
      "--daemon-dir",
      "/tmp/e2e-daemon",
      "--transfer-root",
      "/tmp/e2e-daemon/transfer-root",
    ]);
    expect(config.stopCommand).toEqual([
      "./scripts/dev.sh",
      "stop",
      "--kill-daemon",
      "--daemon-dir",
      "/tmp/e2e-daemon",
    ]);
  });
});
