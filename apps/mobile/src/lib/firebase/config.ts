export interface ExpoFirebaseEnv {
  EXPO_PUBLIC_FIREBASE_API_KEY?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  EXPO_PUBLIC_FIREBASE_APP_ID?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT?: string;
}

export interface MobileFirebaseAppConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export interface MobileFirebaseAuthEmulatorConfig {
  host: string;
  port: number;
  url: string;
}

export interface MobileFirebaseConfig {
  app: MobileFirebaseAppConfig | null;
  authEmulator: MobileFirebaseAuthEmulatorConfig | null;
}

export function readExpoFirebaseEnv(): ExpoFirebaseEnv {
  const globalEnv = (globalThis as { process?: { env?: ExpoFirebaseEnv } }).process?.env;
  return globalEnv ?? {};
}

export function parseMobileFirebaseConfig(
  env: ExpoFirebaseEnv = readExpoFirebaseEnv()
): MobileFirebaseConfig {
  const apiKey = normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const projectId = normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const appId = normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_APP_ID);
  const app =
    apiKey && projectId && appId
      ? compactAppConfig({
          apiKey,
          authDomain: normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
          projectId,
          storageBucket: normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
          messagingSenderId: normalizeEnvValue(
            env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
          ),
          appId
        })
      : null;

  return {
    app,
    authEmulator: parseAuthEmulator(env)
  };
}

function compactAppConfig(config: MobileFirebaseAppConfig): MobileFirebaseAppConfig {
  const compacted: MobileFirebaseAppConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId
  };

  if (config.authDomain) {
    compacted.authDomain = config.authDomain;
  }
  if (config.storageBucket) {
    compacted.storageBucket = config.storageBucket;
  }
  if (config.messagingSenderId) {
    compacted.messagingSenderId = config.messagingSenderId;
  }

  return compacted;
}

function parseAuthEmulator(
  env: ExpoFirebaseEnv
): MobileFirebaseAuthEmulatorConfig | null {
  const host = normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST);
  const rawPort = normalizeEnvValue(env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT);
  if (!host || !rawPort) {
    return null;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    host,
    port,
    url: `http://${host}:${port}`
  };
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
