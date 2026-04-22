import { describe, expect, it } from "vitest";

import { APP_DB_NAME_SCRIPT, APP_READY_SCRIPT } from "./appReady";

function runAppReadyScript(windowValue: unknown): boolean {
  const execute = new Function("window", `return ${APP_READY_SCRIPT};`) as (windowArg: unknown) => boolean;
  return execute(windowValue);
}

function runDbNameScript(windowValue: unknown): string | null {
  const execute = new Function("window", `return ${APP_DB_NAME_SCRIPT};`) as (
    windowArg: unknown,
  ) => string | null;
  return execute(windowValue);
}

describe("APP_READY_SCRIPT", () => {
  it("checks the explicit top-level e2e ready flag", () => {
    expect(APP_READY_SCRIPT).toContain("window.__KANNA_E2E__");
    expect(APP_READY_SCRIPT).toContain("ready");
  });

  it("stays false until the app signals readiness", () => {
    expect(
      runAppReadyScript({
        __KANNA_E2E__: {
          ready: false,
        },
      })
    ).toBe(false);
  });

  it("returns true once the app signals readiness", () => {
    expect(
      runAppReadyScript({
        __KANNA_E2E__: {
          ready: true,
          dbName: "kanna-test.db",
        },
      })
    ).toBe(true);
  });
});

describe("APP_DB_NAME_SCRIPT", () => {
  it("reads the top-level db name from the e2e hook", () => {
    expect(
      runDbNameScript({
        __KANNA_E2E__: {
          dbName: "kanna-test.db",
        },
      })
    ).toBe("kanna-test.db");
  });

  it("returns null when the db name is not available", () => {
    expect(
      runDbNameScript({
        __KANNA_E2E__: {},
      })
    ).toBeNull();
  });
});
