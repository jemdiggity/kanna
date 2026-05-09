import { describe, expect, it } from "vitest";
import { resolvePorts } from "../src/ports";

describe("resolvePorts", () => {
  it("prefers env over config over defaults", () => {
    const ports = resolvePorts({
      env: { KANNA_DEV_PORT: "1555" },
      configPorts: {
        KANNA_DEV_PORT: 1420,
        KANNA_FIREBASE_AUTH_PORT: 9099,
        KANNA_IOS_WDA_PORT: 4730
      }
    });

    expect(ports.KANNA_DEV_PORT).toBe(1555);
    expect(ports.KANNA_FIREBASE_AUTH_PORT).toBe(9099);
    expect(ports.KANNA_IOS_WDA_PORT).toBe(4730);
    expect(ports.KANNA_MOBILE_PORT).toBe(8081);
  });

  it("rejects config fallback for declared ports in a Kanna-provided env", () => {
    expect(() =>
      resolvePorts({
        env: {
          KANNA_TASK_ID: "task-123",
          KANNA_SOCKET_PATH: "/tmp/kanna.sock",
          KANNA_APPIUM_PORT: "4737"
        },
        configPorts: {
          KANNA_APPIUM_PORT: 4723,
          KANNA_IOS_WDA_PORT: 4724
        }
      })
    ).toThrow("KANNA_IOS_WDA_PORT");
  });

  it("rejects non-integer env ports", () => {
    expect(() =>
      resolvePorts({
        env: { KANNA_DEV_PORT: "abc" },
        configPorts: {}
      })
    ).toThrow("KANNA_DEV_PORT must be an integer port");
  });
});
