import { describe, expect, it } from "bun:test";
import { selectTaskByActivity, type SelectableTask } from "./selectTaskByActivity";

function makeTask(
  id: string,
  createdAt: string,
  activity: SelectableTask["activity"],
): SelectableTask {
  return {
    id,
    created_at: createdAt,
    activity,
  };
}

describe("selectTaskByActivity", () => {
  const tasks = [
    makeTask("idle-old", "2026-03-31T00:00:00.000Z", "idle"),
    makeTask("unread-old", "2026-03-31T01:00:00.000Z", "unread"),
    makeTask("working-mid", "2026-03-31T02:00:00.000Z", "working"),
    makeTask("unread-new", "2026-03-31T03:00:00.000Z", "unread"),
  ];

  it("selects the oldest unread task by created_at", () => {
    expect(selectTaskByActivity(tasks, "oldest", "unread")?.id).toBe("unread-old");
  });

  it("selects the newest unread task by created_at", () => {
    expect(selectTaskByActivity(tasks, "newest", "unread")?.id).toBe("unread-new");
  });

  it("treats any non-unread task as read for shortcut navigation", () => {
    expect(selectTaskByActivity(tasks, "oldest", "read")?.id).toBe("idle-old");
    expect(selectTaskByActivity(tasks, "newest", "read")?.id).toBe("working-mid");
  });

  it("returns null when there is no matching task", () => {
    expect(
      selectTaskByActivity(
        [makeTask("only-unread", "2026-03-31T01:00:00.000Z", "unread")],
        "oldest",
        "read",
      ),
    ).toBeNull();
    expect(selectTaskByActivity([], "newest", "unread")).toBeNull();
  });
});
