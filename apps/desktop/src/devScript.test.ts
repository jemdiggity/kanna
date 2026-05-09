import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("kd dev workflow", () => {
  it("removes the retired dev shell wrappers", () => {
    expect(existsSync(resolve(repoRoot, "scripts/dev.sh"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "scripts/mobile-dev.sh"))).toBe(false);
  });

  it("documents kd as the development entry point", () => {
    const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
    const agents = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");

    expect(readme).toContain("./kd dev up");
    expect(readme).not.toContain("./scripts/dev.sh");
    expect(agents).toContain("./kd dev up");
    expect(agents).not.toContain("legacy plumbing");
  });
});
