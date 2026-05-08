import { describe, expect, it } from "vitest";
import { parseMobileFirebaseConfig } from "./config";

describe("parseMobileFirebaseConfig", () => {
  it("reads Firebase app config from Expo public env", () => {
    const config = parseMobileFirebaseConfig({
      EXPO_PUBLIC_FIREBASE_API_KEY: "api-key",
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "kanna-local.firebaseapp.com",
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: "kanna-local",
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "kanna-local.appspot.com",
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "sender-1",
      EXPO_PUBLIC_FIREBASE_APP_ID: "app-1"
    });

    expect(config).toEqual({
      app: {
        apiKey: "api-key",
        authDomain: "kanna-local.firebaseapp.com",
        projectId: "kanna-local",
        storageBucket: "kanna-local.appspot.com",
        messagingSenderId: "sender-1",
        appId: "app-1"
      },
      authEmulator: null
    });
  });

  it("returns null app config when required Firebase values are missing", () => {
    const config = parseMobileFirebaseConfig({
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: "kanna-local"
    });

    expect(config.app).toBeNull();
  });

  it("parses an auth emulator URL from host and port env vars", () => {
    const config = parseMobileFirebaseConfig({
      EXPO_PUBLIC_FIREBASE_API_KEY: "api-key",
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "kanna-local.firebaseapp.com",
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: "kanna-local",
      EXPO_PUBLIC_FIREBASE_APP_ID: "app-1",
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1",
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: "9099"
    });

    expect(config.authEmulator).toEqual({
      host: "127.0.0.1",
      port: 9099,
      url: "http://127.0.0.1:9099"
    });
  });

  it("ignores an invalid auth emulator port", () => {
    const config = parseMobileFirebaseConfig({
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1",
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: "invalid"
    });

    expect(config.authEmulator).toBeNull();
  });
});
