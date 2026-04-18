import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mobileRoot = path.resolve(__dirname, "..");

describe("mobile Expo entrypoint", () => {
  it("uses a local index entry instead of expo/AppEntry", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(mobileRoot, "package.json"), "utf8")
    ) as { main?: string };

    expect(packageJson.main).toBe("index.js");
  });

  it("registers the app from the local App module", () => {
    const entrySource = readFileSync(path.join(mobileRoot, "index.js"), "utf8");

    expect(entrySource).toContain("registerRootComponent");
    expect(entrySource).toContain('./App');
  });
});
