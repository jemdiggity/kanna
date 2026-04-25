// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommitGraphView from "../CommitGraphView.vue";
import {
  clearContextShortcuts,
  getContextShortcuts,
  resetContext,
} from "../../composables/useShortcutContext";

const invokeMock = vi.fn<
  (command: string, args?: Record<string, unknown>) => Promise<unknown>
>();

vi.mock("../../invoke", () => ({
  invoke: (...args: [string, Record<string, unknown> | undefined]) => invokeMock(...args),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

function graphResult() {
  return {
    head_commit: "aaa1111111111111111111111111111111111111",
    commits: [
      {
        hash: "aaa1111111111111111111111111111111111111",
        short_hash: "aaa1111",
        message: "feat: add search bar",
        author: "Jeremy Hale",
        timestamp: 1710000000,
        parents: ["bbb2222222222222222222222222222222222222"],
        refs: ["main", "origin/main"],
      },
      {
        hash: "bbb2222222222222222222222222222222222222",
        short_hash: "bbb2222",
        message: "fix: stabilize graph layout",
        author: "Graph Bot",
        timestamp: 1709990000,
        parents: [],
        refs: ["v0.3.2"],
      },
    ],
  };
}

describe("CommitGraphView", () => {
  afterEach(() => {
    invokeMock.mockReset();
    clearContextShortcuts("graph");
    resetContext();
    document.body.innerHTML = "";
  });

  it("opens search with slash and focuses the input", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
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
  });

  it("matches message, author, hash, and refs", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");

    await input.setValue("Jeremy");
    expect(wrapper.get(".search-count").text()).toBe("1/1");

    await input.setValue("aaa1111");
    expect(wrapper.get(".search-count").text()).toBe("1/1");

    await input.setValue("origin/main");
    expect(wrapper.get(".search-count").text()).toBe("1/1");
  });

  it("returns focus to the graph after confirming search with Enter", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    await input.setValue("graph");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get(".graph-scroll").element);
  });

  it("marks the active and inactive matching rows", async () => {
    invokeMock.mockResolvedValue({
      head_commit: "aaa1111111111111111111111111111111111111",
      commits: [
        {
          hash: "aaa1111111111111111111111111111111111111",
          short_hash: "aaa1111",
          message: "fix graph search",
          author: "Jeremy Hale",
          timestamp: 1710000000,
          parents: ["bbb2222222222222222222222222222222222222"],
          refs: ["main"],
        },
        {
          hash: "bbb2222222222222222222222222222222222222",
          short_hash: "bbb2222",
          message: "search follow-up",
          author: "Jeremy Hale",
          timestamp: 1709990000,
          parents: [],
          refs: [],
        },
      ],
    });

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    await wrapper.get(".search-input").setValue("search");
    await flushPromises();

    expect(wrapper.findAll(".commit-row.is-search-match")).toHaveLength(2);
    expect(wrapper.findAll(".commit-row.is-search-active")).toHaveLength(1);
  });

  it("dismiss closes search before allowing the modal to close", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    expect(wrapper.find(".search-input").exists()).toBe(true);

    const firstDismissResult = (wrapper.vm as { dismiss: () => boolean }).dismiss();
    await flushPromises();

    expect(firstDismissResult).toBe(false);
    expect(wrapper.find(".search-input").exists()).toBe(false);

    const secondDismissResult = (wrapper.vm as { dismiss: () => boolean }).dismiss();
    expect(secondDismissResult).toBe(true);
  });

  it("shows the no-matches label when the query finds nothing", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
    }));
    await flushPromises();

    await wrapper.get(".search-input").setValue("does-not-exist");
    await flushPromises();

    expect(wrapper.get(".search-count").text()).toBe("commitGraph.searchNoMatches");
  });

  it("registers search shortcuts in the graph context", async () => {
    invokeMock.mockResolvedValue(graphResult());

    mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    expect(getContextShortcuts("graph")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "commitGraph.shortcutSearch", keys: "/" }),
        expect.objectContaining({ action: "commitGraph.shortcutSearchAlt", keys: "⌘F" }),
        expect.objectContaining({ action: "commitGraph.shortcutNextPrevMatch", keys: "n / N" }),
      ])
    );
  });
});
