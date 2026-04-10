import { describe, expect, it } from "vitest";
import {
  getSyntaxLanguageForPath,
  isBazelSyntaxPath,
} from "./syntaxLanguage";

describe("isBazelSyntaxPath", () => {
  it("recognizes Bazel special filenames", () => {
    expect(isBazelSyntaxPath("BUILD")).toBe(true);
    expect(isBazelSyntaxPath("BUILD.bazel")).toBe(true);
    expect(isBazelSyntaxPath("WORKSPACE")).toBe(true);
    expect(isBazelSyntaxPath("WORKSPACE.bazel")).toBe(true);
    expect(isBazelSyntaxPath("MODULE.bazel")).toBe(true);
  });

  it("recognizes .bzl files anywhere in the repo", () => {
    expect(isBazelSyntaxPath("tools/bazel/extensions.bzl")).toBe(true);
  });

  it("does not treat unrelated files as Bazel syntax", () => {
    expect(isBazelSyntaxPath("src/main.ts")).toBe(false);
    expect(isBazelSyntaxPath("README.md")).toBe(false);
  });
});

describe("getSyntaxLanguageForPath", () => {
  it("maps Bazel paths to python", () => {
    expect(getSyntaxLanguageForPath("BUILD.bazel")).toBe("python");
    expect(getSyntaxLanguageForPath("MODULE.bazel")).toBe("python");
    expect(getSyntaxLanguageForPath("tools/bazel/extensions.bzl")).toBe("python");
  });

  it("preserves existing extension-based mappings for non-Bazel files", () => {
    expect(getSyntaxLanguageForPath("src/App.vue")).toBe("vue");
    expect(getSyntaxLanguageForPath("src/main.ts")).toBe("typescript");
    expect(getSyntaxLanguageForPath("README.md")).toBe("markdown");
  });

  it("falls back to text for unknown extensions", () => {
    expect(getSyntaxLanguageForPath("notes.custom")).toBe("text");
  });
});
