import type {
  CreateTaskRequest,
  CreateTaskResponse,
  RepoSummary,
  DesktopSummary,
  MobileServerStatus,
  PairingSession,
  TaskActionResponse,
  TaskSummary
} from "./types";

export type TaskTerminalStreamEvent =
  | { type: "ready"; taskId: string }
  | { type: "output"; taskId: string; text: string }
  | { type: "exit"; taskId: string; code: number }
  | { type: "error"; taskId: string; message: string };

export interface TaskTerminalSubscription {
  close(): void;
}

export interface KannaTransport {
  getStatus(): Promise<MobileServerStatus>;
  listDesktops(): Promise<DesktopSummary[]>;
  listRecentTasks(): Promise<TaskSummary[]>;
  searchTasks(query: string): Promise<TaskSummary[]>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  runMergeAgent(taskId: string): Promise<TaskActionResponse>;
  observeTaskTerminal(
    taskId: string,
    listener: (event: TaskTerminalStreamEvent) => void
  ): TaskTerminalSubscription;
  createPairingSession(): Promise<PairingSession>;
}

export interface KannaClient {
  getStatus(): Promise<MobileServerStatus>;
  listDesktops(): Promise<DesktopSummary[]>;
  listRecentTasks(): Promise<TaskSummary[]>;
  searchTasks(query: string): Promise<TaskSummary[]>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  runMergeAgent(taskId: string): Promise<TaskActionResponse>;
  observeTaskTerminal(
    taskId: string,
    listener: (event: TaskTerminalStreamEvent) => void
  ): TaskTerminalSubscription;
  createPairingSession(): Promise<PairingSession>;
}

export function createKannaClient(transport: KannaTransport): KannaClient {
  return {
    getStatus: () => transport.getStatus(),
    listDesktops: () => transport.listDesktops(),
    listRecentTasks: () => transport.listRecentTasks(),
    searchTasks: (query) => transport.searchTasks(query),
    createTask: (input) => transport.createTask(input),
    runMergeAgent: (taskId) => transport.runMergeAgent(taskId),
    observeTaskTerminal: (taskId, listener) =>
      transport.observeTaskTerminal(taskId, listener),
    createPairingSession: () => transport.createPairingSession()
  };
}
