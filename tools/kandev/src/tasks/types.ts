import type { z } from "zod";

export interface TaskResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface TaskContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface TaskDefinition {
  id: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute: (context: TaskContext, input: unknown) => Promise<TaskResult>;
}
