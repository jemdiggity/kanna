import { isTeardownStage } from "./taskStages";

export interface TaskCloseBehaviorInput {
  wasBlocked: boolean;
  currentStage: string;
}

export type TaskCloseBehavior = "finish" | "enter-teardown";

export function getTaskCloseBehavior(
  input: TaskCloseBehaviorInput,
): TaskCloseBehavior {
  if (input.wasBlocked || isTeardownStage(input.currentStage)) {
    return "finish";
  }

  return "enter-teardown";
}
