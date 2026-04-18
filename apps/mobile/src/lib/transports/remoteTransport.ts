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

interface RemoteDesktopRecord {
  desktopId: string;
  displayName: string;
  online: boolean;
  reachableViaRelay: boolean;
  connectionMode: "lan" | "internet" | "both";
  lastSeenAt?: string | null;
}

export function createRemoteTransport(
  listDesktopRecords: () => Promise<RemoteDesktopRecord[]>
): KannaTransport {
  return {
    async getStatus(): Promise<MobileServerStatus> {
      throw new Error("Remote status transport not implemented yet");
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
