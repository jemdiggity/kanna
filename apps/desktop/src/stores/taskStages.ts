export const TEARDOWN_STAGE = "teardown";
export const LEGACY_TORNDOWN_STAGE = "torndown";

export function isTeardownStage(stage: string): boolean {
  return stage === TEARDOWN_STAGE || stage === LEGACY_TORNDOWN_STAGE;
}

export function normalizePipelineStage(stage: string): string {
  return isTeardownStage(stage) ? TEARDOWN_STAGE : stage;
}
