// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppUpdatePrompt from "../AppUpdatePrompt.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

function makeController(
  overrides: {
    status?: "idle" | "checking" | "available" | "downloading" | "readyToRestart" | "error";
    updateVersion?: string | null;
    releaseNotes?: string | null;
    publishedAt?: string | null;
    dismissedVersion?: string | null;
    downloadedBytes?: number;
    contentLength?: number | null;
    errorMessage?: string | null;
  } = {},
) {
  const status = ref<"idle" | "checking" | "available" | "downloading" | "readyToRestart" | "error">(
    overrides.status ?? "available",
  );

  return {
    status,
    updateVersion: ref(overrides.updateVersion ?? "0.0.39"),
    releaseNotes: ref(overrides.releaseNotes ?? "Notes for 0.0.39"),
    publishedAt: ref(overrides.publishedAt ?? "2026-04-15T00:00:00Z"),
    dismissedVersion: ref<string | null>(overrides.dismissedVersion ?? null),
    downloadedBytes: ref(overrides.downloadedBytes ?? 0),
    contentLength: ref<number | null>(overrides.contentLength ?? null),
    errorMessage: ref<string | null>(overrides.errorMessage ?? null),
    visible: computed(() => status.value !== "idle" && status.value !== "checking"),
    start: vi.fn(),
    checkNow: vi.fn(),
    dismiss: vi.fn(),
    install: vi.fn(),
    restartNow: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("AppUpdatePrompt", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the available update details and actions", () => {
    const wrapper = mount(AppUpdatePrompt, {
      props: {
        controller: makeController(),
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("app.update.available");
    expect(wrapper.text()).toContain("0.0.39");
    expect(wrapper.text()).toContain("Notes for 0.0.39");
    expect(wrapper.find(".update-prompt").attributes("role")).toBeUndefined();
    expect(wrapper.get(".update-prompt__status").attributes("role")).toBe("status");
    expect(wrapper.get(".update-prompt__status").attributes("aria-live")).toBe("polite");
    expect(wrapper.get('[data-testid="update-install"]').text()).toBe("app.update.install");
    expect(wrapper.get('[data-testid="update-dismiss"]').attributes("aria-label")).toBe("actions.dismiss");
  });

  it("renders download progress while installing", async () => {
    const controller = makeController({
      status: "downloading",
      downloadedBytes: 12,
      contentLength: 42,
    });

    const wrapper = mount(AppUpdatePrompt, {
      props: { controller },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("app.update.downloading");
    expect(wrapper.text()).toContain("12");
    expect(wrapper.text()).toContain("42");
  });

  it("uses an indeterminate progress bar when content length is zero", async () => {
    const controller = makeController({
      status: "downloading",
      downloadedBytes: 12,
      contentLength: 0,
    });

    const wrapper = mount(AppUpdatePrompt, {
      props: { controller },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const progress = wrapper.get(".update-prompt__progress");
    expect(progress.element.tagName).toBe("PROGRESS");
    expect(progress.attributes("value")).toBeUndefined();
    expect(progress.attributes("max")).toBeUndefined();
    expect(wrapper.findAll(".update-prompt__progress")).toHaveLength(1);
  });

  it("shows the restart action after a successful install", () => {
    const controller = makeController({ status: "readyToRestart" });

    const wrapper = mount(AppUpdatePrompt, {
      props: { controller },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("app.update.readyToRestart");
    expect(wrapper.get('[data-testid="update-restart"]').text()).toBe("app.update.restartNow");
    expect(wrapper.get('[data-testid="update-later"]').text()).toBe("app.update.later");
  });

  it("shows the install error and retry action", () => {
    const controller = makeController({
      status: "error",
      errorMessage: "download failed",
    });

    const wrapper = mount(AppUpdatePrompt, {
      props: { controller },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("app.update.error");
    expect(wrapper.text()).toContain("download failed");
    expect(wrapper.get('[data-testid="update-retry"]').text()).toBe("app.update.retry");
  });
});
