import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Read port from .env.local at repo root (written by Kanna worktree setup)
let port = 1420;
for (const dir of [__dirname, path.resolve(__dirname, "../..") ]) {
  try {
    const envLocal = fs.readFileSync(path.join(dir, ".env.local"), "utf-8");
    const match = envLocal.match(/KANNA_DEV_PORT=(\d+)/);
    if (match) { port = parseInt(match[1], 10); break; }
  } catch {}
}
// @ts-expect-error process is a nodejs global
if (process.env.KANNA_DEV_PORT) port = parseInt(process.env.KANNA_DEV_PORT, 10);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  worker: {
    format: "es" as const,
  },

  resolve: {
    alias: {
      "@kanna/db": path.resolve(__dirname, "../../packages/db/src"),
      "@kanna/core": path.resolve(__dirname, "../../packages/core/src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
