import type {
  KannaTransport,
  TaskTerminalStreamEvent,
  TaskTerminalSubscription
} from "../api/client";
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

export interface WebSocketLike {
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export function createLanTransport(
  baseUrl: string,
  fetchImpl: FetchLike,
  createSocket: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike
): KannaTransport {
  const request = async <T>(path: string, init?: { method?: string }): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`LAN request failed (${response.status}) for ${path}`);
    }

    if (response.status === 204) {
      return undefined as T;
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
    advanceTaskStage: (taskId: string) =>
      request<TaskActionResponse>(`/v1/tasks/${encodeURIComponent(taskId)}/actions/advance-stage`, {
        method: "POST"
      }),
    closeTask: (taskId: string) =>
      request<void>(`/v1/tasks/${encodeURIComponent(taskId)}/actions/close`, {
        method: "POST"
      }),
    sendTaskInput: (taskId: string, input: string) =>
      request<void>(`/v1/tasks/${encodeURIComponent(taskId)}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input })
      }),
    observeTaskTerminal(taskId, listener) {
      const socket = createSocket(buildTaskTerminalWebSocketUrl(baseUrl, taskId));
      let streamEnded = false;

      socket.onopen = () => {
        listener({ type: "ready", taskId });
      };
      socket.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as TaskTerminalStreamEvent;
        if (parsed.type === "exit" || parsed.type === "error") {
          streamEnded = true;
        }
        listener(parsed);
      };
      socket.onerror = () => {
        streamEnded = true;
        listener({
          type: "error",
          taskId,
          message: `Task terminal stream failed for ${taskId}`
        });
      };
      socket.onclose = () => {
        if (streamEnded) {
          return;
        }
        listener({ type: "exit", taskId, code: 0 });
      };

      return {
        close() {
          socket.close();
        }
      } satisfies TaskTerminalSubscription;
    },
    createPairingSession: () =>
      request<PairingSession>("/v1/pairing/sessions", { method: "POST" })
  };
}

function buildTaskTerminalWebSocketUrl(baseUrl: string, taskId: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/v1/tasks/${encodeURIComponent(taskId)}/terminal`;
  url.search = "";
  return url.toString();
}

function mapDesktopSummary(desktop: DesktopDescriptor): DesktopSummary {
  return {
    id: desktop.id,
    name: desktop.name,
    online: true,
    mode: desktop.connectionMode === "remote" ? "remote" : "lan"
  };
}
