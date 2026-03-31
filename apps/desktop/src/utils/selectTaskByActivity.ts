export interface SelectableTask {
  id: string;
  activity: string | null;
  created_at: string;
}

export type TaskSelectionMode = "oldest" | "newest";
export type TaskSelectionActivity = "unread" | "read";

export function selectTaskByActivity(
  items: readonly SelectableTask[],
  mode: TaskSelectionMode,
  activity: TaskSelectionActivity,
): SelectableTask | null {
  const matches = items.filter((item) =>
    activity === "unread" ? item.activity === "unread" : item.activity !== "unread",
  );
  if (matches.length === 0) return null;

  const compare =
    mode === "oldest"
      ? (a: string, b: string) => a < b
      : (a: string, b: string) => a > b;

  return matches.reduce((selected, candidate) =>
    compare(candidate.created_at, selected.created_at) ? candidate : selected,
  );
}
