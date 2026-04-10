import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/e2e/preload.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
