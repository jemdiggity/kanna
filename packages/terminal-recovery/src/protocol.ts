export interface RecoverySnapshot {
  sessionId: string;
  serialized: string;
  cols: number;
  rows: number;
  savedAt: number;
  sequence: number;
}

export interface StartSessionCommand {
  type: "StartSession";
  sessionId: string;
  cols: number;
  rows: number;
}

export interface WriteOutputCommand {
  type: "WriteOutput";
  sessionId: string;
  data: number[];
  sequence: number;
}

export interface ResizeSessionCommand {
  type: "ResizeSession";
  sessionId: string;
  cols: number;
  rows: number;
}

export interface EndSessionCommand {
  type: "EndSession";
  sessionId: string;
}

export interface GetSnapshotCommand {
  type: "GetSnapshot";
  sessionId: string;
}

export interface FlushAndShutdownCommand {
  type: "FlushAndShutdown";
}

export type RecoveryCommand =
  | StartSessionCommand
  | WriteOutputCommand
  | ResizeSessionCommand
  | EndSessionCommand
  | GetSnapshotCommand
  | FlushAndShutdownCommand;

export interface OkResponse {
  type: "Ok";
}

export interface ErrorResponse {
  type: "Error";
  message: string;
}

export interface SnapshotResponse extends RecoverySnapshot {
  type: "Snapshot";
}

export interface NotFoundResponse {
  type: "NotFound";
}

export type RecoveryResponse =
  | OkResponse
  | ErrorResponse
  | SnapshotResponse
  | NotFoundResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

export function parseCommand(line: string): RecoveryCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed) || !isString(parsed.type)) {
    throw new Error("Invalid command: missing type");
  }

  switch (parsed.type) {
    case "StartSession":
      if (isString(parsed.sessionId) && isNumber(parsed.cols) && isNumber(parsed.rows)) {
        return {
          type: "StartSession",
          sessionId: parsed.sessionId,
          cols: parsed.cols,
          rows: parsed.rows,
        };
      }
      break;
    case "WriteOutput":
      if (isString(parsed.sessionId) && isNumberArray(parsed.data) && isNumber(parsed.sequence)) {
        return {
          type: "WriteOutput",
          sessionId: parsed.sessionId,
          data: parsed.data,
          sequence: parsed.sequence,
        };
      }
      break;
    case "ResizeSession":
      if (isString(parsed.sessionId) && isNumber(parsed.cols) && isNumber(parsed.rows)) {
        return {
          type: "ResizeSession",
          sessionId: parsed.sessionId,
          cols: parsed.cols,
          rows: parsed.rows,
        };
      }
      break;
    case "EndSession":
      if (isString(parsed.sessionId)) {
        return {
          type: "EndSession",
          sessionId: parsed.sessionId,
        };
      }
      break;
    case "GetSnapshot":
      if (isString(parsed.sessionId)) {
        return {
          type: "GetSnapshot",
          sessionId: parsed.sessionId,
        };
      }
      break;
    case "FlushAndShutdown":
      return { type: "FlushAndShutdown" };
    default:
      throw new Error(`Unknown command type: ${parsed.type}`);
  }

  throw new Error(`Invalid command payload for ${parsed.type}`);
}

export function formatResponse(response: RecoveryResponse): string {
  return `${JSON.stringify(response)}\n`;
}
