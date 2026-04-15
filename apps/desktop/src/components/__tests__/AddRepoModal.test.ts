// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddRepoModal from "../AddRepoModal.vue";

interface LocalRepoFixture {
  exists: boolean;
  branch: string;
  remote: string;
}

const localRepos = new Map<string, LocalRepoFixture>([
  [
    "/Users/me/code/project",
    {
      exists: true,
      branch: "main",
      remote: "git@github.com:owner/project.git",
    },
  ],
  [
    "/Users/me/code/design-system",
    {
      exists: true,
      branch: "trunk",
      remote: "git@github.com:owner/design-system.git",
    },
  ],
]);

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (command: string, args?: { path?: string; repoPath?: string }) => {
    const localPath = args?.path ?? args?.repoPath;
    const fixture = localPath ? localRepos.get(localPath) : undefined;

    if (command === "file_exists") {
      return fixture?.exists ?? false;
    }
    if (command === "git_default_branch" && fixture) {
      return fixture.branch;
    }
    if (command === "git_remote_url" && fixture) {
      return fixture.remote;
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

function mountModal(initialTab: "create" | "import" = "import") {
  return mount(AddRepoModal, {
    props: {
      initialTab,
    },
    attachTo: document.body,
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

  it("collapses the local repo name behind an explicit change link", async () => {
    const wrapper = mountModal();

    await flushPromises();

    const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');
    await importInput.setValue("/Users/me/code/project");
    await flushPromises();

    expect(wrapper.find('input[placeholder="addRepo.repoNamePlaceholder"]').exists()).toBe(false);

    const repoNameRow = wrapper.get(".repo-name-row");
    expect(repoNameRow.find(".repo-name-label").text()).toBe("addRepo.repoNameLabel");
    expect(repoNameRow.find(".repo-name-value").text()).toBe("project");
    expect(repoNameRow.find(".repo-name-change").text()).toBe("addRepo.change");

    await repoNameRow.get(".repo-name-change").trigger("click");
    await flushPromises();

    const repoNameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
    expect(document.activeElement).toBe(repoNameInput.element);
    expect(repoNameInput.element.selectionStart).toBe(0);
    expect(repoNameInput.element.selectionEnd).toBe("project".length);

    await repoNameInput.setValue("Project Desktop");
    await repoNameInput.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.find('input[placeholder="addRepo.repoNamePlaceholder"]').exists()).toBe(false);
    expect(wrapper.get(".repo-name-value").text()).toBe("Project Desktop");

    await wrapper.get(".btn-primary").trigger("click");

    expect(wrapper.emitted("import")).toEqual([
      ["/Users/me/code/project", "Project Desktop", "main"],
    ]);
  });

  it("keeps focus on the import input until rename mode is opened explicitly", async () => {
    const wrapper = mountModal("create");

    await flushPromises();

    const createInput = wrapper.get('input[placeholder="addRepo.namePlaceholder"]');
    const tabs = wrapper.findAll("button.tab");
    const createTab = tabs[0];
    const importTab = tabs[1];

    createInput.element.focus();
    await flushPromises();
    expect(document.activeElement).toBe(createInput.element);

    const importMouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    importTab.element.dispatchEvent(importMouseDown);
    expect(importMouseDown.defaultPrevented).toBe(true);

    await importTab.trigger("click");
    await flushPromises();

    const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');
    expect(document.activeElement).toBe(importInput.element);

    await importInput.setValue("/Users/me/code/project");
    await flushPromises();

    expect(document.activeElement).toBe(importInput.element);
    expect(wrapper.find('input[placeholder="addRepo.repoNamePlaceholder"]').exists()).toBe(false);

    await wrapper.get(".repo-name-change").trigger("click");
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]').element);

    const createMouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    createTab.element.dispatchEvent(createMouseDown);
    expect(createMouseDown.defaultPrevented).toBe(true);

    await createTab.trigger("click");
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('input[placeholder="addRepo.namePlaceholder"]').element);

    wrapper.unmount();
  });
});
