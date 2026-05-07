import { describe, expect, it } from "vitest";
import { resolvePorts } from "../src/ports";

describe("resolvePorts", () => {
  it("prefers env over config over defaults", () => {
    const ports = resolvePorts({
      env: { KANNA_DEV_PORT: "1555" },
      configPorts: { KANNA_DEV_PORT: 1420, KANNA_FIREBASE_AUTH_PORT: 9099 }
    });

    expect(ports.KANNA_DEV_PORT).toBe(1555);
    expect(ports.KANNA_FIREBASE_AUTH_PORT).toBe(9099);
    expect(ports.KANNA_MOBILE_PORT).toBe(8081);
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
