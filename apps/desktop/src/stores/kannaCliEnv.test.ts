import { describe, expect, it } from "vitest";
import { buildKannaCliEnv, buildTaskRuntimeEnv } from "./kannaCliEnv";

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

describe("buildTaskRuntimeEnv", () => {
  it("includes task-scoped worktree, port, and kanna-cli env", () => {
    expect(
      buildTaskRuntimeEnv({
        taskId: "task-123",
        dbName: "kanna-wt-task-123.db",
        appDataDir: "/Users/test/Library/Application Support/com.kanna.app",
        socketPath: "/tmp/kanna.sock",
        serverBaseUrl: "http://127.0.0.1:48120",
        portEnv: {
          KANNA_DEV_PORT: "1421",
          API_PORT: "3001",
        },
        kannaCliPath: "/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin",
      }),
    ).toEqual({
      KANNA_WORKTREE: "1",
      KANNA_DEV_PORT: "1421",
      API_PORT: "3001",
      KANNA_CLI_PATH: "/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin",
      KANNA_TASK_ID: "task-123",
      KANNA_CLI_DB_PATH: "/Users/test/Library/Application Support/com.kanna.app/kanna-wt-task-123.db",
      KANNA_SOCKET_PATH: "/tmp/kanna.sock",
      KANNA_SERVER_BASE_URL: "http://127.0.0.1:48120",
    });
  });
});
