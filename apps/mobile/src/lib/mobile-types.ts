export type MobileTab = "tasks" | "recent" | "more";

export interface MobileRepo {
  id: string;
  name: string;
  path: string;
}

export interface MobileTask {
  id: string;
  repo_id: string;
  title: string;
  repoName: string;
  stage: string;
  branch: string | null;
  displayName: string | null;
  prompt: string | null;
  prNumber: number | null;
  pinned: boolean;
  pinOrder: number | null;
  updatedAt: string | null;
  createdAt: string | null;
  lastOutputPreview: string;
}

export interface MobileCommand {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
