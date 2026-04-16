export interface PromptContext {
  taskPrompt?: string;
  prevResult?: string;
  branch?: string;
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
    .split("$TASK_PROMPT").join(context.taskPrompt ?? "")
    .split("$PREV_RESULT").join(context.prevResult ?? "")
    .split("$BRANCH").join(context.branch ?? "");
}
