import { describe, it, expect } from "vitest";
import { runCopilot, runCopilotInteractive, createHookTestDir } from "../helpers/copilot";
import { rm, readFile, access } from "fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "path";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(0, index + 1);
      }
    }
  }

  return trimmed;
}

describe("copilot hooks (.github/hooks/*.json)", () => {
  /**
   * Interactive-mode hook tests (-i flag).
   * This is how Kanna actually spawns copilot: in a PTY with -i "prompt".
   * Critical to verify hooks fire in this mode, not just -p programmatic mode.
   */
  it("interactive mode (-i): sessionStart and sessionEnd hooks both fire", async () => {
    const startMarker = `/tmp/kanna-copilot-istart-${Date.now()}`;
    const endMarker = `/tmp/kanna-copilot-iend-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionStart: [
          { type: "command", bash: `touch ${startMarker}` },
        ],
        sessionEnd: [
          { type: "command", bash: `touch ${endMarker}` },
        ],
      },
    });

    try {
      const result = await runCopilotInteractive({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);
      expect(await pathExists(startMarker)).toBe(true);
      expect(await pathExists(endMarker)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(startMarker, { force: true }).catch(() => {});
      await rm(endMarker, { force: true }).catch(() => {});
    }
  });

  it("interactive mode (-i): sessionStart stdin has sessionId and initialPrompt", async () => {
    const stdinDump = `/tmp/kanna-copilot-istdin-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionStart: [
          { type: "command", bash: `cat > ${stdinDump}` },
        ],
      },
    });

    try {
      const result = await runCopilotInteractive({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      const content = await readFile(stdinDump, "utf-8");
      const parsed = JSON.parse(content.trim());
      console.log("[copilot hooks] interactive sessionStart:", JSON.stringify(parsed, null, 2));

      expect(parsed).toHaveProperty("sessionId");
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("cwd");
      expect(parsed).toHaveProperty("initialPrompt");
      expect(parsed.source).toBe("new");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(stdinDump, { force: true }).catch(() => {});
    }
  });

  it("interactive mode (-i): sessionEnd stdin has reason 'complete'", async () => {
    const stdinDump = `/tmp/kanna-copilot-iend-stdin-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionEnd: [
          { type: "command", bash: `cat > ${stdinDump}` },
        ],
      },
    });

    try {
      const result = await runCopilotInteractive({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      const content = await readFile(stdinDump, "utf-8");
      const parsed = JSON.parse(content.trim());
      console.log("[copilot hooks] interactive sessionEnd:", JSON.stringify(parsed, null, 2));

      expect(parsed).toHaveProperty("sessionId");
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed.reason).toBe("complete");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(stdinDump, { force: true }).catch(() => {});
    }
  });

  it("sessionEnd hook fires when copilot finishes", async () => {
    const markerFile = `/tmp/kanna-copilot-hook-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionEnd: [
          {
            type: "command",
            bash: `touch ${markerFile}`,
          },
        ],
      },
    });

    try {
      const result = await runCopilot({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      // Give hooks a moment to fire
      await sleep(1500);
      const exists = await pathExists(markerFile);
      expect(exists).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(markerFile, { force: true }).catch(() => {});
    }
  });

  it("sessionStart hook fires when copilot starts", async () => {
    const markerFile = `/tmp/kanna-copilot-start-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            bash: `touch ${markerFile}`,
          },
        ],
      },
    });

    try {
      const result = await runCopilot({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);
      expect(await pathExists(markerFile)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(markerFile, { force: true }).catch(() => {});
    }
  });

  it("hook command can write output to a file", async () => {
    const outputFile = `/tmp/kanna-copilot-output-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionEnd: [
          {
            type: "command",
            bash: `echo "hook-data-456" > ${outputFile}`,
          },
        ],
      },
    });

    try {
      const result = await runCopilot({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      const content = await readFile(outputFile, "utf-8");
      expect(content.trim()).toBe("hook-data-456");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(outputFile, { force: true }).catch(() => {});
    }
  });

  it("hook receives JSON input on stdin", async () => {
    const stdinDump = `/tmp/kanna-copilot-stdin-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionEnd: [
          {
            type: "command",
            bash: `cat > ${stdinDump}`,
          },
        ],
      },
    });

    try {
      const result = await runCopilot({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      const content = await readFile(stdinDump, "utf-8");
      console.log("[copilot hooks] sessionEnd stdin JSON:", content.trim());

      // Should be valid JSON
      const parsed = JSON.parse(content.trim());
      // Log all keys so we can see what Copilot sends
      console.log("[copilot hooks] sessionEnd keys:", Object.keys(parsed));

      // At minimum should have a timestamp and cwd
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("cwd");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(stdinDump, { force: true }).catch(() => {});
    }
  });

  it("postToolUse hook fires with tool info", async () => {
    const stdinDump = `/tmp/kanna-copilot-tool-${Date.now()}`;

    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        postToolUse: [
          {
            type: "command",
            bash: `cat >> ${stdinDump}`,
          },
        ],
      },
    });

    try {
      // Ask copilot to do something that triggers a tool use
      const result = await runCopilot({
        prompt: "List the files in the current directory",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      const exists = await pathExists(stdinDump);
      if (exists) {
        const content = await readFile(stdinDump, "utf-8");
        console.log("[copilot hooks] postToolUse stdin:", content.substring(0, 500));
        // Copilot can emit multiple hook payloads back-to-back in one file.
        const parsed = JSON.parse(extractFirstJsonObject(content));
        console.log("[copilot hooks] postToolUse keys:", Object.keys(parsed));
      } else {
        console.log("[copilot hooks] postToolUse did NOT fire — copilot may not have used a tool");
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(stdinDump, { force: true }).catch(() => {});
    }
  });

  it("the exact Kanna hook format works end-to-end", async () => {
    const stopMarker = `/tmp/kanna-copilot-kanna-${Date.now()}`;
    const toolLog = `/tmp/kanna-copilot-tools-${Date.now()}`;

    // This is the format Kanna will write to .github/hooks/kanna.json
    const tmpDir = await createHookTestDir({
      version: 1,
      hooks: {
        sessionEnd: [
          {
            type: "command",
            bash: `echo '{"event":"sessionEnd"}' > ${stopMarker}`,
          },
        ],
        postToolUse: [
          {
            type: "command",
            bash: `echo tool >> ${toolLog}`,
          },
        ],
        sessionStart: [
          {
            type: "command",
            bash: `echo started`,
          },
        ],
      },
    });

    try {
      const result = await runCopilot({
        prompt: "Say OK",
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
      await sleep(1500);

      // sessionEnd hook should have fired
      expect(await pathExists(stopMarker)).toBe(true);
      const stopContent = await readFile(stopMarker, "utf-8");
      const parsed = JSON.parse(stopContent.trim());
      expect(parsed.event).toBe("sessionEnd");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      await rm(stopMarker, { force: true }).catch(() => {});
      await rm(toolLog, { force: true }).catch(() => {});
    }
  });

  it("hooks from ~/.copilot/hooks/ are also loaded (personal hooks)", async () => {
    // Discovery test: check if personal hooks dir exists and is respected
    const home = process.env.HOME || "";
    const personalHooksDir = join(home, ".copilot", "hooks");
    const exists = await pathExists(personalHooksDir);
    console.log("[copilot hooks] ~/.copilot/hooks/ exists:", exists);
    // This is informational — we don't want to modify the user's personal hooks
  });
});
