import type { PipelineDefinition, PipelineStage } from "./pipeline-types";

export function getStageIndex(pipeline: PipelineDefinition, stageName: string): number {
  return pipeline.stages.findIndex(s => s.name === stageName);
}

export function getNextStage(pipeline: PipelineDefinition, currentStage: string): PipelineStage | null {
  const idx = getStageIndex(pipeline, currentStage);
  if (idx === -1 || idx >= pipeline.stages.length - 1) return null;
  return pipeline.stages[idx + 1];
}

export function isLastStage(pipeline: PipelineDefinition, stageName: string): boolean {
  return getStageIndex(pipeline, stageName) === pipeline.stages.length - 1;
}

