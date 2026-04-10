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

vi.mock("../../invoke", () => ({
  invoke: (...args: [string, Record<string, unknown> | undefined]) => invokeMock(...args),
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
    render = (...args: [Record<string, unknown>]) => renderMock(...args);
  },
  setLanguageOverride: (...args: [Record<string, unknown>, string]) => setLanguageOverrideMock(...args),
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
});
