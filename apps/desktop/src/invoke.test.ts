// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

describe("invoke browser mock routing", () => {
  it("routes git_list_base_branches through the browser mock handler", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { invoke } = await import("./invoke");

    await expect(invoke("git_list_base_branches", { repoPath: "/tmp/repo" })).resolves.toEqual([
      "origin/main",
      "main",
    ]);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
