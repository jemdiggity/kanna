import type {
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
  createPairingSession(): Promise<PairingSession>;
}

export interface KannaClient {
  getStatus(): Promise<MobileServerStatus>;
  listDesktops(): Promise<DesktopSummary[]>;
  listRecentTasks(): Promise<TaskSummary[]>;
  searchTasks(query: string): Promise<TaskSummary[]>;
  createPairingSession(): Promise<PairingSession>;
}

export function createKannaClient(transport: KannaTransport): KannaClient {
  return {
    getStatus: () => transport.getStatus(),
    listDesktops: () => transport.listDesktops(),
    listRecentTasks: () => transport.listRecentTasks(),
    searchTasks: (query) => transport.searchTasks(query),
    createPairingSession: () => transport.createPairingSession()
  };
}
