# Bazel Skylark Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bazel-aware syntax highlighting to both file previews and diffs by recognizing Bazel/Starlark filenames and mapping them to the shipped `python` grammar.

**Architecture:** Introduce one small shared utility in the desktop frontend for Bazel filename detection and syntax-language resolution. Reuse that utility from `FilePreviewModal.vue` for Shiki previews and from `DiffView.vue` by applying `@pierre/diffs` `setLanguageOverride()` before rendering each diff file.

**Tech Stack:** Vue 3, TypeScript, Vitest, Shiki, `@pierre/diffs`

**Spec:** `docs/superpowers/specs/2026-04-10-bazel-skylark-highlighting-design.md`

---

### Task 1: Add shared Bazel language detection utility

**Files:**
- Create: `apps/desktop/src/utils/syntaxLanguage.ts`
- Create: `apps/desktop/src/utils/syntaxLanguage.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/desktop/src/utils/syntaxLanguage.test.ts
import { describe, expect, it } from "vitest";
import {
  getSyntaxLanguageForPath,
  isBazelSyntaxPath,
} from "./syntaxLanguage";

describe("isBazelSyntaxPath", () => {
  it("recognizes Bazel special filenames", () => {
    expect(isBazelSyntaxPath("BUILD")).toBe(true);
    expect(isBazelSyntaxPath("BUILD.bazel")).toBe(true);
    expect(isBazelSyntaxPath("WORKSPACE")).toBe(true);
    expect(isBazelSyntaxPath("WORKSPACE.bazel")).toBe(true);
    expect(isBazelSyntaxPath("MODULE.bazel")).toBe(true);
  });

  it("recognizes .bzl files anywhere in the repo", () => {
    expect(isBazelSyntaxPath("tools/bazel/extensions.bzl")).toBe(true);
  });

  it("does not treat unrelated files as Bazel syntax", () => {
    expect(isBazelSyntaxPath("src/main.ts")).toBe(false);
    expect(isBazelSyntaxPath("README.md")).toBe(false);
  });
});

describe("getSyntaxLanguageForPath", () => {
  it("maps Bazel paths to python", () => {
    expect(getSyntaxLanguageForPath("BUILD.bazel")).toBe("python");
    expect(getSyntaxLanguageForPath("MODULE.bazel")).toBe("python");
    expect(getSyntaxLanguageForPath("tools/bazel/extensions.bzl")).toBe("python");
  });

  it("preserves existing extension-based mappings for non-Bazel files", () => {
    expect(getSyntaxLanguageForPath("src/App.vue")).toBe("vue");
    expect(getSyntaxLanguageForPath("src/main.ts")).toBe("typescript");
    expect(getSyntaxLanguageForPath("README.md")).toBe("markdown");
  });

  it("falls back to text for unknown extensions", () => {
    expect(getSyntaxLanguageForPath("notes.custom")).toBe("text");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && bun test src/utils/syntaxLanguage.test.ts`
Expected: FAIL with module-not-found for `./syntaxLanguage`

- [ ] **Step 3: Write the minimal implementation**

```typescript
// apps/desktop/src/utils/syntaxLanguage.ts
const BAZEL_FILENAMES = new Set([
  "BUILD",
  "BUILD.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
  "MODULE.bazel",
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  vue: "vue",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
};

function getBaseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function isBazelSyntaxPath(path: string): boolean {
  const baseName = getBaseName(path);
  return BAZEL_FILENAMES.has(baseName) || baseName.endsWith(".bzl");
}

export function getSyntaxLanguageForPath(path: string): string {
  if (isBazelSyntaxPath(path)) {
    return "python";
  }

  const ext = getBaseName(path).split(".").pop()?.toLowerCase() || "";
  return EXTENSION_LANGUAGE_MAP[ext] || "text";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && bun test src/utils/syntaxLanguage.test.ts`
Expected: PASS with all utility tests green

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/utils/syntaxLanguage.ts apps/desktop/src/utils/syntaxLanguage.test.ts
git commit -m "feat: add bazel syntax language detection"
```

---

### Task 2: Use the shared resolver in file previews

**Files:**
- Modify: `apps/desktop/src/components/FilePreviewModal.vue`
- Test: `apps/desktop/src/components/__tests__/FilePreviewModal.test.ts`

- [ ] **Step 1: Extend the file preview test with a Bazel case**

Add this test to `apps/desktop/src/components/__tests__/FilePreviewModal.test.ts` and update the Shiki mock so `getLoadedLanguages()` returns `["text", "typescript", "python"]` and `codeToHtml` is a spy:

```typescript
it("uses python highlighting for Bazel files", async () => {
  invokeMock.mockImplementation(async (command) => {
    if (command === "read_text_file") {
      return 'cc_library(name = "demo")\n';
    }
    if (command === "run_script") {
      return "";
    }
    throw new Error(`unexpected invoke: ${command}`);
  });

  const wrapper = mount(FilePreviewModal, {
    props: {
      filePath: "BUILD.bazel",
      worktreePath: "/repo",
    },
    attachTo: document.body,
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  });

  await flushPromises();
  await flushPromises();

  expect(loadLanguageMock).toHaveBeenCalledWith("python");
  expect(codeToHtmlMock).toHaveBeenCalledWith(
    'cc_library(name = "demo")\n',
    expect.objectContaining({ lang: "python" })
  );

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `cd apps/desktop && bun test src/components/__tests__/FilePreviewModal.test.ts`
Expected: FAIL because `BUILD.bazel` still resolves to `text`

- [ ] **Step 3: Update `FilePreviewModal.vue` to use the shared resolver**

Make these changes in `apps/desktop/src/components/FilePreviewModal.vue`:

```typescript
import { getSyntaxLanguageForPath } from "../utils/syntaxLanguage";
```

Delete the local `langFromPath()` function entirely and replace its usage inside `loadFile()`:

```typescript
const lang = getSyntaxLanguageForPath(props.filePath);
```

Leave the surrounding load flow unchanged:

```typescript
try {
  await hl.loadLanguage(lang);
} catch {
  // Language not available — fall back to text
}

const loadedLangs = hl.getLoadedLanguages();
currentLang.value = loadedLangs.includes(lang) ? lang : "text";
content.value = raw;
```

- [ ] **Step 4: Run the file preview test to verify it passes**

Run: `cd apps/desktop && bun test src/components/__tests__/FilePreviewModal.test.ts`
Expected: PASS with the new Bazel preview case green

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/FilePreviewModal.vue apps/desktop/src/components/__tests__/FilePreviewModal.test.ts
git commit -m "feat: highlight bazel files in file preview"
```

---

### Task 3: Apply Bazel language overrides in the diff viewer

**Files:**
- Modify: `apps/desktop/src/components/DiffView.vue`
- Create: `apps/desktop/src/components/__tests__/DiffView.test.ts`

- [ ] **Step 1: Write a diff-view test that expects Bazel files to be overridden to python**

```typescript
// apps/desktop/src/components/__tests__/DiffView.test.ts
// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiffView from "../DiffView.vue";
import { clearContextShortcuts, resetContext } from "../../composables/useShortcutContext";

const { invokeMock, setLanguageOverrideMock, renderMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  setLanguageOverrideMock: vi.fn((fileMeta) => fileMeta),
  renderMock: vi.fn(),
}));

vi.mock("../../invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: vi.fn(() => [
    {
      files: [
        {
          oldName: "BUILD.bazel",
          newName: "BUILD.bazel",
          hunks: [],
        },
      ],
    },
  ]),
  FileDiff: class {
    render = renderMock;
  },
  setLanguageOverride: setLanguageOverrideMock,
}));

vi.mock("@pierre/diffs/worker", () => ({
  getOrCreateWorkerPoolSingleton: vi.fn(() => null),
}));

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

describe("DiffView", () => {
  afterEach(() => {
    invokeMock.mockReset();
    setLanguageOverrideMock.mockReset();
    renderMock.mockReset();
    clearContextShortcuts("diff");
    resetContext();
    document.body.innerHTML = "";
  });

  it("forces Bazel diffs to use python highlighting", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/BUILD.bazel b/BUILD.bazel";
      return "";
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
      },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    expect(setLanguageOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oldName: "BUILD.bazel",
        newName: "BUILD.bazel",
      }),
      "python"
    );

    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && bun test src/components/__tests__/DiffView.test.ts`
Expected: FAIL because `DiffView.vue` does not call `setLanguageOverride()`

- [ ] **Step 3: Implement Bazel diff overrides in `DiffView.vue`**

Add imports:

```typescript
import { FileDiff, parsePatchFiles, setLanguageOverride } from "@pierre/diffs";
import { isBazelSyntaxPath } from "../utils/syntaxLanguage";
```

Inside `renderDiff()`, replace the current `for (const fileMeta of allFiles)` loop with one that applies the override before rendering:

```typescript
for (const rawFileMeta of allFiles) {
  const displayPath =
    rawFileMeta.newName ||
    rawFileMeta.oldName ||
    rawFileMeta.fileName ||
    "";

  const fileMeta = isBazelSyntaxPath(displayPath)
    ? setLanguageOverride(rawFileMeta, "python")
    : rawFileMeta;

  const wrapper = document.createElement("div");
  wrapper.className = "diff-file";
  containerRef.value.appendChild(wrapper);

  const instance = new FileDiff(
    {
      theme: "github-dark",
      diffStyle: "unified",
      diffIndicators: "classic",
    },
    pool || undefined
  );

  instance.render({
    fileDiff: fileMeta,
    containerWrapper: wrapper,
  });

  fileDiffInstance = instance;
}
```

- [ ] **Step 4: Run the diff-view test to verify it passes**

Run: `cd apps/desktop && bun test src/components/__tests__/DiffView.test.ts`
Expected: PASS with `setLanguageOverride(..., "python")` observed for Bazel files

- [ ] **Step 5: Run the focused desktop test suite**

Run: `cd apps/desktop && bun test src/utils/syntaxLanguage.test.ts src/components/__tests__/FilePreviewModal.test.ts src/components/__tests__/DiffView.test.ts`
Expected: PASS with all three Bazel-highlighting tests green

- [ ] **Step 6: Run TypeScript verification**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS with no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/DiffView.vue apps/desktop/src/components/__tests__/DiffView.test.ts apps/desktop/src/utils/syntaxLanguage.ts apps/desktop/src/utils/syntaxLanguage.test.ts apps/desktop/src/components/FilePreviewModal.vue apps/desktop/src/components/__tests__/FilePreviewModal.test.ts
git commit -m "feat: add bazel syntax highlighting"
```
