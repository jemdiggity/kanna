import { spawn } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

interface CreateFixtureRepoOptions {
  sourceRepoPath?: string;
  tempRoot?: string;
}

interface CommandOptions {
  cwd?: string;
}

const DEFAULT_LIVE_REPO_ROOT = resolve(
  process.env.KANNA_E2E_LIVE_REPO_ROOT ??
    dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

function sanitizeRepoName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function runCommand(command: string[], options: CommandOptions = {}): Promise<void> {
  const [file, ...args] = command;
  const proc = spawn(file, args, {
    cwd: options.cwd,
    stdio: "pipe",
  });

  let stderr = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolveCommand, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }

      if (signal) {
        reject(new Error(`${command.join(" ")} exited with signal ${signal}`));
        return;
      }

      const details = stderr.trim();
      reject(
        new Error(
          details.length > 0
            ? `${command.join(" ")} failed: ${details}`
            : `${command.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export function getLiveRepoRoot(): string {
  return DEFAULT_LIVE_REPO_ROOT;
}

export function assertSafeE2eRepoPath(
  repoPath: string,
  liveRepoRoot = getLiveRepoRoot(),
): void {
  if (!isWithinPath(repoPath, liveRepoRoot)) return;

  throw new Error(
    `E2E tests must import a fixture repo, not the live Kanna checkout: ${repoPath}`,
  );
}

export async function createFixtureRepo(
  name: string,
  options: CreateFixtureRepoOptions = {},
): Promise<string> {
  // Never run E2E against the live Kanna checkout. Clone it into a disposable
  // temp repo first so worktree cleanup cannot mutate the product repo.
  const sourceRepoPath = resolve(options.sourceRepoPath ?? getLiveRepoRoot());
  const tempRoot = options.tempRoot ?? join(tmpdir(), "kanna-e2e-fixtures");

  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(join(tempRoot, "fixture-"));
  const fixtureRepoPath = join(tempDir, sanitizeRepoName(name));

  await runCommand(
    ["git", "clone", "--local", "--no-hardlinks", sourceRepoPath, fixtureRepoPath],
    { cwd: tempDir },
  );
  await rm(join(fixtureRepoPath, ".kanna-worktrees"), { recursive: true, force: true });

  return fixtureRepoPath;
}

export async function cleanupFixtureRepos(repoPaths: string[]): Promise<void> {
  for (const repoPath of repoPaths) {
    const resolvedRepoPath = resolve(repoPath);
    const parentDir = dirname(resolvedRepoPath);
    if (basename(parentDir).startsWith("fixture-")) {
      await rm(parentDir, { recursive: true, force: true });
      continue;
    }

    await rm(resolvedRepoPath, { recursive: true, force: true });
  }
}
