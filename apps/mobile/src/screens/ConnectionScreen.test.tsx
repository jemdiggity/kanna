import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthState } from "../state/sessionStore";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => styles
  },
  Text: "Text",
  TextInput: "TextInput",
  View: "View"
}));

let getConnectionAuthSummary:
  | typeof import("./ConnectionScreen").getConnectionAuthSummary
  | null = null;

beforeAll(async () => {
  const module = await import("./ConnectionScreen");
  getConnectionAuthSummary = module.getConnectionAuthSummary;
});

function renderAuthText(auth: AuthState): string {
  if (!getConnectionAuthSummary) {
    throw new Error("ConnectionScreen was not loaded");
  }

  const summary = getConnectionAuthSummary(auth);

  return `${summary.title} ${summary.detail}`;
}

describe("ConnectionScreen", () => {
  it("shows signed-out auth state", () => {
    expect(renderAuthText({ status: "signedOut" })).toContain("Signed out");
  });

  it("shows signed-in auth state with the current user email", () => {
    expect(
      renderAuthText({
        status: "signedIn",
        user: {
          uid: "user-1",
          email: "dev@kanna.test",
          displayName: null
        }
      })
    ).toContain("dev@kanna.test");
  });
});
