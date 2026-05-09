import type { CommandRunner } from "./process";
import { hasTmuxSession, type TmuxTarget } from "./tmux";

export interface DevStatus {
  running: boolean;
  session: string;
  server: string;
}

export async function getDevStatus(runner: CommandRunner, target: TmuxTarget): Promise<DevStatus> {
  return {
    running: await hasTmuxSession(runner, target),
    session: target.session,
    server: target.server
  };
}
