import type { TaskTerminalStatus } from "../state/sessionStore";

export type TerminalMutation =
  | {
      kind: "none";
    }
  | {
      kind: "replace";
      output: string;
      status: TaskTerminalStatus;
    }
  | {
      kind: "append";
      chunk: string;
    };

interface PlanTerminalMutationOptions {
  previousOutput: string;
  previousStatus: TaskTerminalStatus;
  nextOutput: string;
  nextStatus: TaskTerminalStatus;
}

export function planTerminalMutation({
  previousOutput,
  previousStatus,
  nextOutput,
  nextStatus
}: PlanTerminalMutationOptions): TerminalMutation {
  if (nextOutput === previousOutput) {
    if (!nextOutput.trim() && nextStatus !== previousStatus) {
      return {
        kind: "replace",
        output: nextOutput,
        status: nextStatus
      };
    }

    return { kind: "none" };
  }

  if (!previousOutput.trim()) {
    return {
      kind: "replace",
      output: nextOutput,
      status: nextStatus
    };
  }

  if (nextOutput.startsWith(previousOutput)) {
    return {
      kind: "append",
      chunk: nextOutput.slice(previousOutput.length)
    };
  }

  return {
    kind: "replace",
    output: nextOutput,
    status: nextStatus
  };
}
