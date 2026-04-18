import { MOBILE_E2E_IDS } from "../../src/e2eTestIds";

export const selectors = {
  appShell: `~${MOBILE_E2E_IDS.appShell}`,
  tasksScreen: `~${MOBILE_E2E_IDS.tasksScreen}`,
  taskDetailScreen: `~${MOBILE_E2E_IDS.taskDetailScreen}`,
  taskBackButton: `~${MOBILE_E2E_IDS.taskBackButton}`,
  taskRowsXPath: '//*[starts-with(@name, "mobile.task-row.")]'
} as const;
