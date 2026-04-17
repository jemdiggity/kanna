import { createKannaClient, type KannaClient } from "./lib/api/client";
import { createLanTransport, type FetchLike } from "./lib/transports/lanTransport";
import { createRootNavigator } from "./navigation/RootNavigator";
import {
  createMobileController,
  type MobileController
} from "./state/mobileController";
import { createSessionStore, type SessionStore } from "./state/sessionStore";
import {
  createDefaultSessionPersistence,
  type SessionPersistence
} from "./state/sessionPersistence";

const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:48120";

interface ExpoPublicEnv {
  EXPO_PUBLIC_KANNA_SERVER_URL?: string;
}

export interface AppModel {
  client: KannaClient;
  controller: MobileController;
  initialize(): Promise<void>;
  navigator: ReturnType<typeof createRootNavigator>;
  sessionStore: SessionStore;
}

function readExpoPublicEnv(): ExpoPublicEnv {
  const globalEnv = (globalThis as { process?: { env?: ExpoPublicEnv } }).process?.env;
  return globalEnv ?? {};
}

export function resolveServerBaseUrl(
  env: ExpoPublicEnv = readExpoPublicEnv()
): string {
  const configuredBaseUrl = env.EXPO_PUBLIC_KANNA_SERVER_URL?.trim();
  return configuredBaseUrl || DEFAULT_SERVER_BASE_URL;
}

export function createAppModel(
  baseUrl = resolveServerBaseUrl(),
  fetchImpl = globalThis.fetch as unknown as FetchLike,
  persistence?: SessionPersistence
): AppModel {
  const client = createKannaClient(createLanTransport(baseUrl, fetchImpl));
  const sessionStore = createSessionStore();
  const controller = createMobileController(client, sessionStore);
  let persistencePromise: Promise<SessionPersistence> | null = persistence
    ? Promise.resolve(persistence)
    : null;

  const getPersistence = () => {
    if (!persistencePromise) {
      persistencePromise = createDefaultSessionPersistence();
    }

    return persistencePromise;
  };

  let lastSavedContextJson: string | null = null;
  const persistContext = () => {
    const context = sessionStore.getPersistedContext();
    const serializedContext = JSON.stringify(context);
    if (serializedContext === lastSavedContextJson) {
      return;
    }

    lastSavedContextJson = serializedContext;
    void getPersistence().then((resolvedPersistence) => resolvedPersistence.save(context));
  };

  sessionStore.subscribe(persistContext);

  return {
    client,
    controller,
    async initialize() {
      const resolvedPersistence = await getPersistence();
      const persistedContext = await resolvedPersistence.load();
      if (persistedContext) {
        sessionStore.hydrateContext(persistedContext);
        lastSavedContextJson = JSON.stringify(persistedContext);
      }

      await controller.bootstrap();
    },
    navigator: createRootNavigator(),
    sessionStore
  };
}
