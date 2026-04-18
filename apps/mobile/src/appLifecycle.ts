import type { AppStateStatus } from "react-native";

export function shouldRefreshOnAppStateTransition(
  previousState: AppStateStatus,
  nextState: AppStateStatus
): boolean {
  return previousState !== "active" && nextState === "active";
}
