import type { CreateTaskResponse, TaskSummary } from "../lib/api/types";
import type { KannaClient } from "../lib/api/client";
import type { MobileView, SessionStore } from "./sessionStore";

export interface MobileController {
  bootstrap(): Promise<void>;
  connectLocal(): Promise<void>;
  refresh(): Promise<void>;
  showView(view: MobileView): void;
  selectDesktop(desktopId: string): void;
  selectRepo(repoId: string): void;
  openTask(taskId: string): void;
  closeTask(): void;
  openComposer(): void;
  closeComposer(): void;
  updateComposerPrompt(prompt: string): void;
  searchTasks(query: string): Promise<void>;
  createTask(): Promise<void>;
  runMergeAgent(taskId: string): Promise<void>;
}

export function createMobileController(
  client: KannaClient,
  store: SessionStore
): MobileController {
  const loadCollections = async () => {
    const [desktops, repos, recentTasks] = await Promise.all([
      client.listDesktops(),
      client.listRepos(),
      client.listRecentTasks()
    ]);

    store.setDesktops(desktops);
    store.setRepos(repos);
    store.setRecentTasks(recentTasks);
  };

  const fail = (error: unknown) => {
    store.setConnectionState("error");
    store.setErrorMessage(error instanceof Error ? error.message : "Mobile app request failed");
  };

  return {
    async bootstrap() {
      store.setErrorMessage(null);

      try {
        const status = await client.getStatus();
        store.setDesktopStatus(status.state, status.desktopName, status.pairingCode);

        if (status.state !== "running") {
          store.setConnectionState("idle");
          return;
        }

        store.setConnectionMode("lan");
        store.setConnectionState("connected");
        store.setActiveView("tasks");
        await loadCollections();
      } catch (error) {
        fail(error);
      }
    },

    async connectLocal() {
      store.setConnectionState("connecting");
      store.setErrorMessage(null);

      try {
        const pairing = await client.createPairingSession();
        await this.bootstrap();
        store.setPairingCode(pairing.code);
      } catch (error) {
        fail(error);
      }
    },

    async refresh() {
      await this.bootstrap();
    },

    showView(view) {
      store.setActiveView(view);
    },

    selectDesktop(desktopId) {
      store.selectDesktop(desktopId);
      store.setSelectedTask(null);
    },

    selectRepo(repoId) {
      store.selectRepo(repoId);
    },

    openTask(taskId) {
      store.setSelectedTask(taskId);
    },

    closeTask() {
      store.setSelectedTask(null);
    },

    openComposer() {
      store.setComposerState(true, store.getState().composerPrompt);
    },

    closeComposer() {
      store.setComposerState(false, "");
    },

    updateComposerPrompt(prompt) {
      store.setComposerState(store.getState().isComposerOpen, prompt);
    },

    async searchTasks(query) {
      store.setErrorMessage(null);
      if (!query.trim()) {
        store.setSearchResults("", []);
        store.setActiveView("tasks");
        return;
      }

      try {
        const results = await client.searchTasks(query);
        store.setSearchResults(query, results);
        store.setActiveView("search");
      } catch (error) {
        fail(error);
      }
    },

    async createTask() {
      const state = store.getState();
      if (!state.selectedRepoId || !state.composerPrompt.trim()) {
        store.setErrorMessage("Choose a repo and enter a task prompt first.");
        return;
      }

      try {
        const created = await client.createTask({
          repoId: state.selectedRepoId,
          prompt: state.composerPrompt.trim()
        });
        const createdTask = mapCreatedTask(created);
        const recentTasks = [
          createdTask,
          ...state.recentTasks.filter((task) => task.id !== createdTask.id)
        ];

        store.setRecentTasks(recentTasks);
        store.setSelectedTask(createdTask.id);
        store.setComposerState(false, "");
        store.setActiveView("tasks");
        store.setErrorMessage(null);
      } catch (error) {
        fail(error);
      }
    },

    async runMergeAgent(taskId) {
      try {
        const response = await client.runMergeAgent(taskId);
        const recentTasks = await client.listRecentTasks();
        store.setRecentTasks(recentTasks);
        store.setSelectedTask(response.taskId);
        store.setActiveView("tasks");
        store.setErrorMessage(null);
      } catch (error) {
        fail(error);
      }
    }
  };
}

function mapCreatedTask(response: CreateTaskResponse): TaskSummary {
  return {
    id: response.taskId,
    repoId: response.repoId,
    title: response.title,
    stage: response.stage
  };
}
