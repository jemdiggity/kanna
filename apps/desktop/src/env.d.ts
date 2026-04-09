declare const __KANNA_MOBILE__: boolean;

interface KannaE2EHook {
  setupState: object | null;
  dbName: string;
}

interface Window {
  __KANNA_E2E__?: KannaE2EHook;
}
