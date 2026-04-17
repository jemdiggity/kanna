import { createKannaClient, type KannaClient } from "./lib/api/client";
import { createLanTransport, type FetchLike } from "./lib/transports/lanTransport";
import { createRootNavigator } from "./navigation/RootNavigator";
import {
  createMobileController,
  type MobileController
} from "./state/mobileController";
import { createSessionStore, type SessionStore } from "./state/sessionStore";

const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:48120";

export interface AppModel {
  client: KannaClient;
  controller: MobileController;
  navigator: ReturnType<typeof createRootNavigator>;
  sessionStore: SessionStore;
}

export function createAppModel(
  baseUrl = DEFAULT_SERVER_BASE_URL,
  fetchImpl = globalThis.fetch as unknown as FetchLike
): AppModel {
  const client = createKannaClient(createLanTransport(baseUrl, fetchImpl));
  const sessionStore = createSessionStore();
  return {
    client,
    controller: createMobileController(client, sessionStore),
    navigator: createRootNavigator(),
    sessionStore
  };
}
