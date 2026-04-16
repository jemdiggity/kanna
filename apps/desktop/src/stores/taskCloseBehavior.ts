import { isTeardownStage } from "./taskStages";

export interface TaskCloseBehaviorInput {
  wasBlocked: boolean;
  hasLiveTaskResources?: boolean;
  currentStage: string;
  hasTeardownCommands: boolean;
}

export type TaskCloseBehavior = "finish" | "enter-teardown";

export function getTaskCloseBehavior(
  input: TaskCloseBehaviorInput,
): TaskCloseBehavior {
  if (isTeardownStage(input.currentStage) || !input.hasTeardownCommands) {
    return "finish";
  }

  if (input.wasBlocked && input.hasLiveTaskResources === false) {
    return "finish";
  }

  return "enter-teardown";
}
