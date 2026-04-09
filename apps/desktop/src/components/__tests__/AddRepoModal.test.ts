// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddRepoModal from "../AddRepoModal.vue";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (command: string, args?: { path?: string; repoPath?: string }) => {
    const localPath = "/Users/me/code/project";
    if (command === "file_exists") {
      return args?.path === localPath;
    }
    if (command === "git_default_branch" && args?.repoPath === localPath) {
      return "main";
    }
    if (command === "git_remote_url" && args?.repoPath === localPath) {
      return "git@github.com:owner/project.git";
    }
    return false;
  }),
}));

vi.mock("../../invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("../../dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../composables/useModalZIndex", () => ({
  useModalZIndex: () => ({ zIndex: 1 }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/Users/me"),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

async function flushPromises() {
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountModal() {
  return mount(AddRepoModal, {
    props: {
      initialTab: "import",
    },
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  });
}

describe("AddRepoModal", () => {
  afterEach(() => {
    invokeMock.mockClear();
  });

  it("imports a repo from a pasted absolute path", async () => {
    const wrapper = mountModal();

    await flushPromises();

    await wrapper.get('input[type="text"]').setValue("/Users/me/code/project");
    await flushPromises();

    expect(wrapper.text()).toContain("addRepo.gitRepoConfirmed");

    await wrapper.get(".btn-primary").trigger("click");

    expect(wrapper.emitted("import")).toEqual([
      ["/Users/me/code/project", "project", "main"],
    ]);
  });

  it("expands a pasted tilde path before importing", async () => {
    const wrapper = mountModal();

    await flushPromises();

    await wrapper.get('input[type="text"]').setValue("~/code/project");
    await flushPromises();

    await wrapper.get(".btn-primary").trigger("click");

    expect(invokeMock).toHaveBeenCalledWith("file_exists", { path: "/Users/me/code/project" });
    expect(wrapper.emitted("import")).toEqual([
      ["/Users/me/code/project", "project", "main"],
    ]);
  });
});
