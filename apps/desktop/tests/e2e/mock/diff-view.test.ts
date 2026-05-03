import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { getVueState, tauriInvoke } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { appendE2ePerfSummaryLine, formatDiffPerfSummary } from "../helpers/perfOutput";
import { buildGlobalKeydownScript } from "../helpers/keyboard";

function getDiffPerfFileCount(): number {
  const rawValue = process.env.KANNA_E2E_DIFF_PERF_FILES;
  if (!rawValue) return 20;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`KANNA_E2E_DIFF_PERF_FILES must be a positive integer, got: ${rawValue}`);
  }
  return parsed;
}

function getDiffPerfLinesPerFile(): number {
  const rawValue = process.env.KANNA_E2E_DIFF_PERF_LINES_PER_FILE;
  if (!rawValue) return 1500;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`KANNA_E2E_DIFF_PERF_LINES_PER_FILE must be a positive integer, got: ${rawValue}`);
  }
  return parsed;
}

function getDiffFirstContentThresholdMs(): number {
  const rawValue = process.env.KANNA_E2E_DIFF_FIRST_CONTENT_MS;
  if (!rawValue) return 1500;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`KANNA_E2E_DIFF_FIRST_CONTENT_MS must be a positive integer, got: ${rawValue}`);
  }
  return parsed;
}

describe("diff view", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("diff-test");
    testRepoPath = fixtureRepoRoot;
    await importTestRepo(client, testRepoPath, "diff-test");

    // Create a task with worktree but no Claude session (SDK mode, will fail gracefully)
    const repoId = await getVueState(client, "selectedRepoId") as string;
    const id = crypto.randomUUID();
    const branch = `task-${id}`;
    const worktreePath = `${testRepoPath}/.kanna-worktrees/${branch}`;

    // Internal setup only: diff tests need a deterministic worktree-backed task
    // without starting a real agent session.
    await tauriInvoke(client, "git_worktree_add", {
      repoPath: testRepoPath,
      branch,
      path: worktreePath,
    });

    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const db = ctx.db.value || ctx.db;
       db.execute("INSERT INTO pipeline_item (id, repo_id, prompt, stage, branch, agent_type) VALUES (?, ?, ?, ?, ?, ?)",
         ["${id}", "${repoId}", "Say OK", "in progress", "${branch}", "sdk"])
         .then(function() { return ctx.loadItems("${repoId}"); })
         .then(function() { ctx.handleSelectItem("${id}"); return ctx.refreshAllItems(); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    await client.waitForText(".sidebar", "Say OK");
  });

  afterAll(async () => {
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
    }
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("opens the diff modal", async () => {
    await client.executeSync(buildGlobalKeydownScript({ key: "d", meta: true }));
    const diffView = await client.waitForElement(".diff-view", 5000);
    expect(diffView).toBeTruthy();
    await client.executeSync(buildGlobalKeydownScript({ key: "Escape" }));
    await client.waitForNoElement(".diff-view", 2_000);
  });

  it("loads diff content after editing a tracked file", async () => {
    // Get the worktree path from the selected item
    const branch = await client.executeSync<string | null>(
      `const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       return item ? (item.branch?.value || item.branch) : null;`
    );
    if (!branch) {
      console.warn("No task selected, skipping diff content test");
      return;
    }

    const worktreePath = `${testRepoPath}/.kanna-worktrees/${branch}`;

    // Modify a tracked file in the worktree so the working diff is guaranteed to pick it up.
    await tauriInvoke(client, "run_script", {
      script: "printf '\\n# diff test marker\\n' >> VERSION",
      cwd: worktreePath,
      env: {},
    });

    await client.executeSync(buildGlobalKeydownScript({ key: "d", meta: true }));

    const patch = await tauriInvoke(client, "git_diff", {
      repoPath: worktreePath,
      mode: "all",
    });
    expect(typeof patch).toBe("string");
    expect(String(patch)).toContain("# diff test marker");
  });

  it("keeps the sticky diff file header flush with the diff scroller", async () => {
    const branch = await client.executeSync<string | null>(
      `const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       return item ? (item.branch?.value || item.branch) : null;`
    );
    if (!branch) {
      throw new Error("expected selected task to have a worktree branch");
    }

    const worktreePath = `${testRepoPath}/.kanna-worktrees/${branch}`;

    await tauriInvoke(client, "run_script", {
      script: "for i in $(seq 1 120); do printf '# sticky visual e2e %03d\\n' \"$i\"; done >> VERSION",
      cwd: worktreePath,
      env: {},
    });

    await client.executeSync(buildGlobalKeydownScript({ key: "Escape" }));
    await client.waitForNoElement(".diff-view", 2_000);
    await sleep(250);
    await client.executeSync(buildGlobalKeydownScript({ key: "d", meta: true }));
    await client.waitForElement(".diff-view", 5_000);

    const result = await client.executeAsync<{
      containerTop: number;
      headerTop: number;
      headerBottom: number;
      scrollTop: number;
      stickyTop: string;
      headerCount?: number;
      renderedHeaderCount?: number;
      headerLabels?: string[];
      wrapperHeight?: number;
      timedOut?: boolean;
    }>(
      `const cb = arguments[arguments.length - 1];
       let done = false;
       const finish = (value) => {
         if (done) return;
         done = true;
         clearInterval(interval);
         clearTimeout(timeout);
         cb(value);
       };
       const measure = () => {
         const container = document.querySelector(".diff-container");
         const wrappers = Array.from(document.querySelectorAll(".diff-file"));
         const renderedWrappers = wrappers.filter((element) =>
           element.querySelector(".diff-file-header") &&
           element.querySelector("diffs-container") &&
           element.getBoundingClientRect().height > 140
         );
         const wrapper = renderedWrappers[0];
         const header = wrapper?.querySelector(".diff-file-header");
         if (!(container instanceof HTMLElement) || !(wrapper instanceof HTMLElement) || !(header instanceof HTMLElement)) return;

         container.scrollTop = wrapper.offsetTop + 40;
         requestAnimationFrame(() => {
           requestAnimationFrame(() => {
             const containerRect = container.getBoundingClientRect();
             const headerRect = header.getBoundingClientRect();
             const headers = Array.from(document.querySelectorAll(".diff-file-header"));
             finish({
               containerTop: containerRect.top,
               headerTop: headerRect.top,
               headerBottom: headerRect.bottom,
               scrollTop: container.scrollTop,
               stickyTop: getComputedStyle(header).top,
               headerCount: headers.length,
               renderedHeaderCount: renderedWrappers.length,
               wrapperHeight: wrapper.getBoundingClientRect().height,
             });
           });
         });
       };
       const interval = setInterval(measure, 25);
       const timeout = setTimeout(() => {
         finish({
           timedOut: true,
           containerTop: 0,
           headerTop: 0,
           headerBottom: 0,
           scrollTop: 0,
           stickyTop: "",
           headerCount: document.querySelectorAll(".diff-file-header").length,
           renderedHeaderCount: Array.from(document.querySelectorAll(".diff-file"))
             .filter((element) =>
               element.querySelector(".diff-file-header") &&
               element.querySelector("diffs-container") &&
               element.getBoundingClientRect().height > 140
             ).length,
           headerLabels: Array.from(document.querySelectorAll(".diff-file-header"))
             .map((element) => element.getAttribute("title") || element.textContent || ""),
         });
       }, 10000);
       measure();`
    );

    if (result.timedOut) {
      throw new Error(`timed out waiting for rendered sticky diff header: ${JSON.stringify(result)}`);
    }

    expect(result.scrollTop).toBeGreaterThan(0);
    expect(result.stickyTop).toBe("-1px");
    expect(result.headerTop).toBeLessThan(result.containerTop);
    expect(result.headerBottom).toBeGreaterThan(result.containerTop);
  });

  it("shows first diff content before rendering an entire broad diff", async () => {
    const branch = await client.executeSync<string | null>(
      `const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       return item ? (item.branch?.value || item.branch) : null;`
    );
    if (!branch) {
      throw new Error("expected selected task to have a worktree branch");
    }

    const fileCount = getDiffPerfFileCount();
    const linesPerFile = getDiffPerfLinesPerFile();
    const thresholdMs = getDiffFirstContentThresholdMs();
    const totalChangedLines = fileCount * (linesPerFile + 1);
    const worktreePath = `${testRepoPath}/.kanna-worktrees/${branch}`;
    const createFilesScript = [
      "mkdir -p diff-perf",
      "rm -f diff-perf/Cargo-*.lock",
      `for i in $(seq 1 ${fileCount}); do`,
      "  file=$(printf 'diff-perf/Cargo-%04d.lock' \"$i\")",
      "  {",
      "    printf '# perf lockfile %04d\\n' \"$i\"",
      `    for j in $(seq 1 ${linesPerFile}); do printf '[[package]] name = \"crate-%04d-%04d\" version = \"1.0.%04d\" checksum = \"%032d\"\\n' \"$i\" \"$j\" \"$j\" \"$j\"; done`,
      "  } > \"$file\"",
      "done",
    ].join("\n");

    await tauriInvoke(client, "run_script", {
      script: createFilesScript,
      cwd: worktreePath,
      env: {},
    });

    await client.executeSync(buildGlobalKeydownScript({ key: "Escape" }));
    await sleep(250);

    const result = await client.executeAsync<{
      firstContentMs: number;
      renderedContainerCount: number;
      fileWrapperCount: number;
      timedOut?: boolean;
    }>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const startedAt = performance.now();
       let done = false;
       const perfFilePrefix = "diff-perf/Cargo-";
       let interval;
        const getPerfWrappers = () =>
          Array.from(document.querySelectorAll(".diff-container .diff-file")).filter((wrapper) => {
            const header = wrapper.querySelector(".diff-file-header");
            const label = header?.getAttribute("title") || header?.textContent || "";
            return label.startsWith(perfFilePrefix);
         });
       const getSnapshot = () => {
         const perfWrappers = getPerfWrappers();
         const renderedContainers = perfWrappers.flatMap((wrapper) =>
           Array.from(wrapper.querySelectorAll("diffs-container"))
         );
         const firstRendered = renderedContainers.find((container) => {
           const text = container.shadowRoot?.textContent || container.textContent || "";
           return text.includes("perf lockfile");
         });
         return {
           firstRendered,
           renderedContainerCount: renderedContainers.length,
           fileWrapperCount: perfWrappers.length,
         };
       };
       const finish = (value) => {
         if (done) return;
         done = true;
         clearInterval(interval);
         clearTimeout(timeout);
         cb(value);
       };
        const maybeFinish = () => {
          const snapshot = getSnapshot();
         if (!snapshot.firstRendered) return;
         finish({
           firstContentMs: performance.now() - startedAt,
           renderedContainerCount: snapshot.renderedContainerCount,
           fileWrapperCount: snapshot.fileWrapperCount,
         });
       };
       interval = setInterval(() => {
         maybeFinish();
       }, 10);
       const timeout = setTimeout(() => {
         const snapshot = getSnapshot();
         finish({
           timedOut: true,
           firstContentMs: performance.now() - startedAt,
           renderedContainerCount: snapshot.renderedContainerCount,
           fileWrapperCount: snapshot.fileWrapperCount,
         });
       }, 15000);
       window.dispatchEvent(new KeyboardEvent("keydown", {
         key: "d",
         metaKey: true,
         bubbles: true,
         cancelable: true
       }));`
    );

    await appendE2ePerfSummaryLine(formatDiffPerfSummary({
      fileCount,
      linesPerFile,
      totalChangedLines,
      thresholdMs,
      firstContentMs: result.firstContentMs,
      renderedContainerCount: result.renderedContainerCount,
      fileWrapperCount: result.fileWrapperCount,
    }));

    expect(result.timedOut).toBeUndefined();
    expect(result.firstContentMs).toBeLessThan(thresholdMs);
    expect(result.renderedContainerCount).toBeGreaterThan(0);
    expect(result.fileWrapperCount).toBeGreaterThan(0);
  });
});
