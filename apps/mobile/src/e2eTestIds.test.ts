import { describe, expect, it } from "vitest";
import { MOBILE_E2E_IDS } from "./e2eTestIds";

describe("MOBILE_E2E_IDS", () => {
  it("keeps the smoke-test selectors stable", () => {
    expect(MOBILE_E2E_IDS.appShell).toBe("mobile.app-shell");
    expect(MOBILE_E2E_IDS.tasksScreen).toBe("mobile.tasks-screen");
    expect(MOBILE_E2E_IDS.taskDetailScreen).toBe("mobile.task-detail-screen");
    expect(MOBILE_E2E_IDS.taskBackButton).toBe("mobile.task-back-button");
  });
});
