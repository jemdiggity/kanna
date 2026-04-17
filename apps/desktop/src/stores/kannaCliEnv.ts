interface BuildKannaCliEnvOptions {
  taskId: string;
  dbName: string;
  appDataDir: string;
  socketPath: string;
}

export function buildKannaCliEnv(options: BuildKannaCliEnvOptions): Record<string, string> {
  const { taskId, dbName, appDataDir, socketPath } = options;

  return {
    KANNA_TASK_ID: taskId,
    KANNA_CLI_DB_PATH: `${appDataDir}/${dbName}`,
    KANNA_SOCKET_PATH: socketPath,
  };
}

interface BuildTaskRuntimeEnvOptions extends BuildKannaCliEnvOptions {
  portEnv?: Record<string, string>;
  kannaCliPath?: string | null;
}

export function buildTaskRuntimeEnv(options: BuildTaskRuntimeEnvOptions): Record<string, string> {
  const { portEnv, kannaCliPath, ...kannaCliEnvOptions } = options;

  return {
    KANNA_WORKTREE: "1",
    ...(portEnv ?? {}),
    ...(kannaCliPath ? { KANNA_CLI_PATH: kannaCliPath } : {}),
    ...buildKannaCliEnv(kannaCliEnvOptions),
  };
}
