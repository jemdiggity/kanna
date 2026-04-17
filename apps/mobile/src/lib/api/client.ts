import type {
  CreateTaskRequest,
  CreateTaskResponse,
  RepoSummary,
  TaskActionResponse,
  RepoSummary,
  DesktopSummary,
  MobileServerStatus,
  PairingSession,
  TaskSummary
} from "./types";

export interface KannaTransport {
  getStatus(): Promise<MobileServerStatus>;
  listDesktops(): Promise<DesktopSummary[]>;
  listRecentTasks(): Promise<TaskSummary[]>;
  searchTasks(query: string): Promise<TaskSummary[]>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  runMergeAgent(taskId: string): Promise<TaskActionResponse>;
  createPairingSession(): Promise<PairingSession>;
}

export interface KannaClient {
  getStatus(): Promise<MobileServerStatus>;
  listDesktops(): Promise<DesktopSummary[]>;
  listRecentTasks(): Promise<TaskSummary[]>;
  searchTasks(query: string): Promise<TaskSummary[]>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  createTask(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  runMergeAgent(taskId: string): Promise<TaskActionResponse>;
  createPairingSession(): Promise<PairingSession>;
}

export function createKannaClient(transport: KannaTransport): KannaClient {
  return {
    getStatus: () => transport.getStatus(),
    listDesktops: () => transport.listDesktops(),
    listRecentTasks: () => transport.listRecentTasks(),
    searchTasks: (query) => transport.searchTasks(query),
    createTask: (input) => transport.createTask(input),
    createTask: (input) => transport.createTask(input),
    runMergeAgent: (taskId) => transport.runMergeAgent(taskId),
    createPairingSession: () => transport.createPairingSession()
  };
}
