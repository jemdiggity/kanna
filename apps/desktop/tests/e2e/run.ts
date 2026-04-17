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

interface InstanceConfig {
  baseUrl: string;
  daemonDir: string;
  dbPath: string;
  env: Record<string, string>;
  startCommand: string[];
  stopCommand: string[];
  webDriverPort: number;
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
  if (normalized.endsWith(".test.ts")) {
    return [toDesktopRelativeTarget(normalized)];
  }

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
      files.push(toDesktopRelativeTarget(relativePath));
    }
  }
}

function toDesktopRelativeTarget(path: string): string {
  return posix.join("tests", "e2e", path.replace(/\\/g, "/"));
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

function needsSecondaryInstance(testTargets: string[]): boolean {
  return testTargets.some((target) => /real\/local-transfer-.*\.test\.ts$/.test(target));
}

function createInstanceConfig(input: {
  daemonDir: string;
  dbName: string;
  dbPath: string;
  devPortEnvValue: number;
  effectiveWebDriverPort: number;
  envOverrides?: Record<string, string>;
  secondary?: boolean;
  sessionName: string;
  transferPortEnvValue: number;
  webDriverPortEnvValue: number;
}): InstanceConfig {
  const env = toSpawnEnv({
    KANNA_DAEMON_DIR: input.daemonDir,
    KANNA_DB_NAME: input.dbName,
    KANNA_DB_PATH: input.dbPath,
    KANNA_DEV_PORT: String(input.devPortEnvValue),
    KANNA_TMUX_SESSION: input.sessionName,
    KANNA_TRANSFER_PORT: String(input.transferPortEnvValue),
    KANNA_WEBDRIVER_PORT: String(input.webDriverPortEnvValue),
    ...input.envOverrides,
  });

  return {
    baseUrl: `http://127.0.0.1:${input.effectiveWebDriverPort}`,
    daemonDir: input.daemonDir,
    dbPath: input.dbPath,
    env,
    startCommand: input.secondary
      ? ["./scripts/dev.sh", "start", "--secondary"]
      : ["./scripts/dev.sh", "start"],
    stopCommand: ["./scripts/dev.sh", "stop", "--kill-daemon"],
    webDriverPort: input.effectiveWebDriverPort,
  };
}

async function main(): Promise<void> {
  const suite = process.argv[2];
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const desktopRoot = resolve(currentDir, "../..");
  const e2eRoot = join(desktopRoot, "tests", "e2e");
  const repoRoot = resolve(desktopRoot, "../..");
  const testTargets = await resolveTestTargets(e2eRoot, suite);
  if (testTargets.length === 0) {
    throw new Error(`no E2E tests matched ${suite ?? "default suites"}`);
  }

  const enableSecondary = needsSecondaryInstance(testTargets);
  const suffixBase = sanitizeSuffix(`${process.pid}-${Date.now()}`);
  const sessionName = `kanna-e2e-${suffixBase}`;
  const transferRegistryDir = join(repoRoot, ".kanna-transfer-registry-e2e", suffixBase);
  const primaryDevPort = await findFreePort();
  const primaryWebDriverPort = await findFreePort();
  const primaryTransferPort = await findFreePort();
  const primaryDbName = `kanna-test-${suffixBase}.db`;
  const primaryDaemonDir = join(repoRoot, ".kanna-daemon-e2e", suffixBase);
  const primaryDbPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.kanna.app",
    primaryDbName,
  );
  const primary = createInstanceConfig({
    daemonDir: primaryDaemonDir,
    dbName: primaryDbName,
    dbPath: primaryDbPath,
    devPortEnvValue: primaryDevPort,
    effectiveWebDriverPort: primaryWebDriverPort,
    envOverrides: {
      KANNA_TRANSFER_DISPLAY_NAME: "Primary",
      KANNA_TRANSFER_PEER_ID: "peer-primary",
      KANNA_TRANSFER_REGISTRY_DIR: transferRegistryDir,
    },
    sessionName,
    transferPortEnvValue: primaryTransferPort,
    webDriverPortEnvValue: primaryWebDriverPort,
  });

  const secondaryDevPort = enableSecondary ? await findFreePort() : null;
  const secondaryWebDriverPort = enableSecondary ? await findFreePort() : null;
  const secondaryTransferPort = enableSecondary ? await findFreePort() : null;
  const secondaryDbName = enableSecondary ? `kanna-test-${suffixBase}-secondary.db` : null;
  const secondaryDaemonDir = enableSecondary
    ? join(repoRoot, ".kanna-daemon-e2e", `${suffixBase}-secondary`)
    : null;
  const secondaryDbPath = secondaryDbName
    ? join(
        homedir(),
        "Library",
        "Application Support",
        "com.kanna.app",
        secondaryDbName,
      )
    : null;
  const secondary = enableSecondary &&
    secondaryDevPort !== null &&
    secondaryWebDriverPort !== null &&
    secondaryTransferPort !== null &&
    secondaryDbName !== null &&
    secondaryDaemonDir !== null &&
    secondaryDbPath !== null
    ? createInstanceConfig({
        daemonDir: secondaryDaemonDir,
        dbName: secondaryDbName,
        dbPath: secondaryDbPath,
        // dev.sh applies a +1 secondary offset, so seed the base env with the
        // previous port to land on the allocated effective port.
        devPortEnvValue: secondaryDevPort - 1,
        effectiveWebDriverPort: secondaryWebDriverPort,
        envOverrides: {
          KANNA_TRANSFER_DISPLAY_NAME: "Secondary",
          KANNA_TRANSFER_PEER_ID: "peer-secondary",
          KANNA_TRANSFER_REGISTRY_DIR: transferRegistryDir,
        },
        secondary: true,
        sessionName: `${sessionName}-secondary`,
        transferPortEnvValue: secondaryTransferPort - 1,
        webDriverPortEnvValue: secondaryWebDriverPort - 1,
      })
    : null;

  const testEnv = toSpawnEnv({
    KANNA_DAEMON_DIR: primaryDaemonDir,
    KANNA_DB_NAME: primaryDbName,
    KANNA_DB_PATH: primaryDbPath,
    KANNA_DEV_PORT: String(primaryDevPort),
    KANNA_TRANSFER_REGISTRY_DIR: transferRegistryDir,
    KANNA_WEBDRIVER_PORT: String(primaryWebDriverPort),
    ...(secondary ? { KANNA_E2E_TARGET_WEBDRIVER_PORT: String(secondary.webDriverPort) } : {}),
  });

  try {
    await runCommand(primary.startCommand, { cwd: repoRoot, env: primary.env });
    if (secondary) {
      await runCommand(secondary.startCommand, { cwd: repoRoot, env: secondary.env });
    }
    await waitForApp(primary.baseUrl, 10 * 60_000);
    if (secondary) {
      await waitForApp(secondary.baseUrl, 10 * 60_000);
    }

    for (const testTarget of testTargets) {
      console.log(`\n[e2e] running ${testTarget}\n`);
      await runCommand(
        ["pnpm", "exec", "vitest", "run", "--config", "./tests/e2e/vitest.config.ts", testTarget],
        {
          cwd: desktopRoot,
          env: testEnv,
        },
      );
    }
  } catch (error) {
    console.error("\n[e2e] recent dev log:\n");
    await runCommand(["./scripts/dev.sh", "log"], { cwd: repoRoot, env: primary.env }).catch(() => undefined);
    if (secondary) {
      await runCommand(["./scripts/dev.sh", "log"], { cwd: repoRoot, env: secondary.env }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (secondary) {
      await runCommand(secondary.stopCommand, {
        cwd: repoRoot,
        env: secondary.env,
      }).catch(() => undefined);
      await rm(secondary.daemonDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(secondary.dbPath, { force: true }).catch(() => undefined);
      await rm(`${secondary.dbPath}-shm`, { force: true }).catch(() => undefined);
      await rm(`${secondary.dbPath}-wal`, { force: true }).catch(() => undefined);
    }
    await runCommand(primary.stopCommand, {
      cwd: repoRoot,
      env: primary.env,
    }).catch(() => undefined);
    await rm(primary.daemonDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(primary.dbPath, { force: true }).catch(() => undefined);
    await rm(`${primary.dbPath}-shm`, { force: true }).catch(() => undefined);
    await rm(`${primary.dbPath}-wal`, { force: true }).catch(() => undefined);
    await rm(transferRegistryDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
