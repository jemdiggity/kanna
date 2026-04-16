import { isTeardownStage, TEARDOWN_STAGE } from "./taskStages";

export interface CloseSelectionTransition {
  selectNext: boolean;
  wasBlocked: boolean;
  previousStage: string;
  nextStage: string;
}

export function shouldSelectNextOnCloseTransition(
  transition: CloseSelectionTransition,
): boolean {
  return (
    transition.selectNext &&
    !transition.wasBlocked &&
    !isTeardownStage(transition.previousStage) &&
    (transition.nextStage === TEARDOWN_STAGE || transition.nextStage === "done")
  );
}
