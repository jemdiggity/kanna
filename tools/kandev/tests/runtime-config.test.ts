import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFirebaseEmulatorArgs, writeFirebaseEmulatorConfig } from "../src/runtime/firebase";
import { readDesktopBundleIdentifier, writeTauriLocalConfig } from "../src/runtime/tauri";

describe("runtime config generation", () => {
  it("writes a local Firebase emulator config without mutating firebase.json", () => {
    const root = mkdtempSync(join(tmpdir(), "kandev-firebase-"));
    const firebaseJson = {
      functions: { source: "services/firebase-functions" },
      emulators: {
        auth: { port: 9099 },
        firestore: { port: 8080 },
        functions: { port: 5001 },
        ui: { enabled: true, port: 4000 }
      }
    };
    writeFileSync(join(root, "firebase.json"), JSON.stringify(firebaseJson, null, 2));

    const generatedPath = writeFirebaseEmulatorConfig(root, {
      KANNA_FIREBASE_AUTH_PORT: 19099,
      KANNA_FIREBASE_FIRESTORE_PORT: 18080,
      KANNA_FIREBASE_FUNCTIONS_PORT: 15001,
      KANNA_FIREBASE_UI_PORT: 14000
    });

    expect(generatedPath).toBe(join(root, ".firebase-18080.kanna.json"));
    expect(JSON.parse(readFileSync(generatedPath, "utf8"))).toMatchObject({
      functions: {
        source: "services/firebase-functions",
        runtime: "nodejs24"
      },
      emulators: {
        auth: { port: 19099 },
        firestore: { port: 18080 },
        functions: { port: 15001 },
        ui: { enabled: true, port: 14000 }
      }
    });
    expect(JSON.parse(readFileSync(join(root, "firebase.json"), "utf8"))).toEqual(firebaseJson);
  });

  it("writes Tauri local dev URL config", () => {
    const root = mkdtempSync(join(tmpdir(), "kandev-tauri-"));
    const path = writeTauriLocalConfig(root, 1555);
    expect(path).toBe(join(root, "apps/desktop/src-tauri/tauri.conf.local.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      build: { devUrl: "http://localhost:1555" }
    });
  });

  it("reads the desktop bundle identifier from Tauri config", () => {
    const root = mkdtempSync(join(tmpdir(), "kandev-tauri-id-"));
    const configDir = join(root, "apps/desktop/src-tauri");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tauri.conf.json"), JSON.stringify({ identifier: "dev.kanna" }));

    expect(readDesktopBundleIdentifier(root)).toBe("dev.kanna");
  });

  it("builds Firebase emulator command args from generated config", () => {
    expect(buildFirebaseEmulatorArgs("/repo/.firebase-8080.kanna.json", [])).toEqual([
      "exec",
      "firebase",
      "emulators:start",
      "--project",
      "kanna-local",
      "--config",
      "/repo/.firebase-8080.kanna.json"
    ]);
    expect(buildFirebaseEmulatorArgs("/repo/.firebase-8080.kanna.json", ["--only", "auth"])).toContain("--only");
  });
});
