import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./files";

export interface FirebasePortInput {
  KANNA_FIREBASE_AUTH_PORT: number;
  KANNA_FIREBASE_FIRESTORE_PORT: number;
  KANNA_FIREBASE_FUNCTIONS_PORT: number;
  KANNA_FIREBASE_UI_PORT: number;
}

interface FirebaseConfig {
  functions?: unknown;
  emulators?: Record<string, unknown>;
}

function withFunctionsRuntime(functions: unknown): unknown {
  if (functions && typeof functions === "object" && !Array.isArray(functions)) {
    return { ...functions, runtime: "nodejs24" };
  }
  return functions;
}

export function writeFirebaseEmulatorConfig(repoRoot: string, ports: FirebasePortInput): string {
  const source = readJsonFile(join(repoRoot, "firebase.json")) as FirebaseConfig;
  const generated = {
    ...source,
    functions: withFunctionsRuntime(source.functions),
    emulators: {
      ...(source.emulators ?? {}),
      auth: { port: ports.KANNA_FIREBASE_AUTH_PORT },
      firestore: { port: ports.KANNA_FIREBASE_FIRESTORE_PORT },
      functions: { port: ports.KANNA_FIREBASE_FUNCTIONS_PORT },
      ui: { enabled: true, port: ports.KANNA_FIREBASE_UI_PORT }
    }
  };
  const path = join(repoRoot, `.firebase-${ports.KANNA_FIREBASE_FIRESTORE_PORT}.kanna.json`);
  writeJsonFile(path, generated);
  return path;
}

export function buildFirebaseEmulatorArgs(configPath: string, extraArgs: string[]): string[] {
  return ["exec", "firebase", "emulators:start", "--project", "kanna-local", "--config", configPath, ...extraArgs];
}

export function buildFirebaseCommandEnv(repoRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const repoNodeModules = join(repoRoot, "node_modules");
  return {
    ...env,
    NODE_PATH: env.NODE_PATH ? `${repoNodeModules}:${env.NODE_PATH}` : repoNodeModules
  };
}
