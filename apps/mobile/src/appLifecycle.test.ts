import { describe, expect, it } from "vitest";
import { shouldRefreshOnAppStateTransition } from "./appLifecycle";

describe("shouldRefreshOnAppStateTransition", () => {
  it("refreshes when the app returns to the foreground", () => {
    expect(shouldRefreshOnAppStateTransition("background", "active")).toBe(true);
    expect(shouldRefreshOnAppStateTransition("inactive", "active")).toBe(true);
  });

  it("does not refresh for non-foreground transitions", () => {
    expect(shouldRefreshOnAppStateTransition("active", "inactive")).toBe(false);
    expect(shouldRefreshOnAppStateTransition("active", "background")).toBe(false);
    expect(shouldRefreshOnAppStateTransition("background", "background")).toBe(false);
  });
});
