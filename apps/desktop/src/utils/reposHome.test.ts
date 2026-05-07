import { describe, expect, it } from "vitest";
import { defaultReposHome } from "./reposHome";

describe("defaultReposHome", () => {
  it("resolves the standard Kanna repos directory under the user's home", () => {
    expect(defaultReposHome("/Users/me")).toBe("/Users/me/.kanna/repos");
  });

  it("normalizes trailing slashes from home directory providers", () => {
    expect(defaultReposHome("/Users/me/")).toBe("/Users/me/.kanna/repos");
  });
});
