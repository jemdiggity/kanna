export interface E2EAppMetricsSnapshot {
  invokeCounts: Record<string, number>;
  listenCounts: Record<string, number>;
  unlistenCounts: Record<string, number>;
  activeListenCounts: Record<string, number>;
}

interface E2EAppMetricsApi {
  recordInvoke: (command: string) => void;
  recordListen: (event: string) => () => void;
  snapshot: () => E2EAppMetricsSnapshot;
  clear: () => void;
}

function increment(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, Math.max(0, (map.get(key) ?? 0) + delta));
}

function toRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map.entries());
}

const invokeCounts = new Map<string, number>();
const listenCounts = new Map<string, number>();
const unlistenCounts = new Map<string, number>();
const activeListenCounts = new Map<string, number>();

export const e2eAppMetrics: E2EAppMetricsApi = {
  recordInvoke(command: string): void {
    increment(invokeCounts, command);
  },

  recordListen(event: string): () => void {
    increment(listenCounts, event);
    increment(activeListenCounts, event);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      increment(unlistenCounts, event);
      increment(activeListenCounts, event, -1);
    };
  },

  snapshot(): E2EAppMetricsSnapshot {
    return {
      invokeCounts: toRecord(invokeCounts),
      listenCounts: toRecord(listenCounts),
      unlistenCounts: toRecord(unlistenCounts),
      activeListenCounts: toRecord(activeListenCounts),
    };
  },

  clear(): void {
    invokeCounts.clear();
    listenCounts.clear();
    unlistenCounts.clear();
  },
};
