import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@kanna/db": path.resolve(__dirname, "../../packages/db/src"),
      "@kanna/core": path.resolve(__dirname, "../../packages/core/src"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/composables/test-setup.ts"],
  },
});
