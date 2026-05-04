declare const __KANNA_MOBILE__: boolean;

interface KannaTaskSwitchPerfE2EApi {
  getLatest: () => unknown;
  getAll: () => unknown[];
  clear: () => void;
}

interface KannaTerminalBufferStats {
  sessionId: string;
  lineCount: number;
  baseY: number;
  viewportY: number;
  matchingLineCount: number;
  firstMatchingLine: string | null;
  lastMatchingLine: string | null;
  hasEndMarker: boolean;
}

interface KannaTerminalBuffersE2EApi {
  stats: (sessionId: string, matcher?: RegExp, endMarker?: string) => KannaTerminalBufferStats;
  sessionIds: () => string[];
}

interface KannaE2EHook {
  ready: boolean;
  setupState: object | null;
  dbName: string;
  taskSwitchPerf: KannaTaskSwitchPerfE2EApi;
  terminalBuffers?: KannaTerminalBuffersE2EApi;
}

interface Window {
  __KANNA_E2E__?: KannaE2EHook;
}
