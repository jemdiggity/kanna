import { argv, env, stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RecoveryServer } from "./server";
import { SnapshotStore } from "./snapshotStore";

export interface MainOptions {
  snapshotDir: string;
  flushDebounceMs?: number;
}

export async function main(options?: MainOptions): Promise<void> {
  const snapshotDir = options?.snapshotDir ?? env.KANNA_TERMINAL_RECOVERY_DIR ?? argv[2];
  if (!snapshotDir) {
    throw new Error(
      "Snapshot directory is required via main({ snapshotDir }), KANNA_TERMINAL_RECOVERY_DIR, or argv[2]",
    );
  }

  const flushDebounceMs = options?.flushDebounceMs ?? Number(env.KANNA_TERMINAL_RECOVERY_DEBOUNCE_MS ?? "250");
  const server = new RecoveryServer({
    input: stdin,
    output: stdout,
    snapshotStore: new SnapshotStore(snapshotDir),
    flushDebounceMs,
  });

  await server.start();
}

const isEntrypoint = argv[1] ? resolve(argv[1]) === fileURLToPath(import.meta.url) : false;

if (isEntrypoint) {
  await main();
}
