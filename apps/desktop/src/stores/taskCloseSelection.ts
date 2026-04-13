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
    transition.previousStage !== "torndown" &&
    transition.nextStage === "torndown"
  );
}
