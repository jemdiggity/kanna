// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiffView from "../DiffView.vue";
import { clearContextShortcuts, resetContext } from "../../composables/useShortcutContext";

const invokeMock = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();
const setLanguageOverrideMock = vi.fn((fileMeta: { [key: string]: unknown }, lang: string) => ({
  ...fileMeta,
  languageOverride: lang,
}));
const renderMock = vi.fn();

interface MockSearchRow {
  lineIndex: string;
  text: string;
}

interface MockFileDiff {
  oldName?: string;
  newName?: string;
  name?: string;
  __searchRows?: MockSearchRow[];
}

const diffMocks = vi.hoisted(() => ({
  actualParsePatchFiles: undefined as undefined | typeof import("@pierre/diffs").parsePatchFiles,
  parsePatchFilesMock: vi.fn<(typeof import("@pierre/diffs"))["parsePatchFiles"]>(),
}));

vi.mock("../../invoke", () => ({
  invoke: (...args: [string, Record<string, unknown> | undefined]) => invokeMock(...args),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@pierre/diffs", async () => {
  const actual = await vi.importActual<typeof import("@pierre/diffs")>("@pierre/diffs");
  diffMocks.actualParsePatchFiles = actual.parsePatchFiles;
  diffMocks.parsePatchFilesMock.mockImplementation(actual.parsePatchFiles);
  return {
    ...actual,
    parsePatchFiles: (...args: Parameters<typeof actual.parsePatchFiles>) => diffMocks.parsePatchFilesMock(...args),
    FileDiff: class {
      render = (...args: [Record<string, unknown>]) => {
        const [{ containerWrapper, fileDiff }] = args;
        const wrapper = containerWrapper as HTMLElement | undefined;
        const diffMeta = fileDiff as MockFileDiff | undefined;

        if (wrapper && diffMeta) {
          const container = document.createElement("diffs-container");
          const shadowRoot = container.attachShadow({ mode: "open" });
          const header = diffMeta.newName ?? diffMeta.oldName ?? diffMeta.name ?? "";
          const rows = diffMeta.__searchRows ?? [];

          shadowRoot.innerHTML = `
            <div data-title="">${header}</div>
            <div data-gutter="">
              ${rows.map((row) => `<div data-line-index="${row.lineIndex}">${row.lineIndex}</div>`).join("")}
            </div>
            <div data-content="">
              ${rows.map((row) => `<div data-line-index="${row.lineIndex}">${row.text}</div>`).join("")}
            </div>
          `;

          wrapper.appendChild(container);
        }

        renderMock(...args);
      };
    },
    setLanguageOverride: (...args: [Record<string, unknown>, string]) => setLanguageOverrideMock(...args),
  };
});

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
    diffMocks.parsePatchFilesMock.mockReset();
    if (diffMocks.actualParsePatchFiles) {
      diffMocks.parsePatchFilesMock.mockImplementation(diffMocks.actualParsePatchFiles);
    }
    renderMock.mockReset();
    clearContextShortcuts("diff");
    resetContext();
    document.body.innerHTML = "";
  });

  it("forces Bazel diffs to use python highlighting", async () => {
    diffMocks.parsePatchFilesMock.mockReturnValueOnce([
      {
        files: [
          {
            oldName: "BUILD.bazel",
            newName: "BUILD.bazel",
            hunks: [],
          },
        ],
      },
    ]);

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
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
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
    const renderArg = renderMock.mock.calls.at(-1)?.[0];
    expect(renderArg?.fileDiff).toMatchObject({
      oldName: "BUILD.bazel",
      newName: "BUILD.bazel",
      languageOverride: "python",
    });

    wrapper.unmount();
  });

  it("renders branch diffs with quoted Git patch paths", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_merge_base") return "abc123";
      if (command === "git_diff_range") {
        return [
          'diff --git "a/file name.txt" "b/file name.txt"',
          "index 7898192..6178079 100644",
          '--- "a/file name.txt"',
          '+++ "b/file name.txt"',
          "@@ -1 +1 @@",
          "-before",
          "+after",
          "",
        ].join("\n");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "branch",
        baseRef: "origin/main",
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

    const renderArg = renderMock.mock.calls.at(-1)?.[0];
    expect(renderArg?.fileDiff).toMatchObject({
      name: "file name.txt",
    });

    wrapper.unmount();
  });

  it("renders a sticky filename header for each diff file", async () => {
    diffMocks.parsePatchFilesMock.mockReturnValueOnce([
      {
        files: [
          {
            name: "src/sticky.ts",
            hunks: [],
          },
        ],
      },
    ]);

    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/src/sticky.ts b/src/sticky.ts";
      return "";
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
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

    const header = wrapper.get(".diff-file-header");
    expect(header.text()).toBe("src/sticky.ts");
    expect(header.classes()).toContain("diff-file-header");
    expect((header.element as HTMLElement).style.position).toBe("sticky");
    expect((header.element as HTMLElement).style.top).toBe("-1px");

    wrapper.unmount();
  });

  it("restores the previous scroll position when switching diff scopes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/working.txt b/working.txt";
      if (command === "git_default_branch") return "main";
      if (command === "git_merge_base") return "base-sha";
      if (command === "git_diff_range") return "diff --git a/branch.txt b/branch.txt";
      return "";
    });
    renderMock.mockImplementation(({ containerWrapper }: { containerWrapper?: HTMLElement }) => {
      containerWrapper?.parentElement?.scrollTo({ top: 0 });
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
      },
      attachTo: document.body,
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const container = wrapper.get(".diff-container").element as HTMLElement;
    container.scrollTo = ({ top }: ScrollToOptions) => {
      container.scrollTop = top ?? 0;
    };

    await flushPromises();
    await flushPromises();

    const [workingButton, branchButton] = wrapper.findAll("button");

    container.scrollTop = 240;
    await branchButton.trigger("click");
    await flushPromises();
    await flushPromises();

    container.scrollTop = 520;
    await workingButton.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(container.scrollTop).toBe(240);

    await branchButton.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(container.scrollTop).toBe(520);

    wrapper.unmount();
  });

  it("opens diff search with slash and focuses the input", async () => {
    diffMocks.parsePatchFilesMock.mockReturnValueOnce([
      {
        files: [
          {
            name: "src/example.ts",
            oldName: "src/example.ts",
            newName: "src/example.ts",
            hunks: [
              {
                hunkSpecs: "@@ -1,1 +1,1 @@",
                hunkContext: "function demo()",
                unifiedLineStart: 0,
                hunkContent: [
                  {
                    type: "change",
                    deletions: 1,
                    deletionLineIndex: 0,
                    additions: 1,
                    additionLineIndex: 0,
                  },
                ],
              },
            ],
            additionLines: ["const alpha = 2;"],
            deletionLines: ["const alpha = 1;"],
            __searchRows: [
              { lineIndex: "0,0", text: "const alpha = 1;" },
              { lineIndex: "1,0", text: "const alpha = 2;" },
            ],
          },
        ],
      },
    ]);

    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/src/example.ts b/src/example.ts";
      return "";
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
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

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    expect(document.activeElement).toBe(input.element);

    wrapper.unmount();
  });

  it("returns focus to the diff view after confirming search with Enter", async () => {
    diffMocks.parsePatchFilesMock.mockReturnValueOnce([
      {
        files: [
          {
            name: "src/example.ts",
            oldName: "src/example.ts",
            newName: "src/example.ts",
            hunks: [
              {
                hunkSpecs: "@@ -1,1 +1,1 @@",
                hunkContext: "function demo()",
                unifiedLineStart: 0,
                hunkContent: [
                  {
                    type: "change",
                    deletions: 1,
                    deletionLineIndex: 0,
                    additions: 1,
                    additionLineIndex: 0,
                  },
                ],
              },
            ],
            additionLines: ["const alpha = 2;"],
            deletionLines: ["const alpha = 1;"],
            __searchRows: [
              { lineIndex: "0,0", text: "const alpha = 1;" },
              { lineIndex: "1,0", text: "const alpha = 2;" },
            ],
          },
        ],
      },
    ]);

    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/src/example.ts b/src/example.ts";
      return "";
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
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

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    await input.setValue("alpha");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get(".diff-view").element);

    wrapper.unmount();
  });

  it("marks the active diff search result in the rendered diff", async () => {
    diffMocks.parsePatchFilesMock.mockReturnValueOnce([
      {
        files: [
          {
            name: "src/example.ts",
            oldName: "src/example.ts",
            newName: "src/example.ts",
            hunks: [
              {
                hunkSpecs: "@@ -1,1 +1,1 @@",
                hunkContext: "function demo()",
                unifiedLineStart: 0,
                hunkContent: [
                  {
                    type: "change",
                    deletions: 1,
                    deletionLineIndex: 0,
                    additions: 1,
                    additionLineIndex: 0,
                  },
                ],
              },
            ],
            additionLines: ["const alpha = 2;"],
            deletionLines: ["const alpha = 1;"],
            __searchRows: [
              { lineIndex: "0,0", text: "const alpha = 1;" },
              { lineIndex: "1,0", text: "const alpha = 2;" },
            ],
          },
        ],
      },
    ]);

    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff") return "diff --git a/src/example.ts b/src/example.ts";
      return "";
    });

    const wrapper = mount(DiffView, {
      props: {
        repoPath: "/repo",
        initialScope: "working",
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

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    await input.setValue("alpha");
    await flushPromises();

    const container = wrapper.find(".diff-file diffs-container").element as HTMLElement;
    const shadowRoot = container.shadowRoot;

    expect(shadowRoot?.querySelector('[data-content] [data-line-index="0,0"]')?.classList.contains("diff-search-match")).toBe(true);
    expect(shadowRoot?.querySelector('[data-content] [data-line-index="0,0"]')?.classList.contains("diff-search-active")).toBe(true);
    expect(shadowRoot?.querySelector("[data-title]")?.classList.contains("diff-search-match")).toBe(false);

    wrapper.unmount();
  });
});
