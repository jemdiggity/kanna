interface BuildKannaCliEnvOptions {
  taskId: string;
  dbName: string;
  appDataDir: string;
  socketPath: string;
  serverBaseUrl?: string;
}

export function buildKannaCliEnv(options: BuildKannaCliEnvOptions): Record<string, string> {
  const { taskId, dbName, appDataDir, socketPath, serverBaseUrl } = options;

  return {
    KANNA_TASK_ID: taskId,
    KANNA_CLI_DB_PATH: `${appDataDir}/${dbName}`,
    KANNA_SOCKET_PATH: socketPath,
    ...(serverBaseUrl ? { KANNA_SERVER_BASE_URL: serverBaseUrl } : {}),
  };
}

interface BuildTaskRuntimeEnvOptions extends BuildKannaCliEnvOptions {
  portEnv?: Record<string, string>;
  kannaCliPath?: string | null;
}

export function buildTaskRuntimeEnv(options: BuildTaskRuntimeEnvOptions): Record<string, string> {
  const { portEnv, kannaCliPath, ...kannaCliEnvOptions } = options;
  const serverBaseUrl = kannaCliEnvOptions.serverBaseUrl
    ?? (portEnv?.KANNA_MOBILE_SERVER_PORT ? `http://127.0.0.1:${portEnv.KANNA_MOBILE_SERVER_PORT}` : "http://127.0.0.1:48120");

  return {
    KANNA_WORKTREE: "1",
    ...(portEnv ?? {}),
    ...(kannaCliPath ? { KANNA_CLI_PATH: kannaCliPath } : {}),
    ...buildKannaCliEnv({ ...kannaCliEnvOptions, serverBaseUrl }),
  };
}
