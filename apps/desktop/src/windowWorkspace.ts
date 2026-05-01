import { getSetting, setSetting, type DbHandle } from "@kanna/db";

import { emit } from "./emit";
import { listen } from "./listen";
import { isTauri } from "./tauri-mock";

export interface WindowBootstrap {
  windowId: string;
  selectedRepoId: string | null;
  selectedItemId: string | null;
}

export interface WorkspaceWindowState extends WindowBootstrap {
  sidebarHidden: boolean;
  order: number;
}

export interface WorkspaceSnapshot {
  windows: WorkspaceWindowState[];
}

export interface WindowWorkspaceController {
  bootstrap: WindowBootstrap;
  loadSnapshot: () => Promise<WorkspaceSnapshot>;
  saveSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
  openWindow: (selection: {
    selectedRepoId: string | null;
    selectedItemId: string | null;
  }) => Promise<void>;
  persistSelection: (selection: {
    selectedRepoId: string | null;
    selectedItemId: string | null;
  }) => Promise<void>;
  persistSidebarHidden: (hidden: boolean) => Promise<void>;
  invalidateSharedData: (reason: string) => Promise<void>;
  restoreAdditionalWindows: () => Promise<void>;
  onSharedInvalidation: (handler: (payload: { reason?: string; sourceWindowId?: string }) => void | Promise<void>) => Promise<() => void>;
}

export const WINDOW_WORKSPACE_SETTINGS_KEY = "window_workspace_v1";
export const WINDOW_WORKSPACE_INVALIDATED_EVENT = "kanna://window-workspace-invalidated";

export function parseWindowBootstrap(search: string): WindowBootstrap {
  const params = new URLSearchParams(search);

  return {
    windowId: params.get("windowId") ?? "main",
    selectedRepoId: params.get("selectedRepoId"),
    selectedItemId: params.get("selectedItemId"),
  };
}

export function reconcileWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  windowId: string,
): WorkspaceSnapshot {
  if (snapshot.windows.some((entry) => entry.windowId === windowId)) {
    return snapshot;
  }

  return {
    windows: [
      ...snapshot.windows,
      {
        windowId,
        selectedRepoId: null,
        selectedItemId: null,
        sidebarHidden: false,
        order: snapshot.windows.length,
      },
    ],
  };
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const ordered = [...snapshot.windows].sort((left, right) => left.order - right.order);

  return {
    windows: ordered.map((entry, index) => ({
      windowId: entry.windowId,
      selectedRepoId: entry.selectedRepoId,
      selectedItemId: entry.selectedItemId,
      sidebarHidden: entry.sidebarHidden,
      order: index,
    })),
  };
}

function buildWindowUrl(state: WindowBootstrap): string {
  const params = new URLSearchParams();
  params.set("windowId", state.windowId);
  if (state.selectedRepoId) params.set("selectedRepoId", state.selectedRepoId);
  if (state.selectedItemId) params.set("selectedItemId", state.selectedItemId);
  return `/?${params.toString()}`;
}

function createWindowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `window-${Date.now()}`;
}

export async function readWorkspaceSnapshot(db: DbHandle): Promise<WorkspaceSnapshot> {
  const raw = await getSetting(db, WINDOW_WORKSPACE_SETTINGS_KEY);
  if (!raw) return { windows: [] };

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    return normalizeWorkspaceSnapshot({
      windows: Array.isArray(parsed.windows) ? parsed.windows.map((entry, index) => ({
        windowId: typeof entry?.windowId === "string" ? entry.windowId : `window-${index}`,
        selectedRepoId: typeof entry?.selectedRepoId === "string" ? entry.selectedRepoId : null,
        selectedItemId: typeof entry?.selectedItemId === "string" ? entry.selectedItemId : null,
        sidebarHidden: entry?.sidebarHidden === true,
        order: typeof entry?.order === "number" ? entry.order : index,
      })) : [],
    });
  } catch {
    return { windows: [] };
  }
}

export async function writeWorkspaceSnapshot(db: DbHandle, snapshot: WorkspaceSnapshot): Promise<void> {
  await setSetting(db, WINDOW_WORKSPACE_SETTINGS_KEY, JSON.stringify(normalizeWorkspaceSnapshot(snapshot)));
}

export async function resolveWindowBootstrap(
  db: DbHandle,
  bootstrap: WindowBootstrap,
  snapshotOverride?: WorkspaceSnapshot,
): Promise<WindowBootstrap> {
  if (bootstrap.selectedRepoId || bootstrap.selectedItemId) {
    return bootstrap;
  }

  const snapshot = snapshotOverride ?? await readWorkspaceSnapshot(db);
  const savedWindow = snapshot.windows.find((entry) => entry.windowId === bootstrap.windowId);
  if (!savedWindow) {
    return bootstrap;
  }

  return {
    windowId: bootstrap.windowId,
    selectedRepoId: savedWindow.selectedRepoId,
    selectedItemId: savedWindow.selectedItemId,
  };
}

export function createWindowWorkspace(input: {
  db: DbHandle;
  bootstrap: WindowBootstrap;
}): WindowWorkspaceController {
  const { db, bootstrap } = input;

  async function loadSnapshot(): Promise<WorkspaceSnapshot> {
    return reconcileWorkspaceSnapshot(await readWorkspaceSnapshot(db), bootstrap.windowId);
  }

  async function saveSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
    await writeWorkspaceSnapshot(db, reconcileWorkspaceSnapshot(snapshot, bootstrap.windowId));
  }

  async function spawnWindow(state: WindowBootstrap): Promise<void> {
    const url = buildWindowUrl(state);

    if (isTauri) {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      new WebviewWindow(`window-${state.windowId}`, {
        url,
        title: "",
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
      });
      return;
    }

    window.open(url, "_blank");
  }

  async function updateCurrentWindow(
    apply: (entry: WorkspaceWindowState) => WorkspaceWindowState,
  ): Promise<void> {
    const snapshot = await loadSnapshot();
    const next = normalizeWorkspaceSnapshot({
      windows: snapshot.windows.map((entry) =>
        entry.windowId === bootstrap.windowId ? apply(entry) : entry,
      ),
    });
    await saveSnapshot(next);
  }

  return {
    bootstrap,
    loadSnapshot,
    saveSnapshot,
    openWindow: async (selection) => {
      const windowId = createWindowId();
      const snapshot = await loadSnapshot();
      const nextWindow: WorkspaceWindowState = {
        windowId,
        selectedRepoId: selection.selectedRepoId,
        selectedItemId: selection.selectedItemId,
        sidebarHidden: false,
        order: snapshot.windows.length,
      };
      await saveSnapshot({
        windows: [...snapshot.windows, nextWindow],
      });
      await spawnWindow(nextWindow);
    },
    persistSelection: async (selection) => {
      await updateCurrentWindow((entry) => ({
        ...entry,
        selectedRepoId: selection.selectedRepoId,
        selectedItemId: selection.selectedItemId,
      }));
    },
    persistSidebarHidden: async (hidden) => {
      await updateCurrentWindow((entry) => ({
        ...entry,
        sidebarHidden: hidden,
      }));
    },
    invalidateSharedData: async (reason) => {
      await emit(WINDOW_WORKSPACE_INVALIDATED_EVENT, {
        reason,
        sourceWindowId: bootstrap.windowId,
      });
    },
    restoreAdditionalWindows: async () => {
      if (bootstrap.windowId !== "main") return;
      const snapshot = await loadSnapshot();
      const extraWindows = snapshot.windows
        .filter((entry) => entry.windowId !== bootstrap.windowId)
        .sort((left, right) => left.order - right.order);

      for (const entry of extraWindows) {
        await spawnWindow(entry);
      }
    },
    onSharedInvalidation: async (handler) =>
      listen(WINDOW_WORKSPACE_INVALIDATED_EVENT, async (event: { payload?: { reason?: string; sourceWindowId?: string } }) => {
        const payload = event.payload ?? {};
        if (payload.sourceWindowId === bootstrap.windowId) return;
        await handler(payload);
      }),
  };
}
