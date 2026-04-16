import type { MobileTask } from "./mobile-types";

interface TaskGroup {
  repoId: string;
  repoName: string;
  tasks: MobileTask[];
}

const STAGE_RANK: Record<string, number> = {
  merge: 1,
  pr: 2,
  "in progress": 3,
  blocked: 4,
};

function compareByUpdatedAtDesc(a: MobileTask, b: MobileTask): number {
  const aKey = a.updatedAt ?? a.createdAt ?? "";
  const bKey = b.updatedAt ?? b.createdAt ?? "";
  return bKey.localeCompare(aKey);
}

function compareTasks(a: MobileTask, b: MobileTask): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }

  if (a.pinned && b.pinned) {
    return (a.pinOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinOrder ?? Number.MAX_SAFE_INTEGER);
  }

  const stageDelta = (STAGE_RANK[a.stage] ?? 99) - (STAGE_RANK[b.stage] ?? 99);
  if (stageDelta !== 0) return stageDelta;
  return compareByUpdatedAtDesc(a, b);
}

export function groupTasksByRepo(tasks: MobileTask[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const existing = groups.get(task.repo_id);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }

    groups.set(task.repo_id, {
      repoId: task.repo_id,
      repoName: task.repoName,
      tasks: [task],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: [...group.tasks].sort(compareTasks),
    }))
    .sort((a, b) => a.repoName.localeCompare(b.repoName));
}

export function buildRecentTasks(tasks: MobileTask[]): MobileTask[] {
  return [...tasks].sort(compareByUpdatedAtDesc);
}
