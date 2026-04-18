import { describe, expect, it } from "vitest";
import {
  buildExpoStartCommand,
  extractEnvVarFromCommandLine,
  shouldReuseExpoServer
} from "./metro";

describe("mobile Metro helpers", () => {
  it("extracts Expo public env vars from a ps command line", () => {
    expect(
      extractEnvVarFromCommandLine(
        "node expo EXPO_PUBLIC_KANNA_SERVER_URL=http://192.168.1.5:48129 KANNA_MOBILE_PORT=8081"
      )
    ).toMatchObject({
      EXPO_PUBLIC_KANNA_SERVER_URL: "http://192.168.1.5:48129",
      KANNA_MOBILE_PORT: "8081"
    });
  });

  it("reuses an Expo server from the same project root and desktop target", () => {
    expect(
      shouldReuseExpoServer(
        {
          commandLine:
            "node expo start EXPO_PUBLIC_KANNA_SERVER_URL=http://192.168.1.5:48129",
          cwd: "/tmp/kanna/apps/mobile"
        },
        {
          desktopServerUrl: "http://192.168.1.5:48129",
          projectRoot: "/tmp/kanna/apps/mobile"
        }
      )
    ).toBe(true);
  });

  it("restarts an Expo server when it targets a different desktop URL", () => {
    expect(
      shouldReuseExpoServer(
        {
          commandLine:
            "node expo start EXPO_PUBLIC_KANNA_SERVER_URL=http://192.168.1.5:48120",
          cwd: "/tmp/kanna/apps/mobile"
        },
        {
          desktopServerUrl: "http://192.168.1.5:48129",
          projectRoot: "/tmp/kanna/apps/mobile"
        }
      )
    ).toBe(false);
  });

  it("builds a non-interactive Expo start command for the selected port", () => {
    expect(buildExpoStartCommand(1430)).toEqual([
      "pnpm",
      "exec",
      "expo",
      "start",
      "--port",
      "1430"
    ]);
  });
});
