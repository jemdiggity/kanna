import { describe, expect, it } from "vitest";
import { buildKannaCliEnv, buildTaskRuntimeEnv, resolveKannaServerBaseUrl } from "./kannaCliEnv";

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

  it("does not point kanna-cli at a task-scoped mobile server port", () => {
    expect(
      buildTaskRuntimeEnv({
        taskId: "task-123",
        dbName: "kanna-v2.db",
        appDataDir: "/Users/test/Library/Application Support/build.kanna",
        socketPath: "/tmp/kanna.sock",
        portEnv: {
          KANNA_DEV_PORT: "1421",
          KANNA_MOBILE_SERVER_PORT: "48121",
        },
        kannaCliPath: "/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin",
      }),
    ).toEqual({
      KANNA_WORKTREE: "1",
      KANNA_DEV_PORT: "1421",
      KANNA_MOBILE_SERVER_PORT: "48121",
      KANNA_CLI_PATH: "/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin",
      KANNA_TASK_ID: "task-123",
      KANNA_CLI_DB_PATH: "/Users/test/Library/Application Support/build.kanna/kanna-v2.db",
      KANNA_SOCKET_PATH: "/tmp/kanna.sock",
    });
  });
});

describe("resolveKannaServerBaseUrl", () => {
  it("uses the app process mobile server port when present", () => {
    expect(resolveKannaServerBaseUrl("48129")).toBe("http://127.0.0.1:48129");
  });

  it("omits the server URL when the app has no mobile server port override", () => {
    expect(resolveKannaServerBaseUrl(null)).toBeUndefined();
  });

  it("omits the server URL when the app uses the production mobile server port", () => {
    expect(resolveKannaServerBaseUrl("48120")).toBeUndefined();
  });
});
