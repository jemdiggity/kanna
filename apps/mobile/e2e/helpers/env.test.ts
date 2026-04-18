import { describe, expect, it } from "vitest";
import { resolveRequiredMobileE2eEnv } from "./env";

describe("resolveRequiredMobileE2eEnv", () => {
  it("throws a clear error when KANNA_APPIUM_PORT is missing", () => {
    expect(() =>
      resolveRequiredMobileE2eEnv({
        EXPO_PUBLIC_KANNA_SERVER_URL: "http://127.0.0.1:48120"
      })
    ).toThrow("KANNA_APPIUM_PORT");
  });

  it("parses the appium port and server URL", () => {
    expect(
      resolveRequiredMobileE2eEnv({
        KANNA_APPIUM_PORT: "4723",
        EXPO_PUBLIC_KANNA_SERVER_URL: "http://127.0.0.1:48120"
      })
    ).toMatchObject({
      appiumPort: 4723,
      bundleId: "com.anonymous.kanna-mobile",
      desktopServerUrl: "http://127.0.0.1:48120"
    });
  });
});
