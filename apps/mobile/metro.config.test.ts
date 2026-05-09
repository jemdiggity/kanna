import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface MetroConfig {
  resolver: {
    extraNodeModules: Record<string, string>;
    unstable_enableSymlinks: boolean;
    resolveRequest: (
      context: {
        originModulePath?: string;
        resolveRequest: MetroConfig["resolver"]["resolveRequest"];
      },
      moduleName: string,
      platform: string | null
    ) => { type: string; filePath: string };
  };
  transformer: {
    minifierPath: string;
  };
  watchFolders: string[];
}

describe("metro config", () => {
  it("uses an app-resolvable Metro minifier path", () => {
    const config = require("./metro.config.js") as MetroConfig;

    expect(config.transformer.minifierPath).toContain("metro-minify-terser");
    expect(require.resolve(config.transformer.minifierPath)).toBe(
      config.transformer.minifierPath
    );
  });

  it("maps Babel runtime for Expo sources resolved from the pnpm store", () => {
    const config = require("./metro.config.js") as MetroConfig;

    expect(config.resolver.extraNodeModules["@babel/runtime"]).toContain("@babel/runtime");
    expect(config.watchFolders).toContain(config.resolver.extraNodeModules["@babel/runtime"]);
  });

  it("enables symlink resolution for pnpm-linked app dependencies", () => {
    const config = require("./metro.config.js") as MetroConfig;

    expect(config.resolver.unstable_enableSymlinks).toBe(true);
  });

  it("maps Expo runtime dependencies imported by Expo store sources", () => {
    const config = require("./metro.config.js") as MetroConfig;

    for (const moduleName of ["expo-asset", "expo-constants", "expo-modules-core"]) {
      expect(config.resolver.extraNodeModules[moduleName]).toContain(
        `apps/mobile/node_modules/${moduleName}`
      );
      expect(config.watchFolders.some((folder) => folder.includes(moduleName))).toBe(true);
    }
  });

  it("resolves Babel runtime helper subpaths from watched app node_modules", () => {
    const config = require("./metro.config.js") as MetroConfig;
    const fallback = () => {
      throw new Error("fallback resolver should not be called");
    };

    expect(
      config.resolver.resolveRequest(
        { resolveRequest: fallback },
        "@babel/runtime/helpers/interopRequireDefault",
        "ios"
      )
    ).toMatchObject({
      type: "sourceFile",
      filePath: expect.stringContaining(
        "@babel/runtime/helpers/interopRequireDefault.js"
      )
    });
  });

  it("resolves Expo runtime modules from the app module graph", () => {
    const config = require("./metro.config.js") as MetroConfig;
    const fallback = () => {
      throw new Error("fallback resolver should not be called");
    };

    for (const moduleName of ["expo-asset", "expo-constants", "expo-modules-core"]) {
      expect(
        config.resolver.resolveRequest({ resolveRequest: fallback }, moduleName, "ios")
      ).toMatchObject({
        type: "sourceFile",
        filePath: expect.stringContaining(moduleName)
      });
    }
  });

  it("resolves pnpm-linked app runtime dependencies from the app module graph", () => {
    const config = require("./metro.config.js") as MetroConfig;
    const fallback = () => {
      throw new Error("fallback resolver should not be called");
    };

    expect(
      config.resolver.resolveRequest({ resolveRequest: fallback }, "react", "ios")
    ).toMatchObject({
      type: "sourceFile",
      filePath: expect.stringContaining("react")
    });
    expect(
      config.resolver.resolveRequest(
        { resolveRequest: fallback },
        "react/jsx-runtime",
        "ios"
      )
    ).toMatchObject({
      type: "sourceFile",
      filePath: expect.stringContaining("react")
    });
  });

  it("resolves pnpm-linked transitive dependencies from the importing package", () => {
    const config = require("./metro.config.js") as MetroConfig;
    const fallback = () => {
      throw new Error("fallback resolver should not be called");
    };

    expect(
      config.resolver.resolveRequest(
        {
          originModulePath: require.resolve("react-native"),
          resolveRequest: fallback
        },
        "invariant",
        "ios"
      )
    ).toMatchObject({
      type: "sourceFile",
      filePath: expect.stringContaining("invariant")
    });
    expect(config.watchFolders.some((folder) => folder.includes("/pnpm/store/"))).toBe(
      true
    );
  });

  it("falls back to Metro for modules outside the explicit app-owned set", () => {
    const config = require("./metro.config.js") as MetroConfig;
    const fallback = (_context: unknown, moduleName: string) => ({
      type: "sourceFile",
      filePath: `/resolved/${moduleName}.js`
    });

    expect(
      config.resolver.resolveRequest(
        { resolveRequest: fallback as MetroConfig["resolver"]["resolveRequest"] },
        "not-an-app-owned-module",
        "ios"
      )
    ).toMatchObject({
      type: "sourceFile",
      filePath: "/resolved/not-an-app-owned-module.js"
    });
  });

  it("allows babel-preset-expo to resolve its Babel peer dependency", () => {
    const presetRequire = createRequire(require.resolve("babel-preset-expo"));

    expect(presetRequire.resolve("@babel/core")).toContain("@babel/core");
    expect(presetRequire.resolve("@babel/types")).toContain("@babel/types");
    expect(presetRequire.resolve("expo/config")).toContain("expo");
    expect(createRequire(require.resolve("expo")).resolve("expo-modules-core")).toContain(
      "expo-modules-core"
    );
  });
});
