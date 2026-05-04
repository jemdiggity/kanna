export interface PromptContext {
  taskPrompt?: string;
  prevResult?: string;
  branch?: string;
  baseRef?: string;
  sourceWorktree?: string;
}

export function buildStagePrompt(
  agentPrompt: string,
  stagePrompt: string | undefined,
  context: PromptContext
): string {
  const parts = [agentPrompt, stagePrompt].filter(
    (p): p is string => p !== undefined && p.trim() !== ""
  );
  const combined = parts.join("\n\n");

  return combined
    .replaceAll("$TASK_PROMPT", context.taskPrompt ?? "")
    .replaceAll("$PREV_RESULT", context.prevResult ?? "")
    .replaceAll("$BRANCH", context.branch ?? "")
    .replaceAll("$BASE_REF", context.baseRef ?? "")
    .replaceAll("$SOURCE_WORKTREE", context.sourceWorktree ?? "");
}
