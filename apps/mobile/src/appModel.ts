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

const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 48120;
const DEFAULT_SERVER_BASE_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

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

interface SourceCodeModule {
  getConstants?: () => { scriptURL?: string | null };
  scriptURL?: string | null;
}

interface BatchedBridgeModuleConfig {
  0?: string;
  1?: { scriptURL?: string | null } | null;
}

function readReactNativeBundleUrl(): string | null {
  const runtime = globalThis as {
    __fbBatchedBridgeConfig?: {
      remoteModuleConfig?: BatchedBridgeModuleConfig[];
    };
    nativeModuleProxy?: { SourceCode?: SourceCodeModule };
  };

  const sourceCodeModule = runtime.nativeModuleProxy?.SourceCode;
  const sourceCodeConstants = sourceCodeModule?.getConstants?.();
  const scriptUrl = sourceCodeConstants?.scriptURL ?? sourceCodeModule?.scriptURL;
  if (typeof scriptUrl === "string" && scriptUrl.length > 0) {
    return scriptUrl;
  }

  const sourceCodeBridgeConfig = runtime.__fbBatchedBridgeConfig?.remoteModuleConfig?.find(
    (entry) => entry[0] === "SourceCode"
  );
  const bridgeScriptUrl = sourceCodeBridgeConfig?.[1]?.scriptURL;
  if (typeof bridgeScriptUrl === "string" && bridgeScriptUrl.length > 0) {
    return bridgeScriptUrl;
  }

  return typeof scriptUrl === "string" && scriptUrl.length > 0 ? scriptUrl : null;
}

function inferServerBaseUrl(bundleUrl: string | null): string | null {
  if (!bundleUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(bundleUrl);
    if (!parsedUrl.hostname) {
      return null;
    }

    return `http://${parsedUrl.hostname}:${DEFAULT_SERVER_PORT}`;
  } catch {
    return null;
  }
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl);
    return (
      parsedUrl.hostname === "127.0.0.1" ||
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function resolveServerBaseUrl(
  env: ExpoPublicEnv = readExpoPublicEnv(),
  bundleUrl: string | null = readReactNativeBundleUrl()
): string {
  const configuredBaseUrl = env.EXPO_PUBLIC_KANNA_SERVER_URL?.trim();
  const inferredBaseUrl = inferServerBaseUrl(bundleUrl);

  if (
    configuredBaseUrl &&
    inferredBaseUrl &&
    isLoopbackBaseUrl(configuredBaseUrl) &&
    !isLoopbackBaseUrl(inferredBaseUrl)
  ) {
    return inferredBaseUrl;
  }

  return configuredBaseUrl || inferredBaseUrl || DEFAULT_SERVER_BASE_URL;
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
