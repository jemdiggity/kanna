import type { MobileView } from "./sessionStore";

const MOBILE_CONTEXT_STORAGE_KEY = "kanna.mobile.context.v1";

export interface PersistedSessionContext {
  selectedDesktopId: string | null;
  selectedRepoId: string | null;
  selectedTaskId: string | null;
  activeView: MobileView;
}

export interface SessionPersistence {
  load(): Promise<PersistedSessionContext | null>;
  save(context: PersistedSessionContext): Promise<void>;
}

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createSessionPersistence(storage: StorageAdapter): SessionPersistence {
  return {
    async load() {
      const raw = await storage.getItem(MOBILE_CONTEXT_STORAGE_KEY);
      return parsePersistedSessionContext(raw);
    },
    async save(context) {
      await storage.setItem(
        MOBILE_CONTEXT_STORAGE_KEY,
        JSON.stringify(context)
      );
    }
  };
}

export async function createDefaultSessionPersistence(): Promise<SessionPersistence> {
  const module = await import("@react-native-async-storage/async-storage");
  return createSessionPersistence(module.default as StorageAdapter);
}

function parsePersistedSessionContext(
  raw: string | null
): PersistedSessionContext | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSessionContext>;
    if (!isMobileView(parsed.activeView)) {
      return null;
    }

    return {
      selectedDesktopId: normalizeNullableString(parsed.selectedDesktopId),
      selectedRepoId: normalizeNullableString(parsed.selectedRepoId),
      selectedTaskId: normalizeNullableString(parsed.selectedTaskId),
      activeView: parsed.activeView
    };
  } catch {
    return null;
  }
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isMobileView(value: unknown): value is MobileView {
  return (
    value === "tasks" ||
    value === "recent" ||
    value === "search" ||
    value === "desktops" ||
    value === "more"
  );
}
