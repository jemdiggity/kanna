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
      render = (...args: [Record<string, unknown>]) => renderMock(...args);
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
});
