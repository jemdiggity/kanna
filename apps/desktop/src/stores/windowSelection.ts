import type { StoreContext } from "./state";

export async function isTaskSelectedInAnyWindow(
  context: StoreContext,
  taskId: string,
): Promise<boolean> {
  if (context.state.selectedItemId.value === taskId) {
    return true;
  }

  try {
    const snapshot = await context.services.windowWorkspace?.loadSnapshot();
    return snapshot?.windows.some((entry) => entry.selectedItemId === taskId) ?? false;
  } catch (error) {
    console.error("[store] failed to inspect window workspace selection:", error);
    return false;
  }
}
