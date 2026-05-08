import type {
  KannaTransport,
  TaskTerminalStreamEvent,
  TaskTerminalSubscription,
} from "../api/client";
import type {
  CreateTaskRequest,
  CreateTaskResponse,
  DesktopSummary,
  MobileServerStatus,
  PairingSession,
  RepoSummary,
  TaskActionResponse,
  TaskSummary,
} from "../api/types";

export interface RemoteDesktopRecord {
  desktopId: string;
  displayName: string;
  online: boolean;
  reachableViaRelay: boolean;
  connectionMode: "lan" | "internet" | "both";
  lastSeenAt?: string | null;
}

export interface RemoteDesktopInvocationRequest {
  desktopId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: unknown | null;
}

export type RemoteDesktopInvoker = (
  request: RemoteDesktopInvocationRequest
) => Promise<unknown>;

export type RemoteTransportErrorCode =
  | "no_selected_desktop"
  | "remote_invocation_failed"
  | "invalid_status_response";

export class RemoteTransportError extends Error {
  readonly code: RemoteTransportErrorCode;
  readonly cause: unknown;

  constructor(
    code: RemoteTransportErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "RemoteTransportError";
    this.code = code;
    this.cause = cause;
  }
}

export interface RemoteTransportDependencies {
  listDesktopRecords(): Promise<RemoteDesktopRecord[]>;
  getSelectedDesktopId(): string | null;
  invokeDesktop: RemoteDesktopInvoker;
}

export function createRemoteTransport({
  listDesktopRecords,
  getSelectedDesktopId,
  invokeDesktop
}: RemoteTransportDependencies): KannaTransport {
  return {
    async getStatus(): Promise<MobileServerStatus> {
      const desktopId = getSelectedDesktopId();
      if (!desktopId) {
        throw new RemoteTransportError(
          "no_selected_desktop",
          "Select a desktop before connecting remotely."
        );
      }

      try {
        const response = await invokeDesktop({
          desktopId,
          method: "GET",
          path: "/v1/status",
          body: null
        });
        return mapMobileServerStatus(response);
      } catch (error) {
        if (error instanceof RemoteTransportError) {
          throw error;
        }

        throw new RemoteTransportError(
          "remote_invocation_failed",
          `Remote desktop request failed: ${formatErrorMessage(error)}`,
          error
        );
      }
    },
    async listDesktops(): Promise<DesktopSummary[]> {
      const records = await listDesktopRecords();
      return records.map((record) => ({
        id: record.desktopId,
        name: record.displayName,
        online: record.online,
        mode: "remote",
        reachableViaRelay: record.reachableViaRelay,
        connectionMode: record.connectionMode,
        lastSeenAt: record.lastSeenAt ?? null,
      }));
    },
    async listRepos(): Promise<RepoSummary[]> {
      throw new Error("Remote repos transport not implemented yet");
    },
    async listRepoTasks(_repoId: string): Promise<TaskSummary[]> {
      throw new Error("Remote repo tasks transport not implemented yet");
    },
    async listRecentTasks(): Promise<TaskSummary[]> {
      throw new Error("Remote recent tasks transport not implemented yet");
    },
    async searchTasks(_query: string): Promise<TaskSummary[]> {
      throw new Error("Remote search transport not implemented yet");
    },
    async createTask(_input: CreateTaskRequest): Promise<CreateTaskResponse> {
      throw new Error("Remote create task transport not implemented yet");
    },
    async runMergeAgent(_taskId: string): Promise<TaskActionResponse> {
      throw new Error("Remote merge-agent transport not implemented yet");
    },
    async advanceTaskStage(_taskId: string): Promise<TaskActionResponse> {
      throw new Error("Remote advance-stage transport not implemented yet");
    },
    async closeTask(_taskId: string): Promise<void> {
      throw new Error("Remote close-task transport not implemented yet");
    },
    async sendTaskInput(_taskId: string, _input: string): Promise<void> {
      throw new Error("Remote task input transport not implemented yet");
    },
    observeTaskTerminal(
      _taskId: string,
      _listener: (event: TaskTerminalStreamEvent) => void
    ): TaskTerminalSubscription {
      throw new Error("Remote terminal transport not implemented yet");
    },
    async createPairingSession(): Promise<PairingSession> {
      throw new Error(
        "Cloud pairing session is not created from the mobile transport"
      );
    },
  };
}

function mapMobileServerStatus(response: unknown): MobileServerStatus {
  if (!isRecord(response)) {
    throw new RemoteTransportError(
      "invalid_status_response",
      "Remote desktop returned an invalid status response."
    );
  }

  const state = getStringField(response, "state");
  const desktopId = getStringField(response, "desktopId");
  const desktopName = getStringField(response, "desktopName");
  const lanHost = getStringField(response, "lanHost");
  const lanPort = getNumberField(response, "lanPort");
  const pairingCode = getNullableStringField(response, "pairingCode");

  if (
    state === null ||
    desktopId === null ||
    desktopName === null ||
    lanHost === null ||
    lanPort === null
  ) {
    throw new RemoteTransportError(
      "invalid_status_response",
      "Remote desktop returned an invalid status response."
    );
  }

  return {
    state,
    desktopId,
    desktopName,
    lanHost,
    lanPort,
    pairingCode
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(
  record: Record<string, unknown>,
  field: string
): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function getNumberField(
  record: Record<string, unknown>,
  field: string
): number | null {
  const value = record[field];
  return typeof value === "number" ? value : null;
}

function getNullableStringField(
  record: Record<string, unknown>,
  field: string
): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "unknown error";
}
