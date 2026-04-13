export function shouldIgnoreRuntimeStatusDuringSetup(
  status: string,
  isPendingSetup: boolean,
): boolean {
  return isPendingSetup && status === "idle";
}
