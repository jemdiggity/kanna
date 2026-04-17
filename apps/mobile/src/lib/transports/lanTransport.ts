import type { KannaTransport } from "../api/client";
import type {
  DesktopDescriptor,
  DesktopSummary,
  MobileServerStatus,
  PairingSession,
  RepoSummary,
  TaskActionResponse,
  TaskSummary
} from "../api/types";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
  }
) => Promise<FetchResponseLike>;

export function createLanTransport(
  baseUrl: string,
  fetchImpl: FetchLike
): KannaTransport {
  const request = async <T>(path: string, init?: { method?: string }): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`LAN request failed (${response.status}) for ${path}`);
    }

    return response.json() as Promise<T>;
  };

  return {
    getStatus: () => request<MobileServerStatus>("/v1/status"),
    async listDesktops() {
      const desktops = await request<DesktopDescriptor[]>("/v1/desktops");
      return desktops.map(mapDesktopSummary);
    },
    listRecentTasks: () => request<TaskSummary[]>("/v1/tasks/recent"),
    searchTasks: (query) =>
      request<TaskSummary[]>(`/v1/tasks/search?query=${encodeURIComponent(query)}`),
    createTask: (input: CreateTaskRequest) =>
      request<CreateTaskResponse>("/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }),
    runMergeAgent: (taskId: string) =>
      request<TaskActionResponse>(`/v1/tasks/${encodeURIComponent(taskId)}/actions/run-merge-agent`, {
        method: "POST"
      }),
    createPairingSession: () =>
      request<PairingSession>("/v1/pairing/sessions", { method: "POST" })
  };
}

function mapDesktopSummary(desktop: DesktopDescriptor): DesktopSummary {
  return {
    id: desktop.id,
    name: desktop.name,
    online: true,
    mode: desktop.connectionMode === "remote" ? "remote" : "lan"
  };
}
