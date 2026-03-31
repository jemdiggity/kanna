// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import FilePreviewModal from "../FilePreviewModal.vue";
import { clearContextShortcuts, resetContext } from "../../composables/useShortcutContext";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<
    (command: string, args?: Record<string, unknown>) => Promise<unknown>
  >(),
}));

vi.mock("../../invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("shiki", () => ({
  createHighlighter: vi.fn(async () => ({
    loadLanguage: vi.fn(async () => {}),
    getLoadedLanguages: vi.fn(() => ["text", "typescript"]),
    codeToHtml: vi.fn((code: string) => `<pre><code>${code}</code></pre>`),
  })),
}));

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

describe("FilePreviewModal", () => {
  afterEach(() => {
    invokeMock.mockReset();
    clearContextShortcuts("file");
    resetContext();
    document.body.innerHTML = "";
  });

  it("returns focus to the modal after confirming search with Enter", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "read_text_file") {
        return "alpha beta alpha";
      }
      if (command === "run_script") {
        return "";
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const wrapper = mount(FilePreviewModal, {
      props: {
        filePath: "example.ts",
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

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    expect(document.activeElement).toBe(input.element);

    await input.setValue("alpha");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get(".preview-modal").element);

    wrapper.unmount();
  });
});
