import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "bin/kd": "src/bin/kd.ts",
    "bin/kandev-mcp": "src/bin/kandev-mcp.ts"
  },
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  dts: false
});
