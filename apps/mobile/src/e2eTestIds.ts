export const MOBILE_E2E_IDS = {
  appShell: "mobile.app-shell",
  tasksScreen: "mobile.tasks-screen",
  taskDetailScreen: "mobile.task-detail-screen",
  taskBackButton: "mobile.task-back-button",
  taskMoreButton: "mobile.task-more-button",
  taskInput: "mobile.task-input",
  taskSendButton: "mobile.task-send-button",
  terminalOverlay: "mobile.terminal-overlay",
  taskListItem(taskId: string): string {
    return `mobile.task-row.${taskId}`;
  }
} as const;
