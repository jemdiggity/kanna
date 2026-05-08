import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfig } from "vite";
import viteConfig from "../vite.config";

interface PackageExportEntry {
  import?: string;
}

interface PierreDiffsPackageJson {
  exports: Record<string, PackageExportEntry | string>;
}

interface ViteConfigFactory {
  (env: ConfigEnv): UserConfig | Promise<UserConfig>;
}

function isViteConfigFactory(value: unknown): value is ViteConfigFactory {
  return typeof value === "function";
}

async function loadDesktopViteConfig(): Promise<UserConfig> {
  const exportedConfig: unknown = viteConfig;
  if (isViteConfigFactory(exportedConfig)) {
    return await exportedConfig({
      command: "serve",
      mode: "development",
      isSsrBuild: false,
      isPreview: false,
    });
  }
  return await Promise.resolve(exportedConfig as UserConfig);
}

function resolvePierreDiffsPortableWorkerDir(): string {
  const packageRoot = realpathSync("node_modules/@pierre/diffs");
  const packageJson = JSON.parse(
    readFileSync("node_modules/@pierre/diffs/package.json", "utf8"),
  ) as PierreDiffsPackageJson;
  const workerExport = packageJson.exports["./worker/worker-portable.js"];
  const workerPath = typeof workerExport === "string" ? workerExport : workerExport.import;
  if (!workerPath) {
    throw new Error("@pierre/diffs does not export worker-portable.js");
  }
  return dirname(resolve(packageRoot, workerPath));
}

describe("desktop Vite config", () => {
  it("allows Vite to serve the resolved @pierre/diffs portable worker directory", async () => {
    const config = await loadDesktopViteConfig();
    const workerDir = resolvePierreDiffsPortableWorkerDir();

    expect(config.server?.fs?.allow).toContain(workerDir);
    expect(config.server?.fs?.allow).not.toContain(homedir());
  });
});
