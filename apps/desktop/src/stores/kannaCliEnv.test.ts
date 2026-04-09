import { describe, expect, it } from "bun:test";
import { buildKannaCliEnv } from "./kannaCliEnv";

describe("buildKannaCliEnv", () => {
  it("passes only private kanna-cli db info and avoids public db env names", () => {
    expect(
      buildKannaCliEnv({
        taskId: "task-123",
        dbName: "kanna-wt-task-123.db",
        appDataDir: "/Users/test/Library/Application Support/com.kanna.app",
        socketPath: "/tmp/kanna.sock",
      }),
    ).toEqual({
      KANNA_TASK_ID: "task-123",
      KANNA_CLI_DB_PATH: "/Users/test/Library/Application Support/com.kanna.app/kanna-wt-task-123.db",
      KANNA_SOCKET_PATH: "/tmp/kanna.sock",
    });
  });
});
