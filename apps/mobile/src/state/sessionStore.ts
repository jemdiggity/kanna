import type { DesktopMode, DesktopSummary, TaskSummary } from "../lib/api/types";

export interface SessionState {
  connectionMode: DesktopMode | null;
  desktops: DesktopSummary[];
  selectedDesktopId: string | null;
  recentTasks: TaskSummary[];
  searchQuery: string;
  searchResults: TaskSummary[];
  pairingCode: string | null;
}

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  setConnectionMode(mode: DesktopMode | null): void;
  setDesktops(desktops: DesktopSummary[]): void;
  selectDesktop(desktopId: string): void;
  setRecentTasks(tasks: TaskSummary[]): void;
  setSearchResults(query: string, results: TaskSummary[]): void;
  setPairingCode(code: string | null): void;
}

export function createSessionStore(): SessionStore {
  let state: SessionState = {
    connectionMode: null,
    desktops: [],
    selectedDesktopId: null,
    recentTasks: [],
    searchQuery: "",
    searchResults: [],
    pairingCode: null
  };

  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setConnectionMode(mode) {
      state = { ...state, connectionMode: mode };
      publish();
    },
    setDesktops(desktops) {
      const hasSelectedDesktop = desktops.some(
        (desktop) => desktop.id === state.selectedDesktopId
      );
      state = {
        ...state,
        desktops,
        selectedDesktopId: hasSelectedDesktop
          ? state.selectedDesktopId
          : desktops[0]?.id ?? null
      };
      publish();
    },
    selectDesktop(desktopId) {
      state = {
        ...state,
        selectedDesktopId: desktopId
      };
      publish();
    },
    setRecentTasks(tasks) {
      state = { ...state, recentTasks: tasks };
      publish();
    },
    setSearchResults(query, results) {
      state = {
        ...state,
        searchQuery: query,
        searchResults: results
      };
      publish();
    },
    setPairingCode(code) {
      state = { ...state, pairingCode: code };
      publish();
    }
  };
}
