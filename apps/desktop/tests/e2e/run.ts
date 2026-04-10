import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

interface CommandOptions {
  cwd: string;
  env: Record<string, string>;
}

function sanitizeSuffix(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve free port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function runCommand(
  command: string[],
  options: CommandOptions,
): Promise<void> {
  const [file, ...args] = command;
  const proc = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  await new Promise<void>((resolveCommand, reject) => {
    proc.once("error", reject);
    proc.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        resolveCommand();
        return;
      }
      if (signal) {
        reject(new Error(`${command.join(" ")} exited with signal ${signal}`));
        return;
      }
      reject(new Error(`${command.join(" ")} exited with code ${exitCode ?? "unknown"}`));
    });
  });
}

function toSpawnEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...overrides };
}

async function resolveTestTargets(
  e2eRoot: string,
  suite?: string,
): Promise<string[]> {
  const normalized = suite?.replace(/\\/g, "/");
  if (!normalized) {
    return [
      ...(await resolveTestTargets(e2eRoot, "mock/")),
      ...(await resolveTestTargets(e2eRoot, "real/")),
    ];
  }
  if (normalized.endsWith(".test.ts")) return [normalized];

  const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const files: string[] = [];
  const prefixPath = join(e2eRoot, prefix);
  await collectTestFiles(prefixPath, prefix, files).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  });
  files.sort();
  return files;
}

async function collectTestFiles(
  absoluteDir: string,
  relativeDir: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = posix.join(relativeDir.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      await collectTestFiles(join(absoluteDir, entry.name), relativePath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relativePath);
    }
  }
}

async function canConnectToApp(baseUrl: string): Promise<boolean> {
  const status = await fetch(`${baseUrl}/status`).catch(() => null);
  if (!status?.ok) return false;

  const session = await fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilities: {} }),
  }).then((response) => response.json()).catch(() => null);

  const sessionId = session?.value?.sessionId;
  if (!sessionId) return false;

  try {
    const vueCheck = await fetch(`${baseUrl}/session/${sessionId}/execute/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: "return Boolean(window.__KANNA_E2E__ && window.__KANNA_E2E__.setupState);",
        args: [],
      }),
    }).then((response) => response.json());
    return Boolean(vueCheck?.value);
  } finally {
    await fetch(`${baseUrl}/session/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function waitForApp(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToApp(baseUrl)) return;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for app at ${baseUrl}`);
}

async function main(): Promise<void> {
  const suite = process.argv[2];
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const desktopRoot = resolve(currentDir, "../..");
  const e2eRoot = join(desktopRoot, "tests", "e2e");
  const repoRoot = resolve(desktopRoot, "../..");
  const suffixBase = sanitizeSuffix(`${process.pid}-${Date.now()}`);
  const devPort = await findFreePort();
  const webdriverPort = await findFreePort();
  const sessionName = `kanna-e2e-${suffixBase}`;
  const dbName = `kanna-test-${suffixBase}.db`;
  const daemonDir = join(repoRoot, ".kanna-daemon-e2e", suffixBase);
  const dbPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.kanna.app",
    dbName,
  );
  const env = toSpawnEnv({
    KANNA_DB_NAME: dbName,
    KANNA_DB_PATH: dbPath,
    KANNA_DEV_PORT: String(devPort),
    KANNA_DAEMON_DIR: daemonDir,
    KANNA_TMUX_SESSION: sessionName,
    TAURI_WEBDRIVER_PORT: String(webdriverPort),
  });

  const baseUrl = `http://127.0.0.1:${webdriverPort}`;

  try {
    await runCommand(["./scripts/dev.sh", "start"], { cwd: repoRoot, env });
    await waitForApp(baseUrl, 10 * 60_000);

    const testTargets = await resolveTestTargets(e2eRoot, suite);
    if (testTargets.length === 0) {
      throw new Error(`no E2E tests matched ${suite ?? "default suites"}`);
    }

    for (const testTarget of testTargets) {
      console.log(`\n[e2e] running ${testTarget}\n`);
      await runCommand(
        ["pnpm", "exec", "vitest", "run", "--config", "./tests/e2e/vitest.config.ts", testTarget],
        {
          cwd: desktopRoot,
          env,
        },
      );
    }
  } catch (error) {
    console.error("\n[e2e] recent dev log:\n");
    await runCommand(["./scripts/dev.sh", "log"], { cwd: repoRoot, env }).catch(() => undefined);
    throw error;
  } finally {
    await runCommand(["./scripts/dev.sh", "stop", "--kill-daemon"], {
      cwd: repoRoot,
      env,
    }).catch(() => undefined);
    await rm(daemonDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(dbPath, { force: true }).catch(() => undefined);
    await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined);
    await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined);
  }
}

await main();
