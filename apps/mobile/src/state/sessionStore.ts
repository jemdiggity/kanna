import type {
  DesktopMode,
  DesktopSummary,
  RepoSummary,
  TaskSummary
} from "../lib/api/types";
import type { PersistedSessionContext } from "./sessionPersistence";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";
export type MobileView = "tasks" | "recent" | "search" | "desktops" | "more";

export interface SessionState {
  connectionMode: DesktopMode | null;
  connectionState: ConnectionState;
  desktopName: string | null;
  serverStatus: string | null;
  errorMessage: string | null;
  desktops: DesktopSummary[];
  selectedDesktopId: string | null;
  repos: RepoSummary[];
  selectedRepoId: string | null;
  recentTasks: TaskSummary[];
  searchQuery: string;
  searchResults: TaskSummary[];
  selectedTaskId: string | null;
  activeView: MobileView;
  pairingCode: string | null;
  isComposerOpen: boolean;
  composerPrompt: string;
}

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  getPersistedContext(): PersistedSessionContext;
  hydrateContext(context: PersistedSessionContext): void;
  setConnectionMode(mode: DesktopMode | null): void;
  setConnectionState(state: ConnectionState): void;
  setDesktopStatus(status: string | null, desktopName: string | null, pairingCode: string | null): void;
  setErrorMessage(message: string | null): void;
  setDesktops(desktops: DesktopSummary[]): void;
  selectDesktop(desktopId: string): void;
  setRepos(repos: RepoSummary[]): void;
  selectRepo(repoId: string): void;
  setRecentTasks(tasks: TaskSummary[]): void;
  setSearchResults(query: string, results: TaskSummary[]): void;
  setSelectedTask(taskId: string | null): void;
  setActiveView(view: MobileView): void;
  setPairingCode(code: string | null): void;
  setComposerState(isOpen: boolean, prompt: string): void;
}

export function createSessionStore(): SessionStore {
  let state: SessionState = {
    connectionMode: null,
    connectionState: "idle",
    desktopName: null,
    serverStatus: null,
    errorMessage: null,
    desktops: [],
    selectedDesktopId: null,
    repos: [],
    selectedRepoId: null,
    recentTasks: [],
    searchQuery: "",
    searchResults: [],
    selectedTaskId: null,
    activeView: "tasks",
    pairingCode: null,
    isComposerOpen: false,
    composerPrompt: ""
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
    getPersistedContext() {
      return {
        selectedDesktopId: state.selectedDesktopId,
        selectedRepoId: state.selectedRepoId,
        selectedTaskId: state.selectedTaskId,
        activeView: state.activeView
      };
    },
    hydrateContext(context) {
      state = {
        ...state,
        selectedDesktopId: context.selectedDesktopId,
        selectedRepoId: context.selectedRepoId,
        selectedTaskId: context.selectedTaskId,
        activeView: context.activeView
      };
      publish();
    },
    setConnectionMode(mode) {
      state = { ...state, connectionMode: mode };
      publish();
    },
    setConnectionState(connectionState) {
      state = { ...state, connectionState };
      publish();
    },
    setDesktopStatus(serverStatus, desktopName, pairingCode) {
      state = { ...state, serverStatus, desktopName, pairingCode };
      publish();
    },
    setErrorMessage(errorMessage) {
      state = { ...state, errorMessage };
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
    setRepos(repos) {
      const hasSelectedRepo = repos.some((repo) => repo.id === state.selectedRepoId);
      state = {
        ...state,
        repos,
        selectedRepoId: hasSelectedRepo ? state.selectedRepoId : repos[0]?.id ?? null
      };
      publish();
    },
    selectRepo(repoId) {
      state = {
        ...state,
        selectedRepoId: repoId
      };
      publish();
    },
    setRecentTasks(tasks) {
      const hasSelectedTask = tasks.some((task) => task.id === state.selectedTaskId);
      state = {
        ...state,
        recentTasks: tasks,
        selectedTaskId: hasSelectedTask ? state.selectedTaskId : null
      };
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
    setSelectedTask(selectedTaskId) {
      state = { ...state, selectedTaskId };
      publish();
    },
    setActiveView(activeView) {
      state = { ...state, activeView };
      publish();
    },
    setPairingCode(code) {
      state = { ...state, pairingCode: code };
      publish();
    },
    setComposerState(isComposerOpen, composerPrompt) {
      state = { ...state, isComposerOpen, composerPrompt };
      publish();
    }
  };
}
