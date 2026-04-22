declare const __KANNA_MOBILE__: boolean;

interface KannaTaskSwitchPerfE2EApi {
  getLatest: () => unknown;
  getAll: () => unknown[];
  clear: () => void;
}

interface KannaE2EHook {
  ready: boolean;
  setupState: object | null;
  dbName: string;
  taskSwitchPerf: KannaTaskSwitchPerfE2EApi;
}

interface Window {
  __KANNA_E2E__?: KannaE2EHook;
}
