import { isTeardownStage } from "./taskStages";

export interface TaskCloseBehaviorInput {
  wasBlocked: boolean;
  currentStage: string;
  hasTeardownCommands: boolean;
}

export type TaskCloseBehavior = "finish" | "enter-teardown";

export function getTaskCloseBehavior(
  input: TaskCloseBehaviorInput,
): TaskCloseBehavior {
  if (
    input.wasBlocked ||
    isTeardownStage(input.currentStage) ||
    !input.hasTeardownCommands
  ) {
    return "finish";
  }

  return "enter-teardown";
}
