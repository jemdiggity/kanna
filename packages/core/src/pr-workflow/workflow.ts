import type { Stage } from "../pipeline/types.js";

export function validatePRCreation(
  stage: Stage,
  existingPrNumber: number | null
): void {
  if (stage !== "in_progress") {
    throw new Error(
      `Cannot create a PR from stage "${stage}". Item must be in_progress.`
    );
  }

  if (existingPrNumber !== null) {
    throw new Error(
      `A PR (#${existingPrNumber}) already exists for this pipeline item.`
    );
  }
}
