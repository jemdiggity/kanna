import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("dev script daemon cleanup", () => {
  it("keeps the workspace daemon alive by default when stopping or restarting dev sessions", () => {
    const devScript = readFileSync(resolve(repoRoot, "scripts/dev.sh"), "utf8");

    expect(devScript).toContain("KILL_DAEMON=${KILL_DAEMON:-false}");
    expect(devScript).toContain("if $KILL_DAEMON; then\n    kill_daemon");
    expect(devScript).toContain("./scripts/dev.sh stop -k");
    expect(devScript).toContain("./scripts/dev.sh restart -k");
  });

  it("cleans up orphaned workspace daemons and recovery sidecars even when the pid file is gone", () => {
    const devScript = readFileSync(resolve(repoRoot, "scripts/dev.sh"), "utf8");

    expect(devScript).toContain("kanna-terminal-recovery");
    expect(devScript).toContain("ps -axo pid=,command=");
    expect(devScript).toContain('orphaned workspace daemon');
  });
});
